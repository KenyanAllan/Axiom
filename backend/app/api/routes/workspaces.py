"""Workbench endpoints — create, list, detail, delete."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.schemas.workspaces import (
    WorkspaceCreate,
    WorkspaceResponse,
    WorkspaceDetail,
    WorkspaceListResponse,
)
from app.services.workspace import (
    create_workspace,
    get_user_workspaces,
    get_workspace_detail,
    delete_workspace,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


# ── POST /api/workspaces ──────────────────────────────────────────────────────


@router.post("", response_model=WorkspaceResponse, status_code=201)
async def create_workspace_endpoint(
    body: WorkspaceCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceResponse:
    """Create a new personal workspace."""
    result = await create_workspace(
        db=db, user_id=user_id, title=body.title, description=body.description
    )
    return result


# ── GET /api/workspaces ───────────────────────────────────────────────────────


@router.get("", response_model=WorkspaceListResponse)
async def list_workspaces(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceListResponse:
    """List all workspaces belonging to the current user."""
    result = await get_user_workspaces(db=db, user_id=user_id)
    return WorkspaceListResponse(workspaces=result)


# ── GET /api/workspaces/{id} ──────────────────────────────────────────────────


@router.get("/{workspace_id}", response_model=WorkspaceDetail)
async def get_workspace(
    workspace_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceDetail:
    """Get workspace detail with topic and activity counts."""
    try:
        result = await get_workspace_detail(db=db, workspace_id=workspace_id, user_id=user_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return result


# ── DELETE /api/workspaces/{id} ───────────────────────────────────────────────


@router.delete("/{workspace_id}", status_code=204)
async def delete_workspace_endpoint(
    workspace_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a personal workspace. Returns 403 if it is classroom-shared."""
    try:
        await delete_workspace(db=db, workspace_id=workspace_id, user_id=user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return None
