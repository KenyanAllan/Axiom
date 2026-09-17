"""Vector search endpoint — semantic search over topics and atomic claims."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models.tables import Topic, AtomicClaim
from app.services.bedrock import generate_embedding

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/search", tags=["search"])


# ── Pydantic schemas ────────────────────────────────────────────────────────────


class SearchRequest(BaseModel):
    query: str
    workspace_id: int
    limit: int = Field(default=10, ge=1, le=50)


class SearchResultItem(BaseModel):
    type: str  # "topic" or "claim"
    id: str
    title: str
    content: str | None = None
    similarity: float
    topic_id: str | None = None
    workspace_id: int | None = None

    model_config = {"from_attributes": True}


class SearchResponse(BaseModel):
    query: str
    results: list[SearchResultItem]
    total: int


# ── POST /api/search ─────────────────────────────────────────────────────────


@router.post("", response_model=SearchResponse)
@limiter.limit("30/minute")
async def search(
    request: Request,
    body: SearchRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SearchResponse:
    """Semantic search across topics and atomic claims using pgvector."""

    # Generate embedding (sync call wrapped in asyncio.to_thread)
    try:
        query_embedding = await asyncio.to_thread(generate_embedding, body.query)
    except Exception as exc:
        logger.error("Embedding generation failed for search: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Search temporarily unavailable — embedding service error.",
        )

    # ── Search topics ────────────────────────────────────────────────────────
    topic_query = (
        select(
            Topic.id,
            Topic.title,
            Topic.summary,
            Topic.workspace_id,
            Topic.embedding.cosine_distance(query_embedding).label("distance"),
        )
        .where(Topic.embedding.isnot(None))
        .order_by("distance")
        .limit(body.limit)
    )
    topic_query = topic_query.where(Topic.workspace_id == body.workspace_id)

    topic_results = await db.execute(topic_query)
    topic_rows = topic_results.all()

    # ── Search atomic claims ─────────────────────────────────────────────────
    claim_query = (
        select(
            AtomicClaim.id,
            AtomicClaim.title,
            AtomicClaim.content,
            AtomicClaim.topic_id,
            AtomicClaim.embedding.cosine_distance(query_embedding).label("distance"),
        )
        .where(AtomicClaim.embedding.isnot(None))
        .order_by("distance")
        .limit(body.limit)
    )
    # Always filter claims by workspace
    claim_query = claim_query.join(Topic, AtomicClaim.topic_id == Topic.id).where(
        Topic.workspace_id == body.workspace_id
    )

    claim_results = await db.execute(claim_query)
    claim_rows = claim_results.all()

    # ── Merge and rank by similarity ─────────────────────────────────────────
    results: list[SearchResultItem] = []

    for row in topic_rows:
        results.append(
            SearchResultItem(
                type="topic",
                id=row.id,
                title=row.title,
                content=row.summary,
                similarity=round(1.0 - row.distance, 4),
                workspace_id=row.workspace_id,
            )
        )

    for row in claim_rows:
        results.append(
            SearchResultItem(
                type="claim",
                id=row.id,
                title=row.title,
                content=row.content,
                similarity=round(1.0 - row.distance, 4),
                topic_id=row.topic_id,
            )
        )

    # Sort combined results by similarity descending
    results.sort(key=lambda r: r.similarity, reverse=True)

    # Trim to requested limit
    results = results[: body.limit]

    return SearchResponse(
        query=body.query,
        results=results,
        total=len(results),
    )
