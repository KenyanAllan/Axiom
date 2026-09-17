"""Pydantic schemas for figure endpoints."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class FigureResponse(BaseModel):
    id: int
    workspace_id: int
    source_document_id: int | None
    s3_key: str
    content_type: str
    page_number: int | None
    caption: str
    figure_type: str
    labels: list[dict] | None
    ocr_text: str | None
    width: int | None
    height: int | None
    size_bytes: int | None
    is_decorative: bool
    associated_claim_ids: list[str] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class FigureViewUrlResponse(BaseModel):
    url: str
    content_type: str
