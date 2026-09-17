"""Source document endpoints — upload URL, register, list, delete."""

from __future__ import annotations

import logging
from datetime import datetime

from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.models.tables import AtomicClaim, SourceDocument, User, Workspace
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
    claim_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Helpers ──────────────────────────────────────────────────────────────────────


async def _verify_workspace_access(
    db: AsyncSession, workspace_id: int, user_id: str
) -> Workspace:
    """Return the workspace if the user owns it or is in the linked classroom, else 403/404."""
    result = await db.execute(
        select(Workspace).where(Workspace.id == workspace_id)
    )
    workspace = result.scalar_one_or_none()
    if workspace is None:
        logger.warning("Workbench not found: workspace_id=%d", workspace_id)
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
    logger.warning("Workbench access denied: workspace_id=%d, user_id=%s", workspace_id, user_id)
    raise HTTPException(status_code=403, detail="Not your workbench")


async def _count_claims(db: AsyncSession, doc_id: int) -> int:
    """Return the number of atomic claims linked to a source document."""
    result = await db.execute(
        select(func.count()).where(AtomicClaim.source_document_id == doc_id)
    )
    return result.scalar_one()


async def _source_with_claims(db: AsyncSession, doc: SourceDocument) -> SourceResponse:
    """Build a SourceResponse with claim_count populated."""
    count = await _count_claims(db, doc.id)
    resp = SourceResponse.model_validate(doc)
    resp.claim_count = count
    return resp


# ── POST /api/sources/upload (direct multipart) ────────────────────────────


@router.post("/upload", response_model=SourceResponse, status_code=201)
@router.post("/upload/", response_model=SourceResponse, status_code=201)
async def upload_source_direct(
    request: Request,
    file: UploadFile = File(...),
    workspace_id: int = Form(...),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SourceResponse:
    """Direct file upload via multipart/form-data.

    Stores the file in S3 (if configured), registers the source document,
    and kicks off the ingestion pipeline.
    """
    await _verify_workspace_access(db, workspace_id, user_id)

    content_type = file.content_type or "application/octet-stream"
    s3_key = f"sources/{workspace_id}/{uuid4()}/{file.filename}"

    # Read file content with size limit
    _settings = get_settings()
    content = await file.read(_settings.upload_max_bytes + 1)
    if len(content) > _settings.upload_max_bytes:
        logger.warning("Upload rejected — file too large: filename=%s, size=%d", file.filename, len(content))
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {_settings.upload_max_bytes // (1024 * 1024)} MB.",
        )
    size_bytes = len(content)

    # Try to upload to S3
    s3_ok = False
    try:
        from app.services.s3 import _get_client
        from app.core.config import get_settings as _gs

        _settings = _gs()
        client = _get_client()
        client.put_object(
            Bucket=_settings.s3_bucket_name,
            Key=s3_key,
            Body=content,
            ContentType=content_type,
        )
        s3_ok = True
    except Exception:
        logger.warning("S3 upload skipped (not configured) for %s", file.filename)

    if not s3_ok:
        raise HTTPException(
            status_code=502,
            detail="File storage is unavailable. Please try again later.",
        )

    doc = SourceDocument(
        workspace_id=workspace_id,
        uploader_id=user_id,
        filename=file.filename or "unnamed",
        s3_key=s3_key,
        content_type=content_type,
        size_bytes=size_bytes,
        status="uploaded",
    )
    db.add(doc)
    # Commit now so the row is visible to the Celery worker
    await db.commit()
    await db.refresh(doc)

    try:
        from app.workers.celery_app import ingest_source_document_task

        ingest_source_document_task.delay(
            source_doc_id=doc.id,
            workspace_id=doc.workspace_id,
            s3_key=doc.s3_key,
            filename=doc.filename,
            content_type=doc.content_type,
        )
    except Exception:
        logger.warning(
            "Celery not available — ingestion skipped for doc %s", doc.id
        )

    logger.info(
        "Direct upload: registered source doc id=%s, workspace=%s",
        doc.id,
        doc.workspace_id,
    )

    return SourceResponse.model_validate(doc)


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
    await db.commit()
    await db.refresh(doc)

    try:
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
    except Exception:
        logger.warning(
            "Celery not available — ingestion skipped for doc %s", doc.id
        )

    return SourceResponse.model_validate(doc)


# ── GET /api/sources ─────────────────────────────────────────────────────────


@router.get("", response_model=list[SourceResponse])
async def list_sources(
    workspace_id: int = Query(..., description="Workbench to list sources for"),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SourceResponse]:
    """List all source documents for a workspace."""
    await _verify_workspace_access(db, workspace_id, user_id)

    # Single query: fetch docs with claim counts via LEFT JOIN + GROUP BY
    count_subq = (
        select(
            AtomicClaim.source_document_id,
            func.count().label("claim_count"),
        )
        .group_by(AtomicClaim.source_document_id)
        .subquery()
    )
    stmt = (
        select(SourceDocument, func.coalesce(count_subq.c.claim_count, 0).label("claim_count"))
        .outerjoin(count_subq, SourceDocument.id == count_subq.c.source_document_id)
        .where(SourceDocument.workspace_id == workspace_id)
        .order_by(SourceDocument.created_at.desc())
    )
    rows = (await db.execute(stmt)).all()
    logger.debug("Listed sources: workspace_id=%d, count=%d", workspace_id, len(rows))
    results = []
    for doc, claim_count in rows:
        resp = SourceResponse.model_validate(doc)
        resp.claim_count = claim_count
        results.append(resp)
    return results


# ── GET /api/sources/{source_id}/view-url ───────────────────────────────────


class ViewUrlResponse(BaseModel):
    url: str
    content_type: str
    filename: str


@router.get("/{source_id}/view-url", response_model=ViewUrlResponse)
async def get_view_url(
    source_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ViewUrlResponse:
    """Generate a presigned S3 download URL for viewing a source document."""
    result = await db.execute(
        select(SourceDocument).where(SourceDocument.id == source_id)
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        logger.warning("Source document not found for view URL: source_id=%d", source_id)
        raise HTTPException(status_code=404, detail="Source document not found")

    await _verify_workspace_access(db, doc.workspace_id, user_id)

    url = generate_download_url(doc.s3_key)
    return ViewUrlResponse(
        url=url,
        content_type=doc.content_type or "application/octet-stream",
        filename=doc.filename,
    )


# ── DELETE /api/sources/{source_id} ──────────────────────────────────────────


@router.delete("/{source_id}", status_code=204)
async def delete_source(
    source_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete a source document, its S3 object, and nullify linked claims.

    Only teachers and individual learners can delete source documents.
    Students cannot.
    """
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "student":
        logger.warning("Student attempted source deletion: user_id=%s, source_id=%d", user_id, source_id)
        raise HTTPException(status_code=403, detail="Students cannot delete source documents")

    result = await db.execute(
        select(SourceDocument).where(SourceDocument.id == source_id)
    )
    doc = result.scalar_one_or_none()
    if doc is None:
        logger.warning("Source document not found for deletion: source_id=%d", source_id)
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
    return Response(status_code=204)
