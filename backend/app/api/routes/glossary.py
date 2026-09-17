"""Glossary term endpoints — CRUD and semantic search."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.api.deps import verify_workspace_access
from app.models.tables import GlossaryTerm, User, Workspace
from app.schemas.glossary import (
    GlossarySearchRequest,
    GlossarySearchResponse,
    GlossaryTermCreate,
    GlossaryTermResponse,
    GlossaryTermUpdate,
)
from app.services.bedrock import generate_embedding

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/glossary", tags=["glossary"])


# ── Helpers ──────────────────────────────────────────────────────────────────────


async def _verify_workspace_access(
    db: AsyncSession, workspace_id: int, user_id: str
) -> Workspace:
    result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workbench not found")
    if workspace.user_id == user_id:
        return workspace
    if workspace.classroom_id is not None:
        from app.models.tables import Classroom, ClassroomStudent
        classroom = await db.get(Classroom, workspace.classroom_id)
        if classroom and classroom.teacher_id == user_id:
            return workspace
        enrolled = await db.execute(
            select(ClassroomStudent).where(
                ClassroomStudent.classroom_id == workspace.classroom_id,
                ClassroomStudent.student_id == user_id,
            )
        )
        if enrolled.scalar_one_or_none() is not None:
            return workspace
    raise HTTPException(status_code=403, detail="Not your workbench")


async def _require_teacher(db: AsyncSession, user_id: str) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "student":
        raise HTTPException(status_code=403, detail="Students cannot modify glossary terms")
    return user


# ── GET /api/glossary ────────────────────────────────────────────────────────


@router.get("", response_model=list[GlossaryTermResponse])
async def list_glossary_terms(
    workspace_id: int = Query(..., description="Workbench to list terms for"),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[GlossaryTermResponse]:
    """List all glossary terms for a workspace, ordered alphabetically."""
    stmt = (
        select(GlossaryTerm)
        .where(GlossaryTerm.workspace_id == workspace_id)
        .order_by(GlossaryTerm.term)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [GlossaryTermResponse.model_validate(r) for r in rows]


# ── GET /api/glossary/{term_id} ──────────────────────────────────────────────


@router.get("/{term_id}", response_model=GlossaryTermResponse)
async def get_glossary_term(
    term_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GlossaryTermResponse:
    """Get a single glossary term by ID."""
    term = await db.get(GlossaryTerm, term_id)
    if term is None:
        raise HTTPException(status_code=404, detail="Glossary term not found")
    return GlossaryTermResponse.model_validate(term)


# ── POST /api/glossary ──────────────────────────────────────────────────────


@router.post("", response_model=GlossaryTermResponse, status_code=201)
async def create_glossary_term(
    body: GlossaryTermCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GlossaryTermResponse:
    """Manually create a glossary term (teacher only)."""
    await _require_teacher(db, user_id)
    await _verify_workspace_access(db, body.workspace_id, user_id)

    existing = (
        await db.execute(
            select(GlossaryTerm).where(
                GlossaryTerm.workspace_id == body.workspace_id,
                GlossaryTerm.term == body.term,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Term already exists in this workspace")

    try:
        embedding = await asyncio.to_thread(
            generate_embedding, f"{body.term}: {body.definition}"
        )
    except Exception:
        logger.error("Embedding generation failed for glossary term '%s'", body.term, exc_info=True)
        raise HTTPException(status_code=502, detail="Embedding generation failed")

    term = GlossaryTerm(
        workspace_id=body.workspace_id,
        term=body.term,
        definition=body.definition,
        source_document_id=body.source_document_id,
        is_auto_extracted=False,
        embedding=embedding,
    )
    db.add(term)
    await db.flush()
    await db.refresh(term)

    logger.info("Glossary term created: id=%s term='%s' workspace_id=%s", term.id, term.term, term.workspace_id)
    return GlossaryTermResponse.model_validate(term)


# ── PUT /api/glossary/{term_id} ──────────────────────────────────────────────


@router.put("/{term_id}", response_model=GlossaryTermResponse)
async def update_glossary_term(
    term_id: int,
    body: GlossaryTermUpdate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GlossaryTermResponse:
    """Update a glossary term (teacher only)."""
    await _require_teacher(db, user_id)

    term = await db.get(GlossaryTerm, term_id)
    if term is None:
        raise HTTPException(status_code=404, detail="Glossary term not found")

    changed = False
    if body.term is not None and body.term != term.term:
        term.term = body.term
        changed = True
    if body.definition is not None and body.definition != term.definition:
        term.definition = body.definition
        changed = True

    if changed:
        try:
            term.embedding = await asyncio.to_thread(
                generate_embedding, f"{term.term}: {term.definition}"
            )
        except Exception:
            logger.error("Embedding generation failed for glossary term update id=%s", term_id, exc_info=True)
            raise HTTPException(status_code=502, detail="Embedding generation failed")

    await db.flush()
    await db.refresh(term)
    logger.info("Glossary term updated: id=%s term='%s'", term.id, term.term)
    return GlossaryTermResponse.model_validate(term)


# ── DELETE /api/glossary/{term_id} ───────────────────────────────────────────


@router.delete("/{term_id}", status_code=204)
async def delete_glossary_term(
    term_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete a glossary term (teacher only)."""
    await _require_teacher(db, user_id)

    term = await db.get(GlossaryTerm, term_id)
    if term is None:
        raise HTTPException(status_code=404, detail="Glossary term not found")

    await db.delete(term)
    await db.flush()
    logger.info("Glossary term deleted: id=%s", term_id)
    return Response(status_code=204)


# ── POST /api/glossary/search ────────────────────────────────────────────────


@router.post("/search", response_model=GlossarySearchResponse)
async def search_glossary(
    body: GlossarySearchRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GlossarySearchResponse:
    """Combined text and semantic search over glossary terms."""
    query_embedding = await asyncio.to_thread(generate_embedding, body.query)

    # Semantic search
    semantic_stmt = (
        select(
            GlossaryTerm,
            GlossaryTerm.embedding.cosine_distance(query_embedding).label("distance"),
        )
        .where(
            GlossaryTerm.workspace_id == body.workspace_id,
            GlossaryTerm.embedding.isnot(None),
        )
        .order_by("distance")
        .limit(body.limit)
    )
    semantic_rows = (await db.execute(semantic_stmt)).all()

    # Text search (ILIKE on term and definition)
    pattern = f"%{body.query}%"
    text_stmt = (
        select(GlossaryTerm)
        .where(
            GlossaryTerm.workspace_id == body.workspace_id,
            or_(
                GlossaryTerm.term.ilike(pattern),
                GlossaryTerm.definition.ilike(pattern),
            ),
        )
        .limit(body.limit)
    )
    text_rows = (await db.execute(text_stmt)).scalars().all()

    # Merge: text matches get a similarity boost
    seen_ids: set[int] = set()
    scored: list[tuple[GlossaryTerm, float]] = []

    text_ids = {t.id for t in text_rows}

    for term_obj, distance in semantic_rows:
        similarity = round(1.0 - (distance or 1.0), 4)
        if term_obj.id in text_ids:
            similarity = min(1.0, similarity + 0.1)
        if term_obj.id not in seen_ids:
            scored.append((term_obj, similarity))
            seen_ids.add(term_obj.id)

    for term_obj in text_rows:
        if term_obj.id not in seen_ids:
            scored.append((term_obj, 0.5))
            seen_ids.add(term_obj.id)

    scored.sort(key=lambda x: x[1], reverse=True)
    scored = scored[: body.limit]

    results = [GlossaryTermResponse.model_validate(t) for t, _ in scored]
    return GlossarySearchResponse(
        query=body.query,
        results=results,
        total=len(results),
    )
