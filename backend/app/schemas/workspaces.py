"""Pydantic v2 schemas for workspaces."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


# ── Request schemas ─────────────────────────────────────────────────────────────


class WorkspaceCreate(BaseModel):
    title: str = Field(..., min_length=1)
    description: str | None = None


# ── Response schemas ────────────────────────────────────────────────────────────


class WorkspaceResponse(BaseModel):
    id: int
    user_id: str
    title: str
    description: str | None = None
    is_classroom_shared: bool = False
    classroom_id: int | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class WorkspaceDetail(WorkspaceResponse):
    topic_count: int = 0
    activity_count: int = 0


class WorkspaceListResponse(BaseModel):
    workspaces: list[WorkspaceResponse]
