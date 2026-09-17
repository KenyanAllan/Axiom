"""Figure endpoints — list, view, and manage extracted figures."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.tables import Figure, FigureClaim, SourceDocument, User, Workspace
from app.schemas.figures import FigureResponse, FigureViewUrlResponse
from app.services.s3 import delete_object, generate_download_url

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/figures", tags=["figures"])


async def _verify_workspace_access(
    db: AsyncSession, workspace_id: int, user_id: str,
) -> Workspace:
    result = await db.execute(select(Workspace).where(Workspace.id == workspace_id))
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workbench not found")
    if workspace.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your workbench")
    return workspace


async def _build_figure_response(db: AsyncSession, figure: Figure) -> FigureResponse:
    result = await db.execute(
        select(FigureClaim.claim_id).where(FigureClaim.figure_id == figure.id)
    )
    claim_ids = [row[0] for row in result.all()]
    data = {c.key: getattr(figure, c.key) for c in figure.__table__.columns}
    data["associated_claim_ids"] = claim_ids
    return FigureResponse.model_validate(data)


@router.get("", response_model=list[FigureResponse])
async def list_figures(
    workspace_id: int = Query(..., description="Workbench to list figures for"),
    include_decorative: bool = Query(False, description="Include decorative images"),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FigureResponse]:
    await _verify_workspace_access(db, workspace_id, user_id)
    stmt = (
        select(Figure)
        .where(Figure.workspace_id == workspace_id)
        .order_by(Figure.created_at.desc())
    )
    if not include_decorative:
        stmt = stmt.where(Figure.is_decorative == False)
    rows = (await db.execute(stmt)).scalars().all()
    return [await _build_figure_response(db, f) for f in rows]


@router.get("/by-source/{source_doc_id}", response_model=list[FigureResponse])
async def list_figures_by_source(
    source_doc_id: int,
    include_decorative: bool = Query(False),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FigureResponse]:
    doc = await db.get(SourceDocument, source_doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Source document not found")
    await _verify_workspace_access(db, doc.workspace_id, user_id)

    stmt = (
        select(Figure)
        .where(Figure.source_document_id == source_doc_id)
        .order_by(Figure.page_number.asc().nullslast(), Figure.id)
    )
    if not include_decorative:
        stmt = stmt.where(Figure.is_decorative == False)
    rows = (await db.execute(stmt)).scalars().all()
    return [await _build_figure_response(db, f) for f in rows]


@router.get("/by-claim/{claim_id}", response_model=list[FigureResponse])
async def list_figures_by_claim(
    claim_id: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[FigureResponse]:
    stmt = (
        select(Figure)
        .join(FigureClaim, Figure.id == FigureClaim.figure_id)
        .where(FigureClaim.claim_id == claim_id, Figure.is_decorative == False)
        .order_by(FigureClaim.similarity_score.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    for f in rows:
        await _verify_workspace_access(db, f.workspace_id, user_id)
        break
    return [await _build_figure_response(db, f) for f in rows]


@router.get("/{figure_id}", response_model=FigureResponse)
async def get_figure(
    figure_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FigureResponse:
    figure = await db.get(Figure, figure_id)
    if figure is None:
        raise HTTPException(status_code=404, detail="Figure not found")
    await _verify_workspace_access(db, figure.workspace_id, user_id)
    return await _build_figure_response(db, figure)


@router.get("/{figure_id}/view-url", response_model=FigureViewUrlResponse)
async def get_figure_view_url(
    figure_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> FigureViewUrlResponse:
    figure = await db.get(Figure, figure_id)
    if figure is None:
        raise HTTPException(status_code=404, detail="Figure not found")
    await _verify_workspace_access(db, figure.workspace_id, user_id)
    url = generate_download_url(figure.s3_key)
    return FigureViewUrlResponse(url=url, content_type=figure.content_type)


@router.delete("/{figure_id}", status_code=204)
async def delete_figure(
    figure_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if user is None or user.role == "student":
        raise HTTPException(status_code=403, detail="Students cannot delete figures")

    figure = await db.get(Figure, figure_id)
    if figure is None:
        raise HTTPException(status_code=404, detail="Figure not found")
    await _verify_workspace_access(db, figure.workspace_id, user_id)

    try:
        delete_object(figure.s3_key)
    except Exception as exc:
        logger.warning("Failed to delete figure S3 object %s: %s", figure.s3_key, exc)

    await db.delete(figure)
    await db.flush()
    logger.info("Figure deleted: id=%s", figure_id)
    return None
