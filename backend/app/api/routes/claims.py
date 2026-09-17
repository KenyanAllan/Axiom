"""AtomicClaim endpoints — CRUD for claims within topics."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_topic, verify_workspace_access
from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.tables import AtomicClaim, Topic

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/claims", tags=["claims"])


# ── Schemas ────────────────────────────────────────────────────────────────────


class ClaimCreateRequest(BaseModel):
    topic_id: str
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)
    diagnostic_prompt: str | None = None
    flawed_snippet: str | None = None
    rubric: str | None = None


class ClaimUpdateRequest(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    content: str | None = Field(None, min_length=1)
    diagnostic_prompt: str | None = None
    flawed_snippet: str | None = None
    rubric: str | None = None


class ClaimResponse(BaseModel):
    id: str
    topic_id: str
    source_document_id: int | None = None
    title: str
    content: str
    diagnostic_prompt: str | None = None
    flawed_snippet: str | None = None
    rubric: str | None = None

    model_config = {"from_attributes": True}


# ── POST /api/claims ───────────────────────────────────────────────────────────


@router.post("", response_model=ClaimResponse, status_code=201)
async def create_claim(
    body: ClaimCreateRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClaimResponse:
    """Create a new atomic claim under an existing topic."""
    topic = await resolve_topic(db, body.topic_id)
    if topic is None:
        raise HTTPException(status_code=404, detail=f"Topic '{body.topic_id}' not found")

    # Verify workspace access through the topic's workspace
    if topic.workspace_id is not None:
        await verify_workspace_access(db, topic.workspace_id, user_id)

    import re
    slug = re.sub(r"[^a-z0-9\s]", "", body.title.lower().strip())
    slug = re.sub(r"\s+", "_", slug)[:60]
    claim_id = f"claim_{slug}"

    existing = await db.get(AtomicClaim, claim_id)
    if existing is not None:
        raise HTTPException(status_code=409, detail=f"Claim '{claim_id}' already exists")

    # Generate embedding if Bedrock is reachable
    embedding = None
    try:
        from app.services.bedrock import generate_embedding
        import asyncio
        embedding = await asyncio.to_thread(generate_embedding, body.content)
    except Exception:
        logger.warning("Embedding generation failed for claim '%s', continuing without", claim_id)

    claim = AtomicClaim(
        id=claim_id,
        topic_id=topic.id,
        title=body.title,
        content=body.content,
        diagnostic_prompt=body.diagnostic_prompt,
        flawed_snippet=body.flawed_snippet,
        rubric=body.rubric,
        embedding=embedding,
    )
    db.add(claim)
    await db.flush()
    await db.refresh(claim)

    logger.info("Created claim '%s' under topic '%s'", claim_id, topic.id)
    return ClaimResponse.model_validate(claim)


# ── GET /api/claims ────────────────────────────────────────────────────────────


@router.get("", response_model=list[ClaimResponse])
async def list_claims(
    topic_id: str | None = Query(None, description="Filter by topic ID"),
    workspace_id: int | None = Query(None, description="Filter by workspace ID"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ClaimResponse]:
    """List atomic claims, filtered by topic or workspace."""
    if topic_id is None and workspace_id is None:
        raise HTTPException(
            status_code=400,
            detail="Either topic_id or workspace_id query parameter is required",
        )

    stmt = select(AtomicClaim)

    if topic_id is not None:
        # Verify workspace access through the topic
        topic = await resolve_topic(db, topic_id)
        if topic is not None and topic.workspace_id is not None:
            await verify_workspace_access(db, topic.workspace_id, user_id)
        stmt = stmt.where(AtomicClaim.topic_id == topic_id)
    elif workspace_id is not None:
        await verify_workspace_access(db, workspace_id, user_id)
        stmt = stmt.join(Topic, AtomicClaim.topic_id == Topic.id).where(
            Topic.workspace_id == workspace_id
        )

    stmt = stmt.order_by(AtomicClaim.topic_id, AtomicClaim.id).offset(offset).limit(limit)
    result = await db.execute(stmt)
    claims = result.scalars().all()

    return [ClaimResponse.model_validate(c) for c in claims]


# ── GET /api/claims/{claim_id} ─────────────────────────────────────────────────


@router.get("/{claim_id}", response_model=ClaimResponse)
async def get_claim(
    claim_id: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClaimResponse:
    """Get a single atomic claim by ID."""
    claim = await db.get(AtomicClaim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail=f"Claim '{claim_id}' not found")

    # Verify workspace access through the claim's topic
    topic = await db.get(Topic, claim.topic_id)
    if topic is not None and topic.workspace_id is not None:
        await verify_workspace_access(db, topic.workspace_id, user_id)

    return ClaimResponse.model_validate(claim)


# ── PUT /api/claims/{claim_id} ─────────────────────────────────────────────────


@router.put("/{claim_id}", response_model=ClaimResponse)
async def update_claim(
    claim_id: str,
    body: ClaimUpdateRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ClaimResponse:
    """Update an atomic claim's content fields."""
    claim = await db.get(AtomicClaim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail=f"Claim '{claim_id}' not found")

    # Verify workspace access through the claim's topic
    topic = await db.get(Topic, claim.topic_id)
    if topic is not None and topic.workspace_id is not None:
        await verify_workspace_access(db, topic.workspace_id, user_id)

    updated_content = False
    if body.title is not None:
        claim.title = body.title
    if body.content is not None:
        claim.content = body.content
        updated_content = True
    if body.diagnostic_prompt is not None:
        claim.diagnostic_prompt = body.diagnostic_prompt
    if body.flawed_snippet is not None:
        claim.flawed_snippet = body.flawed_snippet
    if body.rubric is not None:
        claim.rubric = body.rubric

    # Re-generate embedding if content changed
    if updated_content:
        try:
            from app.services.bedrock import generate_embedding
            import asyncio
            claim.embedding = await asyncio.to_thread(generate_embedding, claim.content)
        except Exception:
            logger.warning("Embedding re-generation failed for claim '%s'", claim_id)

    await db.flush()
    await db.refresh(claim)

    logger.info("Updated claim '%s'", claim_id)
    return ClaimResponse.model_validate(claim)


# ── DELETE /api/claims/{claim_id} ──────────────────────────────────────────────


@router.delete("/{claim_id}", status_code=204)
async def delete_claim(
    claim_id: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete an atomic claim. Mastery records cascade via FK."""
    claim = await db.get(AtomicClaim, claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail=f"Claim '{claim_id}' not found")

    # Verify workspace access through the claim's topic
    topic = await db.get(Topic, claim.topic_id)
    if topic is not None and topic.workspace_id is not None:
        await verify_workspace_access(db, topic.workspace_id, user_id)

    await db.delete(claim)
    await db.flush()

    logger.info("Deleted claim '%s'", claim_id)
    return Response(status_code=204)
