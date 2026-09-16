"""Activity endpoints — evaluate diagnostics and serve the activity feed."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.tables import AtomicClaim, Topic, UserMastery
from app.schemas.activities import (
    ActivityFeedResponse,
    ClaimCard,
    EvaluateRequest,
    EvaluateResult,
)
from app.services.evaluation import evaluate_student_response

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/activities", tags=["activities"])


# ── POST /api/activities/evaluate ────────────────────────────────────────────


@router.post("/evaluate", response_model=EvaluateResult)
async def evaluate(
    body: EvaluateRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EvaluateResult:
    """Grade a student's diagnostic response via Amazon Bedrock.

    Flow:
      1. Validate claim exists.
      2. Send claim content + rubric + student response to Claude 3.5 Sonnet
         via the Bedrock Converse API.
      3. If correct → set mastery = 'mastered', award +50 XP.
      4. Log attempt to mastery history (JSONB).
      5. Return grading result with formative feedback.
    """
    try:
        result = await evaluate_student_response(
            db=db,
            user_id=user_id,
            claim_id=body.claim_id,
            student_response=body.student_response,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    return EvaluateResult(**result)


# ── GET /api/activities/feed ─────────────────────────────────────────────────


@router.get("/feed", response_model=ActivityFeedResponse)
async def activity_feed(
    limit: int = 20,
    offset: int = 0,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ActivityFeedResponse:
    """Return prioritized diagnostic cards for the student.

    Priority order:
      1. Claims with status 'active' (student has attempted but not mastered).
      2. Claims with status 'unseen' in frontier topics.
    """
    # Fetch all claims with their mastery status for this user
    stmt = (
        select(
            AtomicClaim.id,
            AtomicClaim.topic_id,
            AtomicClaim.title.label("claim_title"),
            AtomicClaim.diagnostic_prompt,
            AtomicClaim.flawed_snippet,
            Topic.title.label("topic_title"),
            func.coalesce(UserMastery.status, "unseen").label("status"),
        )
        .join(Topic, AtomicClaim.topic_id == Topic.id)
        .outerjoin(
            UserMastery,
            (UserMastery.claim_id == AtomicClaim.id)
            & (UserMastery.user_id == user_id),
        )
        .where(func.coalesce(UserMastery.status, "unseen") != "mastered")
        .order_by(
            # Active first, then unseen
            func.case(
                (func.coalesce(UserMastery.status, "unseen") == "active", 0),
                else_=1,
            ),
            AtomicClaim.id,
        )
        .offset(offset)
        .limit(limit)
    )

    rows = (await db.execute(stmt)).all()

    # Count total unmastered
    count_stmt = (
        select(func.count())
        .select_from(AtomicClaim)
        .outerjoin(
            UserMastery,
            (UserMastery.claim_id == AtomicClaim.id)
            & (UserMastery.user_id == user_id),
        )
        .where(func.coalesce(UserMastery.status, "unseen") != "mastered")
    )
    total = (await db.execute(count_stmt)).scalar_one()

    cards = [
        ClaimCard(
            claim_id=row.id,
            topic_id=row.topic_id,
            topic_title=row.topic_title,
            claim_title=row.claim_title,
            diagnostic_type="wrong_on_purpose",
            diagnostic_prompt=row.diagnostic_prompt,
            flawed_snippet=row.flawed_snippet,
            current_status=row.status,
        )
        for row in rows
    ]

    return ActivityFeedResponse(cards=cards, total=total)
