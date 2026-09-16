"""Celery application and ingestion task."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from celery import Celery
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# ── Celery app ──────────────────────────────────────────────────────────────────

celery_app = Celery(
    "axiom",
    broker=settings.redis_url,
    backend=settings.redis_url,
)
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_routes={
        "app.workers.celery_app.ingest_markdown_chunk": {"queue": "ingestion"},
        "app.workers.celery_app.ingest_source_document_task": {"queue": "ingestion"},
    },
)

# Sync engine for Celery (Celery is sync; no asyncpg here)
sync_engine = create_engine(settings.sync_database_url, pool_pre_ping=True)
SyncSession = sessionmaker(bind=sync_engine)


# ── Ingestion task ──────────────────────────────────────────────────────────────

EXTRACTION_PROMPT = """\
You are a knowledge-graph extraction engine for a technical learning platform.

Given a MARKDOWN CHUNK from a textbook, extract atomic claims — the smallest
independently testable factual assertions.

For each claim, return a JSON array of objects with:
- "id_suffix": a short snake_case slug (e.g. "gauss_elim_pivot_rule")
- "title": a concise title (< 80 chars)
- "content": the full factual statement (1-3 sentences)
- "diagnostic_prompt": a "Wrong on Purpose" prompt asking the student to
  identify what is wrong with a deliberately flawed snippet
- "flawed_snippet": a code or math snippet containing a subtle intentional error
  related to this claim
- "rubric": 2-4 sentence acceptance criteria for a correct student diagnosis

Return ONLY the JSON array. No markdown fences.
"""


@celery_app.task(bind=True, max_retries=3, default_retry_delay=30)
def ingest_markdown_chunk(
    self,
    topic_id: str,
    markdown_text: str,
) -> dict:
    """Extract atomic claims from a markdown chunk and persist to Aurora.

    Steps:
      1. Call Bedrock Claude to extract claims.
      2. Call Bedrock Titan to generate embeddings for each claim.
      3. Insert claims into the atomic_claims table.
    """
    from app.models.tables import AtomicClaim  # noqa: local import avoids circular
    from app.services.bedrock import generate_embedding, grade_response

    # Re-use grade_response infra to call Bedrock for extraction
    # (We call the Converse API with a different system prompt.)
    import boto3

    client = boto3.client("bedrock-runtime", region_name=settings.aws_default_region)

    try:
        response = client.converse(
            modelId=settings.bedrock_model_id,
            system=[{"text": EXTRACTION_PROMPT}],
            messages=[
                {
                    "role": "user",
                    "content": [{"text": f"## MARKDOWN CHUNK\n\n{markdown_text}"}],
                }
            ],
            inferenceConfig={"maxTokens": 4096, "temperature": 0.2},
        )

        raw = response["output"]["message"]["content"][0]["text"]
        claims_data = json.loads(raw)
    except Exception as exc:
        logger.error("Bedrock extraction failed: %s", exc)
        raise self.retry(exc=exc)

    # Persist to DB
    inserted = 0
    with SyncSession() as db:
        for claim in claims_data:
            claim_id = f"claim_{claim['id_suffix']}"

            # Generate embedding for the claim content
            try:
                embedding = generate_embedding(claim["content"])
            except Exception:
                logger.warning("Embedding failed for %s, skipping", claim_id)
                embedding = None

            obj = AtomicClaim(
                id=claim_id,
                topic_id=topic_id,
                title=claim["title"],
                content=claim["content"],
                diagnostic_prompt=claim.get("diagnostic_prompt"),
                flawed_snippet=claim.get("flawed_snippet"),
                rubric=claim.get("rubric"),
                embedding=embedding,
            )
            db.merge(obj)  # upsert
            inserted += 1

        db.commit()

    logger.info("Ingested %d claims for topic %s", inserted, topic_id)
    return {"topic_id": topic_id, "claims_inserted": inserted}


@celery_app.task(bind=True, max_retries=2, default_retry_delay=60)
def ingest_source_document_task(
    self,
    source_doc_id: int,
    workspace_id: int,
    s3_key: str,
    filename: str,
    content_type: str,
) -> dict:
    """Celery wrapper for the full source document ingestion pipeline."""
    from app.services.ingestion import ingest_source_document

    try:
        return ingest_source_document(
            source_doc_id=source_doc_id,
            workspace_id=workspace_id,
            s3_key=s3_key,
            filename=filename,
            content_type=content_type,
        )
    except Exception as exc:
        logger.error("Source document ingestion failed for doc %s: %s", source_doc_id, exc)
        raise self.retry(exc=exc)
