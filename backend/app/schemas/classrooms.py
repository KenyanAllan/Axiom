"""Pydantic v2 schemas for classrooms and enrollment."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


# ── Request schemas ─────────────────────────────────────────────────────────────


class ClassroomCreate(BaseModel):
    title: str = Field(..., min_length=1)


class JoinRequest(BaseModel):
    join_code: str = Field(..., min_length=6, max_length=6)


class AssignActivityRequest(BaseModel):
    activity_id: int


# ── Response schemas ────────────────────────────────────────────────────────────


class StudentSummary(BaseModel):
    id: str
    display_name: str
    xp: int
    level: int
    joined_at: datetime

    model_config = {"from_attributes": True}


class ClassroomResponse(BaseModel):
    id: int
    teacher_id: str
    title: str
    join_code: str
    created_at: datetime
    student_count: int = 0

    model_config = {"from_attributes": True}


class ClassroomDetail(ClassroomResponse):
    students: list[StudentSummary] = Field(default_factory=list)
    shared_workspace_id: int | None = None


class JoinResponse(BaseModel):
    classroom_id: int
    classroom_title: str
    workspace_id: int


class ClassroomDiagnosticResponse(BaseModel):
    classroom_id: int
    student_ids: list[str]
    claim_ids: list[str]
    mastery_matrix: dict[str, dict[str, int]] = Field(
        default_factory=dict,
        description="Maps student_id -> claim_id -> understanding_rating.",
    )
