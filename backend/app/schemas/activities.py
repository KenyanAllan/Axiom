"""Pydantic v2 schemas for activity evaluation and feed."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


# ── Activity type / scope literals ─────────────────────────────────────────────

ActivityType = Literal[
    "flashcard",
    "flashcard_deck",
    "multi_choice",
    "true_false",
    "short_answer",
    "fill_blank",
    "wrong_on_purpose",
    "scenario",
    "feynman",
    "mini_podcast",
    "quiz",
]

ActivityScope = Literal["CLASSROOM_SHARED", "STUDENT_PERSONAL"]

Outcome = Literal["understood", "did_not_understand", "neutral"]


# ── Request schemas ─────────────────────────────────────────────────────────────


class EvaluateRequest(BaseModel):
    claim_id: str = Field(..., examples=["claim_ge_01"])
    student_response: str = Field(
        ...,
        min_length=1,
        max_length=10_000,
        description="The student's written explanation or diagnosis.",
    )


class ActivityCreate(BaseModel):
    type: ActivityType
    title: str = Field(..., min_length=1)
    difficulty: int = Field(..., ge=1, le=3)
    target_claim_ids: list[str]
    scope: ActivityScope = "STUDENT_PERSONAL"
    workspace_id: int | None = None
    classroom_id: int | None = None
    friction_levers: dict | None = None
    payload: dict = Field(default_factory=dict)


class AttemptCreate(BaseModel):
    activity_id: int
    claim_id: str | None = None
    hints_used: bool = False
    student_response: str = Field(
        ...,
        min_length=1,
        max_length=10_000,
        description="The student's answer text.",
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


class ActivityResponse(BaseModel):
    id: int
    type: ActivityType
    title: str
    difficulty: int
    scope: ActivityScope
    target_claim_ids: list[str]
    payload: dict
    is_completed: bool = False
    audit_passed: bool | None = None
    created_at: datetime
    creator_id: str
    workspace_id: int | None = None
    classroom_id: int | None = None

    model_config = {"from_attributes": True}


class AttemptResult(BaseModel):
    attempt_id: int
    claim_id: str
    outcome: Outcome
    hints_used: bool
    xp_awarded: int
    rating_change: int
    new_rating: int
    feedback: str
    total_xp: int
    level: int
    streak_days: int


class QueueEntryResponse(BaseModel):
    id: int
    activity: ActivityResponse
    is_completed: bool
    added_at: datetime
    completed_at: datetime | None = None

    model_config = {"from_attributes": True}


class QueueResponse(BaseModel):
    entries: list[QueueEntryResponse]
    total: int


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
    role: Literal["student", "teacher", "individual_learner"]
    xp: int
    level: int
    streak_days: int = 0
    last_active_date: date | None = None
    email: str | None = None
    avatar: str | None = None


class UserProfileUpdate(BaseModel):
    email: str | None = None
    avatar: str | None = None


class MasteryEntry(BaseModel):
    claim_id: str
    claim_title: str
    topic_title: str
    status: Literal["unseen", "active", "mastered"]
    understanding_rating: int = 1
    updated_at: datetime | None = None


class HistoryEvent(BaseModel):
    claim_id: str
    claim_title: str
    is_correct: bool
    outcome: str
    student_response: str | None = None
    feedback: str | None = None
    xp_awarded: int
    timestamp: datetime


# ── Flashcard deck schemas ─────────────────────────────────────────────────────

QuizQuestionType = Literal["multi_choice", "true_false", "fill_blank", "short_answer"]


class GenerateDeckRequest(BaseModel):
    workspace_id: int = 1
    deck_size: Literal[5, 10, 15] = 10
    topic_ids: list[str] | None = Field(
        None, description="Specific topics to draw from. If empty, picks across all topics."
    )


class DeckCardResponse(BaseModel):
    index: int
    claim_id: str
    front: str
    back: str


class DeckResponse(BaseModel):
    activity_id: int
    deck_size: int
    cards: list[DeckCardResponse]


# ── Quiz schemas ───────────────────────────────────────────────────────────────


class GenerateQuizRequest(BaseModel):
    workspace_id: int = 1
    question_count: int = Field(5, ge=1, le=10)
    topic_ids: list[str] | None = Field(
        None, description="Specific topics. If empty, picks across all topics."
    )
    question_types: list[QuizQuestionType] | None = Field(
        None, description="Allowed question types. If empty, uses all types."
    )


class QuizQuestionResponse(BaseModel):
    index: int
    type: QuizQuestionType
    claim_id: str
    prompt: str
    options: list[str] | None = None


class QuizOverviewResponse(BaseModel):
    activity_id: int
    question_count: int
    questions: list[QuizQuestionResponse]


class QuizAnswerItem(BaseModel):
    question_index: int
    response: str


class QuizSubmitRequest(BaseModel):
    answers: list[QuizAnswerItem]


class QuizQuestionResult(BaseModel):
    question_index: int
    claim_id: str
    type: QuizQuestionType
    is_correct: bool
    feedback: str
    xp_awarded: int


class QuizSubmitResponse(BaseModel):
    activity_id: int
    total_questions: int
    correct_count: int
    total_xp: int
    results: list[QuizQuestionResult]
