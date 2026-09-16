"""Source document endpoints — upload URL, register, list, delete."""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.tables import SourceDocument, Workspace
from app.services.s3 import generate_upload_url, generate_download_url, delete_object

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/sources", tags=["sources"])


# ── Pydantic schemas ────────────────────────────────────────────────────────────


class UploadUrlRequest(BaseModel):
    workspace_id: int
    filename: str
    content_type: str


class UploadUrlResponse(BaseModel):
    upload_url: str
    s3_key: str


class SourceCreate(BaseModel):
    workspace_id: int
    filename: str
    s3_key: str
    content_type: str
    size_bytes: int | None = None


class SourceResponse(BaseModel):
    id: int
    workspace_id: int
    uploader_id: str
    filename: str
    s3_key: str
    content_type: str
    size_bytes: int | None
    status: str
    transcript_s3_key: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Helpers ──────────────────────────────────────────────────────────────────────


async def _verify_workspace_access(
    db: AsyncSession, workspace_id: int, user_id: str
) -> Workspace:
    """Return the workspace if the user owns it, else 403/404."""
    result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if workspace.user_id != user_id:
        raise HTTPException(status_code=403, detail="Not your workspace")
    return workspace


# ── POST /api/sources/upload-url ─────────────────────────────────────────────


@router.post("/upload-url", response_model=UploadUrlResponse)
async def get_upload_url(
    body: UploadUrlRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UploadUrlResponse:
    """Generate a presigned S3 PUT URL for direct browser upload."""
    await _verify_workspace_access(db, body.workspace_id, user_id)

    result = generate_upload_url(
        workspace_id=body.workspace_id,
        filename=body.filename,
        content_type=body.content_type,
    )
    return UploadUrlResponse(**result)


# ── POST /api/sources ────────────────────────────────────────────────────────


@router.post("", response_model=SourceResponse, status_code=201)
async def register_source(
    body: SourceCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SourceResponse:
    """Register a source document after the browser upload completes."""
    await _verify_workspace_access(db, body.workspace_id, user_id)

    doc = SourceDocument(
        workspace_id=body.workspace_id,
        uploader_id=user_id,
        filename=body.filename,
        s3_key=body.s3_key,
        content_type=body.content_type,
        size_bytes=body.size_bytes,
        status="uploaded",
    )
    db.add(doc)
    await db.flush()
    await db.refresh(doc)

    # Kick off async ingestion pipeline via Celery
    from app.workers.celery_app import ingest_source_document_task

    ingest_source_document_task.delay(
        source_doc_id=doc.id,
        workspace_id=doc.workspace_id,
        s3_key=doc.s3_key,
        filename=doc.filename,
        content_type=doc.content_type,
    )
    logger.info(
        "Registered source document id=%s, workspace=%s — ingestion queued",
        doc.id,
        doc.workspace_id,
    )

    return SourceResponse.model_validate(doc)


# ── GET /api/sources ─────────────────────────────────────────────────────────


@router.get("", response_model=list[SourceResponse])
async def list_sources(
    workspace_id: int = Query(..., description="Workspace to list sources for"),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SourceResponse]:
    """List all source documents for a workspace."""
    await _verify_workspace_access(db, workspace_id, user_id)

    result = await db.execute(
        select(SourceDocument)
        .where(SourceDocument.workspace_id == workspace_id)
        .order_by(SourceDocument.created_at.desc())
    )
    docs = result.scalars().all()
    return [SourceResponse.model_validate(d) for d in docs]


# ── DELETE /api/sources/{source_id} ──────────────────────────────────────────


@router.delete("/{source_id}", status_code=204)
async def delete_source(
    source_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a source document, its S3 object, and nullify linked claims."""
    result = await db.execute(
        select(SourceDocument).where(SourceDocument.id == source_id)
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Source document not found")

    # Verify the user owns the workspace
    await _verify_workspace_access(db, doc.workspace_id, user_id)

    # Delete from S3
    try:
        delete_object(doc.s3_key)
    except Exception:
        logger.warning("Failed to delete S3 object key=%s — continuing", doc.s3_key)

    # The DB cascade (SET NULL) on atomic_claims.source_document_id handles
    # unlinking claims automatically when the source document row is deleted.
    await db.delete(doc)
    await db.flush()

    logger.info("Deleted source document id=%s", source_id)
    return None
