"""Pydantic v2 schemas for activity evaluation and feed."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


# ── Request schemas ─────────────────────────────────────────────────────────────

class EvaluateRequest(BaseModel):
    claim_id: str = Field(..., examples=["claim_ge_01"])
    student_response: str = Field(
        ...,
        min_length=1,
        max_length=10_000,
        description="The student's written explanation or diagnosis.",
    )


# ── Response schemas ────────────────────────────────────────────────────────────

class EvaluateResult(BaseModel):
    claim_id: str
    is_correct: bool
    feedback: str = Field(
        ..., description="Model-generated formative feedback for the student."
    )
    xp_awarded: int
    new_status: Literal["unseen", "active", "mastered"]
    total_xp: int
    level: int


class ClaimCard(BaseModel):
    claim_id: str
    topic_id: str
    topic_title: str
    claim_title: str
    diagnostic_type: Literal["wrong_on_purpose", "feynman", "micro_project"] = (
        "wrong_on_purpose"
    )
    diagnostic_prompt: str | None = None
    flawed_snippet: str | None = None
    current_status: Literal["unseen", "active", "mastered"]


class ActivityFeedResponse(BaseModel):
    cards: list[ClaimCard]
    total: int


# ── Shared sub-schemas ──────────────────────────────────────────────────────────

class TopicSummary(BaseModel):
    id: str
    slug: str
    title: str
    summary: str | None = None


class ClaimDetail(BaseModel):
    id: str
    title: str
    content: str
    diagnostic_prompt: str | None = None
    flawed_snippet: str | None = None
    rubric: str | None = None


class TopicDetailResponse(BaseModel):
    topic: TopicSummary
    claims: list[ClaimDetail]
    prerequisites: list[TopicSummary]
    prerequisite_mastery: dict[str, bool] = Field(
        default_factory=dict,
        description="Map of prerequisite topic_id -> fully mastered?",
    )


class FrontierTopic(BaseModel):
    topic_id: str
    slug: str
    title: str
    claim_count: int
    mastered_count: int


class FrontierResponse(BaseModel):
    frontier: list[FrontierTopic]


class UserProfile(BaseModel):
    id: str
    display_name: str
    role: Literal["student", "teacher"]
    xp: int
    level: int


class MasteryEntry(BaseModel):
    claim_id: str
    claim_title: str
    topic_title: str
    status: Literal["unseen", "active", "mastered"]
    updated_at: datetime | None = None


class HistoryEvent(BaseModel):
    claim_id: str
    claim_title: str
    is_correct: bool
    xp_awarded: int
    timestamp: datetime
