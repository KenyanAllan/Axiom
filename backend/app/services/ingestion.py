"""Source document ingestion pipeline — PDF parsing, chunking, and claim extraction.

Orchestrates the full flow:
  S3 file → download → parse (PDF/text) → chunk → embed →
  match/create topics → extract claims → generate embeddings → store

Runs inside Celery workers (sync context).
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any

import boto3
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

SIMILARITY_THRESHOLD = 0.82
TARGET_CHUNK_TOKENS = 800
MAX_CHUNK_TOKENS = 1200
OVERLAP_TOKENS = 100


# ── PDF parsing ──────────────────────────────────────────────────────────────


def parse_pdf_to_text(pdf_bytes: bytes) -> str:
    """Extract plain text from a PDF using PyMuPDF (fitz).

    Preserves page breaks as double newlines.
    """
    import fitz  # pymupdf

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages: list[str] = []

    for page in doc:
        text = page.get_text("text")
        if text.strip():
            pages.append(text.strip())

    doc.close()
    return "\n\n".join(pages)


AUDIO_CONTENT_TYPES = {
    "audio/mpeg", "audio/mp3", "audio/mp4", "audio/wav", "audio/x-wav",
    "audio/ogg", "audio/flac", "audio/webm", "video/mp4", "video/webm",
}

AUDIO_EXTENSIONS = {".mp3", ".mp4", ".wav", ".ogg", ".flac", ".webm", ".m4a"}


def is_audio_file(content_type: str, filename: str) -> bool:
    """Check if the file is an audio/video type that needs transcription."""
    if content_type in AUDIO_CONTENT_TYPES:
        return True
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in AUDIO_EXTENSIONS


def transcribe_audio_file(s3_key: str, source_doc_id: int) -> str:
    """Transcribe an audio file using Amazon Transcribe. Blocks until complete.

    Polls every 15 seconds, up to 10 minutes max.
    """
    from app.services.transcribe import (
        get_transcript_text,
        get_transcription_status,
        start_transcription,
    )

    job_name = start_transcription(s3_key, source_doc_id)
    logger.info("Started transcription job %s for source_doc %s", job_name, source_doc_id)

    max_wait = 600  # 10 minutes
    poll_interval = 15
    elapsed = 0

    while elapsed < max_wait:
        time.sleep(poll_interval)
        elapsed += poll_interval

        status = get_transcription_status(job_name)
        logger.info("Transcription %s status: %s (%ds elapsed)", job_name, status["status"], elapsed)

        if status["status"] == "COMPLETED":
            text = get_transcript_text(job_name)
            if text:
                logger.info("Transcription complete for %s: %d chars", job_name, len(text))
                return text
            return ""

        if status["status"] == "FAILED":
            raise RuntimeError(f"Transcription job {job_name} failed")

    raise TimeoutError(f"Transcription job {job_name} timed out after {max_wait}s")


def parse_source_file(file_bytes: bytes, content_type: str, filename: str) -> str:
    """Route to the correct parser based on content type."""
    if content_type == "application/pdf" or filename.lower().endswith(".pdf"):
        return parse_pdf_to_text(file_bytes)

    if content_type.startswith("text/") or filename.lower().endswith((".md", ".txt", ".rst")):
        return file_bytes.decode("utf-8", errors="replace")

    logger.warning("Unsupported content type %s for %s, attempting text decode", content_type, filename)
    return file_bytes.decode("utf-8", errors="replace")


# ── Chunking ─────────────────────────────────────────────────────────────────


def _estimate_tokens(text: str) -> int:
    """Rough token estimate: ~4 chars per token for English text."""
    return len(text) // 4


def chunk_text(text: str) -> list[dict]:
    """Split text into overlapping chunks suitable for Bedrock context windows.

    Strategy:
    1. Split on section headers (## or blank-line-separated paragraphs).
    2. Accumulate paragraphs until reaching TARGET_CHUNK_TOKENS.
    3. When a chunk is full, close it with OVERLAP_TOKENS of trailing context.

    Returns list of {"index": int, "text": str, "token_estimate": int}.
    """
    paragraphs = re.split(r"\n{2,}", text.strip())
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    if not paragraphs:
        return []

    chunks: list[dict] = []
    current_parts: list[str] = []
    current_tokens = 0

    for para in paragraphs:
        para_tokens = _estimate_tokens(para)

        if current_tokens + para_tokens > MAX_CHUNK_TOKENS and current_parts:
            chunk_text_str = "\n\n".join(current_parts)
            chunks.append({
                "index": len(chunks),
                "text": chunk_text_str,
                "token_estimate": _estimate_tokens(chunk_text_str),
            })

            # Overlap: keep last paragraph(s) up to OVERLAP_TOKENS
            overlap_parts: list[str] = []
            overlap_tokens = 0
            for p in reversed(current_parts):
                pt = _estimate_tokens(p)
                if overlap_tokens + pt > OVERLAP_TOKENS:
                    break
                overlap_parts.insert(0, p)
                overlap_tokens += pt

            current_parts = overlap_parts
            current_tokens = overlap_tokens

        current_parts.append(para)
        current_tokens += para_tokens

    if current_parts:
        chunk_text_str = "\n\n".join(current_parts)
        chunks.append({
            "index": len(chunks),
            "text": chunk_text_str,
            "token_estimate": _estimate_tokens(chunk_text_str),
        })

    logger.info("Split text into %d chunks (avg ~%d tokens each)",
                len(chunks),
                sum(c["token_estimate"] for c in chunks) // max(len(chunks), 1))
    return chunks


# ── Topic title extraction ───────────────────────────────────────────────────


def _extract_topic_title_from_chunk(chunk_text: str) -> str | None:
    """Try to extract a section heading from the chunk to use as topic title."""
    for line in chunk_text.split("\n")[:5]:
        line = line.strip()
        # Markdown headers
        if line.startswith("#"):
            return re.sub(r"^#+\s*", "", line).strip()
        # All-caps lines (common in PDF extraction)
        if line.isupper() and 3 < len(line) < 100:
            return line.title()
    return None


# ── Bedrock calls ────────────────────────────────────────────────────────────


TOPIC_EXTRACTION_PROMPT = """\
You are a knowledge-graph extraction engine for a technical learning platform.

Given a MARKDOWN CHUNK from a textbook or document, identify the primary topic
being discussed and extract atomic claims.

Return a JSON object with:
- "topic_title": a concise title for the main topic (< 80 chars)
- "topic_summary": a 1-2 sentence summary of the topic
- "claims": an array of objects, each with:
  - "id_suffix": short snake_case slug (e.g. "gauss_elim_pivot_rule")
  - "title": concise title (< 80 chars)
  - "content": the full factual statement (1-3 sentences)
  - "diagnostic_prompt": a "Wrong on Purpose" prompt asking the student to
    identify what is wrong with a deliberately flawed snippet
  - "flawed_snippet": a code or math snippet containing a subtle intentional error
  - "rubric": 2-4 sentence acceptance criteria for a correct student diagnosis

Return ONLY the JSON object. No markdown fences.
"""

GLOSSARY_EXTRACTION_PROMPT = """\
You are a glossary extraction engine for a technical learning platform.

Given a MARKDOWN CHUNK from a textbook or document, identify key terms, concepts,
and definitions that a student would need to understand.

Return a JSON object with:
- "terms": an array of objects, each with:
  - "term": the glossary term or concept name (< 100 chars)
  - "definition": a clear, concise definition (1-3 sentences)

Focus on:
- Technical terms being introduced or defined
- Named theorems, algorithms, or methods
- Domain-specific vocabulary
- Acronyms and abbreviations (with expansion)

Skip common English words and terms that are not specific to the subject matter.
If no glossary-worthy terms are found, return {"terms": []}.
Return ONLY the JSON object. No markdown fences.
"""


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _call_bedrock_extract(chunk_text: str) -> dict[str, Any] | None:
    """Call Bedrock Claude to extract topic + claims from a chunk."""
    kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
    if settings.aws_access_key_id:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    client = boto3.client("bedrock-runtime", **kwargs)

    response = client.converse(
        modelId=settings.bedrock_model_id,
        system=[{"text": TOPIC_EXTRACTION_PROMPT}],
        messages=[{
            "role": "user",
            "content": [{"text": f"## MARKDOWN CHUNK\n\n{chunk_text}"}],
        }],
        inferenceConfig={"maxTokens": 4096, "temperature": 0.2},
    )

    raw = response["output"]["message"]["content"][0]["text"]

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group())
        logger.error("Failed to parse extraction JSON: %s", raw[:200])
        return None


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _call_bedrock_embed(text: str) -> list[float]:
    """Generate a 1024-dim embedding using Titan Embeddings v2."""
    kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
    if settings.aws_access_key_id:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    client = boto3.client("bedrock-runtime", **kwargs)

    response = client.invoke_model(
        modelId=settings.bedrock_embed_model_id,
        contentType="application/json",
        accept="application/json",
        body=json.dumps({"inputText": text, "dimensions": 1024, "normalize": True}),
    )
    result = json.loads(response["body"].read())
    return result["embedding"]


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _call_bedrock_extract_glossary(chunk_text: str) -> list[dict[str, str]]:
    """Call Bedrock Claude to extract glossary terms from a chunk."""
    kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
    if settings.aws_access_key_id:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    client = boto3.client("bedrock-runtime", **kwargs)

    response = client.converse(
        modelId=settings.bedrock_model_id,
        system=[{"text": GLOSSARY_EXTRACTION_PROMPT}],
        messages=[{
            "role": "user",
            "content": [{"text": f"## MARKDOWN CHUNK\n\n{chunk_text}"}],
        }],
        inferenceConfig={"maxTokens": 2048, "temperature": 0.2},
    )

    raw = response["output"]["message"]["content"][0]["text"]
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            data = json.loads(match.group())
        else:
            logger.error("Failed to parse glossary JSON: %s", raw[:200])
            return []

    return data.get("terms", [])


def _find_or_create_glossary_term_sync(
    db: Any,
    workspace_id: int,
    source_doc_id: int,
    term_text: str,
    definition: str,
    embedding: list[float] | None,
    source_ref: dict | None,
) -> None:
    """Insert or deduplicate a glossary term using cosine similarity."""
    from sqlalchemy import text as sa_text
    from app.models.tables import GlossaryTerm

    if embedding is not None:
        result = db.execute(
            sa_text("""
                SELECT id, term, definition, (embedding <=> :emb::vector) as distance
                FROM glossary_terms
                WHERE workspace_id = :ws_id
                  AND embedding IS NOT NULL
                ORDER BY embedding <=> :emb::vector
                LIMIT 1
            """),
            {"emb": str(embedding), "ws_id": workspace_id},
        )
        row = result.fetchone()
        if row is not None:
            similarity = 1.0 - row.distance
            if similarity >= SIMILARITY_THRESHOLD:
                existing = db.get(GlossaryTerm, row.id)
                if existing and len(definition) > len(existing.definition):
                    existing.definition = definition
                return

    existing = db.execute(
        sa_text("SELECT id FROM glossary_terms WHERE workspace_id = :ws_id AND term = :term"),
        {"ws_id": workspace_id, "term": term_text},
    ).fetchone()
    if existing is not None:
        return

    gt = GlossaryTerm(
        workspace_id=workspace_id,
        source_document_id=source_doc_id,
        term=term_text,
        definition=definition,
        source_ref=source_ref,
        is_auto_extracted=True,
        embedding=embedding,
    )
    db.add(gt)
    db.flush()


# ── Download from S3 ─────────────────────────────────────────────────────────


def download_from_s3(s3_key: str) -> bytes:
    """Download a file from S3 and return raw bytes."""
    kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
    if settings.aws_access_key_id:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    s3 = boto3.client("s3", **kwargs)

    response = s3.get_object(Bucket=settings.s3_bucket_name, Key=s3_key)
    return response["Body"].read()


# ── Full pipeline (sync, runs in Celery worker) ─────────────────────────────


def ingest_source_document(
    source_doc_id: int,
    workspace_id: int,
    s3_key: str,
    filename: str,
    content_type: str,
) -> dict:
    """Full ingestion pipeline for a source document.

    1. Download from S3
    2. Parse (PDF → text)
    3. Chunk into sections
    4. For each chunk:
       a. Extract topic + claims via Bedrock
       b. Generate topic embedding
       c. Find or create topic (spec 9.1 consolidation)
       d. Insert claims with embeddings
    5. Update source document status

    Returns summary stats.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.models.tables import AtomicClaim, GlossaryTerm, SourceDocument, Topic

    engine = create_engine(settings.sync_database_url, pool_pre_ping=True)
    Session = sessionmaker(bind=engine)

    stats = {"chunks": 0, "topics_created": 0, "topics_merged": 0, "claims_inserted": 0, "glossary_terms_inserted": 0, "errors": 0}

    # ── 1. Download ──────────────────────────────────────────────────────────
    logger.info("Downloading source doc %s from S3: %s", source_doc_id, s3_key)
    try:
        file_bytes = download_from_s3(s3_key)
    except Exception as exc:
        logger.error("S3 download failed for %s: %s", s3_key, exc)
        with Session() as db:
            doc = db.get(SourceDocument, source_doc_id)
            if doc:
                doc.status = "error"
                doc.metadata_ = {"error": f"S3 download failed: {exc}"}
                db.commit()
        return stats

    # ── 2. Parse (PDF/text) or Transcribe (audio/video) ────────────────────
    logger.info("Parsing %s (%s, %d bytes)", filename, content_type, len(file_bytes))
    with Session() as db:
        doc = db.get(SourceDocument, source_doc_id)
        if doc:
            doc.status = "processing"
            db.commit()

    try:
        if is_audio_file(content_type, filename):
            logger.info("Audio file detected — routing through Transcribe")
            full_text = transcribe_audio_file(s3_key, source_doc_id)
            # Store transcript reference on the source document
            with Session() as db:
                doc = db.get(SourceDocument, source_doc_id)
                if doc:
                    doc.transcript_s3_key = f"transcripts/{source_doc_id}.txt"
                    db.commit()
        else:
            full_text = parse_source_file(file_bytes, content_type, filename)
    except Exception as exc:
        logger.error("Parse/transcribe failed for %s: %s", filename, exc)
        with Session() as db:
            doc = db.get(SourceDocument, source_doc_id)
            if doc:
                doc.status = "error"
                doc.metadata_ = {"error": f"Parse failed: {exc}"}
                db.commit()
        return stats

    if not full_text.strip():
        logger.warning("Empty text extracted from %s", filename)
        with Session() as db:
            doc = db.get(SourceDocument, source_doc_id)
            if doc:
                doc.status = "error"
                doc.metadata_ = {"error": "No text content extracted"}
                db.commit()
        return stats

    # ── 3. Chunk ─────────────────────────────────────────────────────────────
    chunks = chunk_text(full_text)
    stats["chunks"] = len(chunks)
    logger.info("Split into %d chunks", len(chunks))

    # ── 4. Process each chunk ────────────────────────────────────────────────
    with Session() as db:
        # Track topics we've already matched in this run (avoid re-querying)
        topic_cache: dict[str, Topic] = {}

        for chunk in chunks:
            # 4a. Extract topic + claims
            try:
                extraction = _call_bedrock_extract(chunk["text"])
            except Exception:
                logger.error("Bedrock extraction failed after retries for chunk %d", chunk["index"])
                extraction = None
            if extraction is None:
                stats["errors"] += 1
                continue

            topic_title = extraction.get("topic_title") or _extract_topic_title_from_chunk(chunk["text"])
            if not topic_title:
                topic_title = f"Section {chunk['index'] + 1}"
            topic_summary = extraction.get("topic_summary")
            claims_data = extraction.get("claims", [])

            # 4b. Generate topic embedding
            try:
                topic_embedding = _call_bedrock_embed(topic_title + ": " + (topic_summary or ""))
            except Exception:
                logger.warning("Topic embedding failed after retries for '%s'", topic_title)
                topic_embedding = None

            # 4c. Find or create topic (spec 9.1 vector similarity consolidation)
            cache_key = topic_title.lower().strip()
            if cache_key in topic_cache:
                topic = topic_cache[cache_key]
                stats["topics_merged"] += 1
            else:
                existing_count = db.query(Topic).filter(Topic.workspace_id == workspace_id).count()
                topic = _find_or_create_topic_sync(
                    db, workspace_id, topic_title, topic_summary, topic_embedding
                )
                new_count = db.query(Topic).filter(Topic.workspace_id == workspace_id).count()
                topic_cache[cache_key] = topic

                if new_count > existing_count:
                    stats["topics_created"] += 1
                else:
                    stats["topics_merged"] += 1

            # 4d. Insert claims
            for claim_data in claims_data:
                chunk_idx = chunk["index"]
                id_suffix = claim_data.get("id_suffix", f"chunk{chunk_idx}_{len(claims_data)}")
                claim_id = f"claim_{id_suffix}"

                # Check for existing claim (dedup)
                existing = db.get(AtomicClaim, claim_id)
                if existing is not None:
                    continue

                claim_content = claim_data.get("content", "")
                try:
                    claim_embedding = _call_bedrock_embed(claim_content) if claim_content else None
                except Exception:
                    logger.warning("Claim embedding failed after retries for '%s'", claim_id)
                    claim_embedding = None

                claim = AtomicClaim(
                    id=claim_id,
                    topic_id=topic.id,
                    source_document_id=source_doc_id,
                    title=claim_data.get("title", claim_id),
                    content=claim_content,
                    diagnostic_prompt=claim_data.get("diagnostic_prompt"),
                    flawed_snippet=claim_data.get("flawed_snippet"),
                    rubric=claim_data.get("rubric"),
                    embedding=claim_embedding,
                )
                db.merge(claim)
                stats["claims_inserted"] += 1

            # 4e. Extract and insert glossary terms
            try:
                glossary_terms = _call_bedrock_extract_glossary(chunk["text"])
            except Exception:
                logger.error("Glossary extraction failed after retries for chunk %d", chunk["index"])
                glossary_terms = []
            for gt_data in glossary_terms:
                gt_term = gt_data.get("term", "").strip()
                gt_def = gt_data.get("definition", "").strip()
                if not gt_term or not gt_def:
                    continue

                try:
                    gt_embedding = _call_bedrock_embed(f"{gt_term}: {gt_def}")
                except Exception:
                    gt_embedding = None
                source_ref = {
                    "chunk_index": chunk["index"],
                    "text_excerpt": chunk["text"][:200],
                }
                _find_or_create_glossary_term_sync(
                    db, workspace_id, source_doc_id,
                    gt_term, gt_def, gt_embedding, source_ref,
                )
                stats["glossary_terms_inserted"] += 1

        db.commit()

    # ── 5. Update status ─────────────────────────────────────────────────────
    with Session() as db:
        doc = db.get(SourceDocument, source_doc_id)
        if doc:
            doc.status = "ready"
            doc.metadata_ = stats
            db.commit()

    logger.info(
        "Ingestion complete for source_doc %s: %d chunks, %d topics created, %d merged, %d claims",
        source_doc_id,
        stats["chunks"],
        stats["topics_created"],
        stats["topics_merged"],
        stats["claims_inserted"],
    )
    return stats


def _find_or_create_topic_sync(
    db: Any,
    workspace_id: int,
    title: str,
    summary: str | None,
    embedding: list[float] | None,
) -> Any:
    """Sync version of topic matching for Celery context.

    Implements spec 9.1:
      - cosine >= 0.82 with existing topic → reuse it
      - cosine <  0.82 → create new topic
    """
    from sqlalchemy import text as sa_text
    from app.models.tables import Topic

    if embedding is not None:
        # pgvector cosine distance: 1 - cosine_similarity
        # We want similarity >= 0.82, so distance <= 0.18
        result = db.execute(
            sa_text("""
                SELECT id, title, (embedding <=> :emb::vector) as distance
                FROM topics
                WHERE workspace_id = :ws_id
                  AND embedding IS NOT NULL
                ORDER BY embedding <=> :emb::vector
                LIMIT 1
            """),
            {"emb": str(embedding), "ws_id": workspace_id},
        )
        row = result.fetchone()
        if row is not None:
            similarity = 1.0 - row.distance
            if similarity >= SIMILARITY_THRESHOLD:
                logger.info("Matched chunk to existing topic '%s' (sim=%.3f)", row.title, similarity)
                existing = db.get(Topic, row.id)
                if existing and summary and (not existing.summary or len(summary) > len(existing.summary)):
                    existing.summary = summary
                return existing

    # Create new topic
    slug = re.sub(r"[^a-z0-9\s-]", "", title.lower().strip())
    slug = re.sub(r"[\s]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    topic_id = f"top_{slug}"

    existing = db.get(Topic, topic_id)
    if existing is not None:
        return existing

    topic = Topic(
        id=topic_id,
        workspace_id=workspace_id,
        slug=slug,
        title=title,
        summary=summary,
        embedding=embedding,
    )
    db.add(topic)
    db.flush()
    return topic
