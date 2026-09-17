"""Pydantic v2 schemas for glossary terms."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class GlossaryTermCreate(BaseModel):
    workspace_id: int
    term: str = Field(..., min_length=1, max_length=200)
    definition: str = Field(..., min_length=1, max_length=5000)
    source_document_id: int | None = None


class GlossaryTermUpdate(BaseModel):
    term: str | None = Field(default=None, min_length=1, max_length=200)
    definition: str | None = Field(default=None, min_length=1, max_length=5000)


class GlossaryTermResponse(BaseModel):
    id: int
    workspace_id: int
    source_document_id: int | None = None
    term: str
    definition: str
    source_ref: dict[str, Any] | None = None
    is_auto_extracted: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class GlossarySearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    workspace_id: int
    limit: int = Field(default=20, ge=1, le=100)


class GlossarySearchResponse(BaseModel):
    query: str
    results: list[GlossaryTermResponse]
    total: int
