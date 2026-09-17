"""Activity endpoints — evaluate diagnostics, serve the activity feed, manage queue."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.database import get_db
from pydantic import BaseModel, Field

from app.models.tables import Activity, AtomicClaim, Classroom, Topic, TopicPrerequisite, User, UserMastery
from app.schemas.activities import (
    ActivityCreate,
    ActivityFeedResponse,
    ActivityResponse,
    AttemptCreate,
    AttemptResult,
    ClaimCard,
    DeckCardResponse,
    DeckResponse,
    EvaluateRequest,
    EvaluateResult,
    GenerateDeckRequest,
    GenerateQuizRequest,
    QueueResponse,
    QuizOverviewResponse,
    QuizQuestionResponse,
    QuizSubmitRequest,
    QuizSubmitResponse,
    QuizQuestionResult,
)
from app.services.activity_generator import (
    generate_basic_activities,
    generate_flashcard_deck,
    generate_quiz,
)
from app.services.evaluation import evaluate_student_response, evaluate_quiz
from app.services.queue import get_user_queue, add_to_queue

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/activities", tags=["activities"])


class GenerateRequest(BaseModel):
    claim_id: str
    workspace_id: int
    types: list[str] = Field(default=["flashcard", "true_false", "multi_choice", "fill_blank", "wrong_on_purpose", "feynman"])


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
    if body.scope == "CLASSROOM_SHARED":
        if body.classroom_id is None:
            raise HTTPException(status_code=400, detail="classroom_id required for CLASSROOM_SHARED")
        user = await db.get(User, user_id)
        if user is None or user.role != "teacher":
            raise HTTPException(status_code=403, detail="Only teachers can create classroom-shared activities")
        classroom = await db.get(Classroom, body.classroom_id)
        if classroom is None or classroom.teacher_id != user_id:
            raise HTTPException(status_code=403, detail="You do not own this classroom")

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
        attempt_id=result["attempt_id"],
        claim_id=result["claim_id"],
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


# ── POST /api/activities/generate ────────────────────────────────────────────


@router.post("/generate", response_model=list[ActivityResponse])
async def generate_activities(
    body: GenerateRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ActivityResponse]:
    """Auto-generate deterministic activities for a claim."""
    claim = await db.get(AtomicClaim, body.claim_id)
    if claim is None:
        raise HTTPException(status_code=404, detail=f"Claim '{body.claim_id}' not found")

    activities = await generate_basic_activities(
        db=db,
        claim=claim,
        workspace_id=body.workspace_id,
        creator_id=user_id,
        types=body.types,
    )

    return [ActivityResponse.model_validate(a) for a in activities]


# ── POST /api/activities/generate-deck ──────────────────────────────────────


@router.post("/generate-deck", response_model=DeckResponse, status_code=201)
async def generate_deck(
    body: GenerateDeckRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DeckResponse:
    """Generate a flashcard deck with N cards across topics."""
    try:
        activity = await generate_flashcard_deck(
            db=db,
            workspace_id=body.workspace_id,
            creator_id=user_id,
            deck_size=body.deck_size,
            topic_ids=body.topic_ids,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    cards_payload = activity.payload.get("cards", [])
    return DeckResponse(
        activity_id=activity.id,
        deck_size=len(cards_payload),
        cards=[DeckCardResponse(**c) for c in cards_payload],
    )


# ── POST /api/activities/generate-quiz ─────────────────────────────────────


@router.post("/generate-quiz", response_model=QuizOverviewResponse, status_code=201)
async def generate_quiz_endpoint(
    body: GenerateQuizRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> QuizOverviewResponse:
    """Generate a quiz with mixed question types across topics."""
    try:
        activity = await generate_quiz(
            db=db,
            workspace_id=body.workspace_id,
            creator_id=user_id,
            question_count=body.question_count,
            topic_ids=body.topic_ids,
            question_types=body.question_types,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    questions_payload = activity.payload.get("questions", [])
    questions = []
    for q in questions_payload:
        questions.append(QuizQuestionResponse(
            index=q["index"],
            type=q["type"],
            claim_id=q["claim_id"],
            prompt=q["prompt"],
            options=q.get("options"),
        ))

    return QuizOverviewResponse(
        activity_id=activity.id,
        question_count=len(questions),
        questions=questions,
    )


# ── POST /api/activities/quiz/{activity_id}/submit ─────────────────────────


@router.post("/quiz/{activity_id}/submit", response_model=QuizSubmitResponse)
async def submit_quiz(
    activity_id: int,
    body: QuizSubmitRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> QuizSubmitResponse:
    """Submit all quiz answers at once. Grades each question and returns aggregate results."""
    activity = (
        await db.execute(select(Activity).where(Activity.id == activity_id))
    ).scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    if activity.type != "quiz":
        raise HTTPException(status_code=400, detail="Activity is not a quiz")

    try:
        result = await evaluate_quiz(
            db=db,
            user_id=user_id,
            activity=activity,
            answers=[a.model_dump() for a in body.answers],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return QuizSubmitResponse(
        activity_id=result["activity_id"],
        total_questions=result["total_questions"],
        correct_count=result["correct_count"],
        total_xp=result["total_xp"],
        results=[QuizQuestionResult(**r) for r in result["results"]],
    )


# ── GET /api/activities/flashcards/{topic_id} ────────────────────────────────


@router.get("/flashcards/{topic_id}", response_model=list[ActivityResponse])
async def flashcard_stack(
    topic_id: str,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ActivityResponse]:
    """Return a flashcard stack for a topic.

    Gets all flashcard activities targeting claims in this topic.
    If fewer than 5, pulls from neighboring prerequisite/dependent topics.
    """
    topic = await db.get(Topic, topic_id)
    if topic is None:
        raise HTTPException(status_code=404, detail=f"Topic '{topic_id}' not found")

    # Get claim IDs in this topic
    claim_result = await db.execute(
        select(AtomicClaim.id).where(AtomicClaim.topic_id == topic_id)
    )
    claim_ids = [row[0] for row in claim_result.all()]

    flashcards: list[Activity] = []
    if claim_ids:
        fc_result = await db.execute(
            select(Activity).where(
                Activity.type == "flashcard",
                Activity.target_claim_ids.op("?|")(claim_ids),
            )
        )
        flashcards = list(fc_result.scalars().all())

    # If fewer than 5, expand to neighboring topics
    if len(flashcards) < 5:
        # Prerequisites of this topic
        prereq_result = await db.execute(
            select(TopicPrerequisite.prerequisite_id).where(
                TopicPrerequisite.topic_id == topic_id
            )
        )
        neighbor_ids = {row[0] for row in prereq_result.all()}

        # Topics that depend on this topic
        dep_result = await db.execute(
            select(TopicPrerequisite.topic_id).where(
                TopicPrerequisite.prerequisite_id == topic_id
            )
        )
        neighbor_ids |= {row[0] for row in dep_result.all()}

        if neighbor_ids:
            neighbor_claim_result = await db.execute(
                select(AtomicClaim.id).where(AtomicClaim.topic_id.in_(neighbor_ids))
            )
            neighbor_claim_ids = [row[0] for row in neighbor_claim_result.all()]

            if neighbor_claim_ids:
                existing_ids = {f.id for f in flashcards}
                extra_result = await db.execute(
                    select(Activity).where(
                        Activity.type == "flashcard",
                        Activity.target_claim_ids.op("?|")(neighbor_claim_ids),
                        Activity.id.notin_(existing_ids) if existing_ids else True,
                    )
                )
                extra = list(extra_result.scalars().all())
                flashcards.extend(extra[: 5 - len(flashcards)])

    return [ActivityResponse.model_validate(a) for a in flashcards]


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
