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
from botocore.exceptions import ClientError
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

SIMILARITY_THRESHOLD = 0.82
TARGET_CHUNK_TOKENS = 800
MAX_CHUNK_TOKENS = 1200
OVERLAP_TOKENS = 100
MIN_CHARS_PER_PAGE_THRESHOLD = 50

MIN_FIGURE_WIDTH = 100
MIN_FIGURE_HEIGHT = 100
MIN_FIGURE_BYTES = 2000
FIGURE_CLAIM_SIMILARITY_THRESHOLD = 0.75


# ── PDF parsing ──────────────────────────────────────────────────────────────


def parse_pdf_to_text(pdf_bytes: bytes) -> str:
    """Fallback: extract text from a PDF using PyMuPDF (fitz).

    Used when Textract is unavailable or the file is not in S3.
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


def textract_pdf_to_text(s3_key: str, source_doc_id: int) -> str:
    """Extract text from a PDF in S3 using AWS Textract (OCR-capable).

    Polls every 15 seconds, up to 10 minutes max.
    Falls back to PyMuPDF on failure.
    """
    from app.services.textract import (
        get_detected_text,
        get_text_detection_status,
        start_text_detection,
    )

    job_id = start_text_detection(s3_key, source_doc_id)
    logger.info("Started Textract job %s for source_doc %s", job_id, source_doc_id)

    max_wait = 600
    poll_interval = 15
    elapsed = 0

    while elapsed < max_wait:
        time.sleep(poll_interval)
        elapsed += poll_interval

        status = get_text_detection_status(job_id)
        logger.info("Textract %s status: %s (%ds elapsed)", job_id, status["status"], elapsed)

        if status["status"] == "SUCCEEDED":
            text = get_detected_text(job_id)
            if text:
                logger.info("Textract complete for %s: %d chars", job_id, len(text))
                return text
            return ""

        if status["status"] == "FAILED":
            raise RuntimeError(f"Textract job {job_id} failed")

    raise TimeoutError(f"Textract job {job_id} timed out after {max_wait}s")


AUDIO_CONTENT_TYPES = {
    "audio/mpeg", "audio/mp3", "audio/mp4", "audio/wav", "audio/x-wav",
    "audio/ogg", "audio/flac", "audio/webm", "video/mp4", "video/webm",
}

AUDIO_EXTENSIONS = {".mp3", ".mp4", ".wav", ".ogg", ".flac", ".webm", ".m4a"}

IMAGE_CONTENT_TYPES = {
    "image/png", "image/jpeg", "image/tiff", "image/bmp", "image/gif", "image/heic",
}

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".gif", ".heic"}


def is_audio_file(content_type: str, filename: str) -> bool:
    """Check if the file is an audio/video type that needs transcription."""
    if content_type in AUDIO_CONTENT_TYPES:
        return True
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in AUDIO_EXTENSIONS


def is_image_file(content_type: str, filename: str) -> bool:
    """Check if the file is an image type that needs OCR."""
    if content_type in IMAGE_CONTENT_TYPES:
        return True
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in IMAGE_EXTENSIONS


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


def _is_pdf_text_sufficient(text: str, pdf_bytes: bytes) -> bool:
    """Check if PyMuPDF extracted enough text to skip Textract."""
    import fitz

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page_count = max(doc.page_count, 1)
    doc.close()

    avg_chars_per_page = len(text.strip()) / page_count
    logger.debug(
        "PDF text sufficiency: %d chars across %d pages (avg %.1f chars/page, threshold %d)",
        len(text.strip()),
        page_count,
        avg_chars_per_page,
        MIN_CHARS_PER_PAGE_THRESHOLD,
    )
    return avg_chars_per_page >= MIN_CHARS_PER_PAGE_THRESHOLD


def parse_source_file(
    file_bytes: bytes,
    content_type: str,
    filename: str,
    s3_key: str | None = None,
    source_doc_id: int | None = None,
) -> str:
    """Route to the correct parser based on content type.

    For PDFs, tries PyMuPDF first; falls back to Textract for scanned/image PDFs
    when s3_key and source_doc_id are provided.
    """
    if content_type == "application/pdf" or filename.lower().endswith(".pdf"):
        text = parse_pdf_to_text(file_bytes)

        if not _is_pdf_text_sufficient(text, file_bytes) and s3_key and source_doc_id:
            logger.info(
                "PyMuPDF extraction insufficient for %s — falling back to Textract",
                filename,
            )
            text = textract_pdf_to_text(s3_key, source_doc_id)

        return text

    if is_image_file(content_type, filename):
        from app.services.textract import detect_image_text_sync
        return detect_image_text_sync(file_bytes)

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


def _is_retryable(exc: BaseException) -> bool:
    """Return False for non-retryable AWS errors to avoid wasting retry budget."""
    if isinstance(exc, ClientError):
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("AccessDeniedException", "ValidationException", "ResourceNotFoundException"):
            return False
    return True


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10), retry=retry_if_exception(_is_retryable))
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


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10), retry=retry_if_exception(_is_retryable))
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


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10), retry=retry_if_exception(_is_retryable))
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


# ── Figure extraction ──────────────────────────────────────────────────────


FIGURE_CAPTION_PROMPT = """\
You are a figure analysis engine for an educational platform.

Given an image extracted from an educational document, analyze it and return a JSON object with:
- "caption": A concise, informative caption (1-2 sentences) describing what the figure shows and its educational significance.
- "figure_type": One of: "diagram", "chart", "graph", "table", "equation", "photo", "illustration", "flowchart", "map", "screenshot", "unknown"
- "is_decorative": true if this is a logo, icon, page decoration, watermark, or other non-educational image; false otherwise.

Return ONLY the JSON object. No markdown fences.
"""


def extract_figures_from_pdf(
    pdf_bytes: bytes, source_doc_id: int, workspace_id: int,
) -> list[dict]:
    """Extract embedded images from a PDF using PyMuPDF.

    Filters out small/decorative images by dimension and byte-size thresholds.
    Uploads each figure to S3 and returns metadata dicts.
    """
    import fitz
    from app.services.s3 import upload_bytes

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    figures: list[dict] = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        image_list = page.get_images(full=True)

        for img_idx, img_info in enumerate(image_list):
            xref = img_info[0]
            try:
                img_data = doc.extract_image(xref)
            except Exception:
                continue

            image_bytes = img_data["image"]
            width = img_data.get("width", 0)
            height = img_data.get("height", 0)
            ext = img_data.get("ext", "png")

            if width < MIN_FIGURE_WIDTH or height < MIN_FIGURE_HEIGHT:
                continue
            if len(image_bytes) < MIN_FIGURE_BYTES:
                continue

            ct_map = {"png": "image/png", "jpeg": "image/jpeg", "jpg": "image/jpeg",
                      "gif": "image/gif", "webp": "image/webp", "tiff": "image/tiff"}
            content_type = ct_map.get(ext, f"image/{ext}")

            s3_key = f"figures/{workspace_id}/{source_doc_id}/p{page_num + 1}_{img_idx}.{ext}"
            try:
                upload_bytes(s3_key, image_bytes, content_type)
            except Exception as exc:
                logger.warning("Failed to upload figure to S3 (%s): %s", s3_key, exc)
                continue

            figures.append({
                "s3_key": s3_key,
                "content_type": content_type,
                "page_number": page_num + 1,
                "width": width,
                "height": height,
                "size_bytes": len(image_bytes),
                "image_bytes": image_bytes,
            })

    doc.close()
    logger.info("Extracted %d figure candidates from PDF (source_doc %s)", len(figures), source_doc_id)
    return figures


def extract_figure_from_image_upload(
    file_bytes: bytes, content_type: str, source_doc_id: int, workspace_id: int,
) -> list[dict]:
    """Treat a standalone image upload as a single figure."""
    from app.services.s3 import upload_bytes

    ext_map = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
               "image/webp": "webp", "image/tiff": "tiff", "image/bmp": "bmp"}
    ext = ext_map.get(content_type, "png")

    width, height = None, None
    try:
        from PIL import Image as PILImage
        import io
        img = PILImage.open(io.BytesIO(file_bytes))
        width, height = img.size
    except Exception:
        pass

    s3_key = f"figures/{workspace_id}/{source_doc_id}/full.{ext}"
    upload_bytes(s3_key, file_bytes, content_type)

    return [{
        "s3_key": s3_key,
        "content_type": content_type,
        "page_number": None,
        "width": width,
        "height": height,
        "size_bytes": len(file_bytes),
        "image_bytes": file_bytes,
    }]


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _call_bedrock_caption_figure(image_bytes: bytes, content_type: str) -> dict:
    """Send an image to Bedrock Claude for captioning and classification."""
    kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
    if settings.aws_access_key_id:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    client = boto3.client("bedrock-runtime", **kwargs)

    fmt_map = {"image/jpeg": "jpeg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"}
    fmt = fmt_map.get(content_type, "jpeg")

    response = client.converse(
        modelId=settings.bedrock_model_id,
        system=[{"text": FIGURE_CAPTION_PROMPT}],
        messages=[{
            "role": "user",
            "content": [
                {"image": {"format": fmt, "source": {"bytes": image_bytes}}},
                {"text": "Analyze this figure from an educational document."},
            ],
        }],
        inferenceConfig={"maxTokens": 1024, "temperature": 0.1},
    )

    raw = response["output"]["message"]["content"][0]["text"]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.DOTALL)
        if match:
            return json.loads(match.group())
        return {"caption": raw[:200], "figure_type": "unknown", "is_decorative": False}


def _analyze_and_store_figure(
    db: Any,
    fig_data: dict,
    workspace_id: int,
    source_doc_id: int,
) -> None:
    """Analyze a single extracted figure and store it in the database."""
    from app.models.tables import Figure, FigureClaim
    from app.services.rekognition import detect_image_labels, detect_image_text

    image_bytes = fig_data["image_bytes"]

    labels = []
    ocr_text = ""
    try:
        labels = detect_image_labels(image_bytes)
    except Exception as exc:
        logger.warning("Rekognition labels failed for figure %s: %s", fig_data["s3_key"], exc)
    try:
        ocr_text = detect_image_text(image_bytes)
    except Exception as exc:
        logger.warning("Rekognition text failed for figure %s: %s", fig_data["s3_key"], exc)

    try:
        caption_result = _call_bedrock_caption_figure(image_bytes, fig_data["content_type"])
    except Exception as exc:
        logger.warning("Figure captioning failed for %s: %s", fig_data["s3_key"], exc)
        caption_result = {"caption": "Extracted figure", "figure_type": "unknown", "is_decorative": False}

    caption = caption_result.get("caption", "Extracted figure")
    figure_type = caption_result.get("figure_type", "unknown")
    is_decorative = caption_result.get("is_decorative", False)

    embedding = None
    if not is_decorative:
        try:
            embedding = _call_bedrock_embed(caption)
        except Exception as exc:
            logger.warning("Figure embedding failed for %s: %s", fig_data["s3_key"], exc)

    figure = Figure(
        workspace_id=workspace_id,
        source_document_id=source_doc_id,
        s3_key=fig_data["s3_key"],
        content_type=fig_data["content_type"],
        page_number=fig_data.get("page_number"),
        caption=caption,
        figure_type=figure_type,
        labels=labels if labels else None,
        ocr_text=ocr_text if ocr_text else None,
        embedding=embedding,
        width=fig_data.get("width"),
        height=fig_data.get("height"),
        size_bytes=fig_data.get("size_bytes"),
        is_decorative=is_decorative,
    )
    db.add(figure)
    db.flush()

    if not is_decorative and embedding is not None:
        _associate_figure_with_claims(db, figure.id, embedding, workspace_id)


def _associate_figure_with_claims(
    db: Any,
    figure_id: int,
    figure_embedding: list[float],
    workspace_id: int,
) -> None:
    """Link a figure to semantically related claims via cosine similarity."""
    from sqlalchemy import text as sa_text
    from app.models.tables import FigureClaim

    result = db.execute(
        sa_text("""
            SELECT ac.id, (ac.embedding <=> :emb::vector) as distance
            FROM atomic_claims ac
            JOIN source_documents sd ON ac.source_document_id = sd.id
            WHERE sd.workspace_id = :ws_id
              AND ac.embedding IS NOT NULL
            ORDER BY ac.embedding <=> :emb::vector
            LIMIT 5
        """),
        {"emb": str(figure_embedding), "ws_id": workspace_id},
    )

    for row in result.fetchall():
        similarity = 1.0 - row.distance
        if similarity >= FIGURE_CLAIM_SIMILARITY_THRESHOLD:
            fc = FigureClaim(
                figure_id=figure_id,
                claim_id=row.id,
                similarity_score=round(similarity, 4),
            )
            db.add(fc)


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

    stats: dict = {"chunks": 0, "topics_created": 0, "topics_merged": 0, "claims_inserted": 0, "glossary_terms_inserted": 0, "figures_extracted": 0, "errors": 0, "avg_complexity": None}

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
            with Session() as db:
                doc = db.get(SourceDocument, source_doc_id)
                if doc:
                    doc.transcript_s3_key = f"transcripts/{source_doc_id}.txt"
                    db.commit()
        elif is_image_file(content_type, filename):
            logger.info("Image file detected — routing through Textract + Rekognition")
            from app.services.textract import detect_image_text_sync
            from app.services.rekognition import detect_image_text as rekog_detect_text
            from app.services.rekognition import detect_image_labels

            ocr_bytes = file_bytes
            if filename.lower().endswith(".heic"):
                try:
                    from PIL import Image as PILImage
                    import io
                    img = PILImage.open(io.BytesIO(file_bytes))
                    buf = io.BytesIO()
                    img.convert("RGB").save(buf, format="JPEG", quality=90)
                    ocr_bytes = buf.getvalue()
                    logger.info("Converted HEIC to JPEG for OCR (%d bytes)", len(ocr_bytes))
                except Exception as conv_exc:
                    logger.warning("HEIC conversion failed (%s), attempting raw OCR", conv_exc)

            textract_text = detect_image_text_sync(ocr_bytes)

            try:
                rekog_text = rekog_detect_text(ocr_bytes)
                textract_lines = set(textract_text.strip().splitlines())
                rekog_extra = [l for l in rekog_text.strip().splitlines() if l not in textract_lines]
                if rekog_extra:
                    textract_text += "\n\n" + "\n".join(rekog_extra)
            except Exception as rekog_exc:
                logger.warning("Rekognition DetectText failed (%s), using Textract only", rekog_exc)

            try:
                labels = detect_image_labels(ocr_bytes)
                with Session() as db:
                    doc = db.get(SourceDocument, source_doc_id)
                    if doc:
                        doc.metadata_ = {**(doc.metadata_ or {}), "image_labels": labels}
                        db.commit()
            except Exception as label_exc:
                logger.warning("Rekognition DetectLabels failed (%s), skipping", label_exc)

            full_text = textract_text
        elif content_type == "application/pdf" or filename.lower().endswith(".pdf"):
            logger.info("PDF detected — routing through Textract for OCR")
            try:
                full_text = textract_pdf_to_text(s3_key, source_doc_id)
            except Exception as exc:
                logger.warning("Textract failed (%s), falling back to PyMuPDF", exc)
                full_text = parse_pdf_to_text(file_bytes)
        else:
            full_text = parse_source_file(
                file_bytes, content_type, filename,
                s3_key=s3_key, source_doc_id=source_doc_id,
            )
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

    # ── 2b. Language detection & translation ───────────────────────────────
    source_language = "en"
    full_text_original = full_text
    try:
        from app.services.translate import detect_language, translate_text as _translate

        source_language = detect_language(full_text[:1000])
        if source_language != "en":
            logger.info("Non-English source detected (%s) — translating to English for embedding", source_language)
            full_text = _translate(full_text, source_language, "en", [settings.translate_terminology_name])
            stats["source_language"] = source_language
    except Exception as exc:
        logger.warning("Language detection/translation failed: %s — proceeding in original language", exc)

    # ── 2c. Extract figures from PDFs and images ────────────────────────────
    figures_extracted: list[dict] = []
    try:
        if content_type == "application/pdf" or filename.lower().endswith(".pdf"):
            figures_extracted = extract_figures_from_pdf(file_bytes, source_doc_id, workspace_id)
        elif is_image_file(content_type, filename):
            figures_extracted = extract_figure_from_image_upload(
                file_bytes, content_type, source_doc_id, workspace_id,
            )
        if figures_extracted:
            logger.info("Extracted %d figure candidates from %s", len(figures_extracted), filename)
    except Exception as exc:
        logger.warning("Figure extraction failed for %s: %s — continuing", filename, exc)

    # ── 3. Chunk ─────────────────────────────────────────────────────────────
    chunks = chunk_text(full_text)
    stats["chunks"] = len(chunks)
    logger.info("Split into %d chunks", len(chunks))

    # ── 4. Process each chunk ────────────────────────────────────────────────
    with Session() as db:
        # Track topics we've already matched in this run (avoid re-querying)
        topic_cache: dict[str, Topic] = {}
        topic_chunk_counts: dict[str, int] = {}

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

            # 4c-ii. Compute chunk complexity and apply to topic (true running avg)
            try:
                from app.services.comprehend import compute_complexity_score
                chunk_complexity = compute_complexity_score(
                    chunk["text"][:5000], settings.comprehend_language_code,
                )
                topic_chunk_key = cache_key + "_n"
                if topic.complexity_score is None:
                    topic.complexity_score = chunk_complexity
                    topic_chunk_counts[topic_chunk_key] = 1
                else:
                    n = topic_chunk_counts.get(topic_chunk_key, 1)
                    topic.complexity_score = round(
                        (topic.complexity_score * n + chunk_complexity) / (n + 1), 1,
                    )
                    topic_chunk_counts[topic_chunk_key] = n + 1
            except Exception as exc:
                logger.warning("Complexity scoring failed for chunk %d: %s", chunk["index"], exc)

            # 4d. Insert claims
            for claim_idx, claim_data in enumerate(claims_data):
                chunk_idx = chunk["index"]
                id_suffix = claim_data.get("id_suffix", f"chunk{chunk_idx}_{claim_idx}")
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

                claim_complexity = None
                try:
                    from app.services.comprehend import compute_complexity_score as _cc
                    if claim_content and len(claim_content) >= 50:
                        claim_complexity = _cc(claim_content, settings.comprehend_language_code)
                    else:
                        claim_complexity = topic.complexity_score
                except Exception:
                    pass

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
                    original_language=source_language if source_language != "en" else None,
                    original_content=claim_content if source_language != "en" else None,
                    complexity_score=claim_complexity,
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

    # ── 4f. Analyze and store extracted figures ──────────────────────────────
    if figures_extracted:
        with Session() as db:
            for fig_data in figures_extracted:
                try:
                    _analyze_and_store_figure(db, fig_data, workspace_id, source_doc_id)
                except Exception as exc:
                    logger.warning("Figure analysis failed for %s: %s", fig_data.get("s3_key"), exc)
                    stats["errors"] += 1
            db.commit()
        stats["figures_extracted"] = len(figures_extracted)

    # Compute average complexity across topics
    topic_scores = [t.complexity_score for t in topic_cache.values() if t.complexity_score is not None]
    if topic_scores:
        stats["avg_complexity"] = round(sum(topic_scores) / len(topic_scores), 1)

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
