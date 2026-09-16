"""Activity endpoints — evaluate diagnostics, serve the activity feed, manage queue."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from app.models.tables import Activity, AtomicClaim, Topic, UserMastery
from app.schemas.activities import (
    ActivityCreate,
    ActivityFeedResponse,
    ActivityResponse,
    AttemptCreate,
    AttemptResult,
    ClaimCard,
    EvaluateRequest,
    EvaluateResult,
    QueueResponse,
)
from app.services.evaluation import evaluate_student_response
from app.services.queue import get_user_queue, add_to_queue

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
      3. If correct -> set mastery = 'mastered', award +50 XP.
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

    return EvaluateResult(
        claim_id=result["claim_id"],
        is_correct=result["outcome"] == "understood",
        feedback=result.get("feedback", ""),
        xp_awarded=result["xp_awarded"],
        new_status=result["new_status"],
        total_xp=result["total_xp"],
        level=result["level"],
    )


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


# ── POST /api/activities ─────────────────────────────────────────────────────


@router.post("", response_model=ActivityResponse, status_code=201)
async def create_activity(
    body: ActivityCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ActivityResponse:
    """Create a new activity.

    If scope is CLASSROOM_SHARED and classroom_id is set, the activity is also
    broadcast to all students in the classroom.
    """
    activity = Activity(
        workspace_id=body.workspace_id,
        creator_id=user_id,
        classroom_id=body.classroom_id,
        scope=body.scope,
        type=body.type,
        title=body.title,
        difficulty=body.difficulty,
        target_claim_ids=body.target_claim_ids,
        friction_levers=body.friction_levers,
        payload=body.payload,
    )
    db.add(activity)
    await db.flush()
    await db.refresh(activity)

    # If classroom-shared, broadcast to all enrolled students
    if body.scope == "CLASSROOM_SHARED" and body.classroom_id is not None:
        from app.services.classroom import broadcast_activity_to_class

        try:
            await broadcast_activity_to_class(
                db=db,
                classroom_id=body.classroom_id,
                activity_id=activity.id,
            )
        except ValueError:
            # Broadcast failure should not block activity creation
            logger.warning(
                "Failed to broadcast activity %s to classroom %s",
                activity.id,
                body.classroom_id,
            )

    return ActivityResponse.model_validate(activity)


# ── POST /api/activities/attempt ──────────────────────────────────────────────


@router.post("/attempt", response_model=AttemptResult)
async def submit_attempt(
    body: AttemptCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AttemptResult:
    """Submit an attempt for an activity.

    Evaluates the student's response, updates mastery, awards XP,
    and returns grading feedback.
    """
    # Validate the activity exists
    activity = (
        await db.execute(select(Activity).where(Activity.id == body.activity_id))
    ).scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")

    claim_id = body.claim_id
    if claim_id is None:
        target_ids = activity.target_claim_ids or []
        if target_ids:
            claim_id = target_ids[0]
        else:
            raise HTTPException(
                status_code=400, detail="No claim_id provided and activity has no target claims"
            )

    try:
        result = await evaluate_student_response(
            db=db,
            user_id=user_id,
            claim_id=claim_id,
            student_response=body.student_response,
            activity_id=body.activity_id,
            hints_used=body.hints_used,
            difficulty=activity.difficulty,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return AttemptResult(
        attempt_id=0,
        outcome=result["outcome"],
        hints_used=result["hints_used"],
        xp_awarded=result["xp_awarded"],
        rating_change=result["rating_change"],
        new_rating=result["new_rating"],
        feedback=result["feedback"],
        total_xp=result["total_xp"],
        level=result["level"],
        streak_days=result["streak_days"],
    )


# ── GET /api/activities/queue ─────────────────────────────────────────────────


@router.get("/queue", response_model=QueueResponse)
async def get_queue(
    workspace_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> QueueResponse:
    """Get the user's activity queue, optionally filtered by workspace."""
    result = await get_user_queue(
        db=db,
        user_id=user_id,
        workspace_id=workspace_id,
        limit=limit,
        offset=offset,
    )
    return QueueResponse(entries=result["items"], total=result["total"])


# ── POST /api/activities/queue/{activity_id} ──────────────────────────────────


@router.post("/queue/{activity_id}", status_code=201)
async def add_to_queue_endpoint(
    activity_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually add an activity to the user's queue."""
    # Validate the activity exists
    activity = (
        await db.execute(select(Activity).where(Activity.id == activity_id))
    ).scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")

    try:
        await add_to_queue(db=db, user_id=user_id, activity_id=activity_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"status": "added", "activity_id": activity_id}


# ── GET /api/activities/{id} ─────────────────────────────────────────────────


@router.get("/{activity_id}", response_model=ActivityResponse)
async def get_activity(
    activity_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ActivityResponse:
    """Get a single activity by ID."""
    activity = (
        await db.execute(select(Activity).where(Activity.id == activity_id))
    ).scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")

    return ActivityResponse.model_validate(activity)
