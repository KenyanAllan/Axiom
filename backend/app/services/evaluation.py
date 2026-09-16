"""Evaluation orchestrator — ties Bedrock grading to mastery, XP, and rating updates.

Uses the 3-outcome model (understood / did_not_understand / neutral) per spec section 3.
Integrates gamification (XP + streaks) and rating adjustment services.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import (
    Activity,
    ActivityAttempt,
    AtomicClaim,
    User,
    UserMastery,
)
from app.services.bedrock import grade_response
from app.services.gamification import (
    calculate_xp_reward,
    compute_level,
    update_streak,
)
from app.services.rating import apply_rating_change, calculate_rating_change

logger = logging.getLogger(__name__)

# Valid outcomes per spec section 3.1
VALID_OUTCOMES = {"understood", "did_not_understand", "neutral"}


def _map_bedrock_result(grading: dict) -> tuple[str, str]:
    """Map Bedrock grading result to the 3-outcome model.

    Bedrock returns {"outcome": "understood|did_not_understand|neutral", "feedback": "..."}.
    Falls back to legacy {"is_correct": bool} if the new format is not present.

    Returns (outcome, feedback).
    """
    feedback = str(grading.get("feedback", "No feedback generated."))

    # New 3-outcome format
    outcome = grading.get("outcome")
    if outcome in VALID_OUTCOMES:
        return outcome, feedback

    # Legacy binary format — map to 3-outcome
    is_correct = grading.get("is_correct", False)
    if is_correct:
        return "understood", feedback
    else:
        return "did_not_understand", feedback


async def evaluate_student_response(
    db: AsyncSession,
    user_id: str,
    claim_id: str,
    student_response: str,
    activity_id: int | None = None,
    hints_used: bool = False,
    difficulty: int = 1,
) -> dict:
    """Run the full evaluation pipeline.

    1. Fetch claim + rubric from DB.
    2. Call Bedrock to grade (3-outcome model).
    3. Update streak (gamification).
    4. Calculate and apply rating change.
    5. Calculate XP reward.
    6. Record ActivityAttempt.
    7. Update user XP and level.
    8. Return full evaluation result.
    """
    # ── 1. Load the claim ────────────────────────────────────────────────────
    claim = await db.get(AtomicClaim, claim_id)
    if claim is None:
        raise ValueError(f"Claim {claim_id} not found")

    rubric = claim.rubric or "Accept any accurate, well-reasoned response."

    # ── 2. Grade with Bedrock (3-outcome model) ─────────────────────────────
    grading = grade_response(
        claim_content=claim.content,
        rubric=rubric,
        student_response=student_response,
    )
    outcome, feedback = _map_bedrock_result(grading)

    # If hints were used, override to neutral when the student got it right
    # (spec section 4: hints + correct => 0 change, effectively "neutral" for XP)
    # Note: we keep the actual outcome for recording but use hints_used in rating calc

    # ── 3. Load user and update streak ───────────────────────────────────────
    user = await db.get(User, user_id)
    if user is None:
        raise ValueError(f"User {user_id} not found")

    streak_days = await update_streak(db, user)

    # ── 4. Calculate and apply rating change ─────────────────────────────────
    # Determine difficulty from activity if provided, else use parameter
    if activity_id is not None:
        activity = await db.get(Activity, activity_id)
        if activity is not None:
            difficulty = activity.difficulty

    rating_delta = calculate_rating_change(difficulty, outcome, hints_used)
    new_rating, new_status = await apply_rating_change(
        db, user_id, claim_id, rating_delta
    )

    # ── 5. Calculate XP reward (always awards XP, spec 5.1) ─────────────────
    xp_awarded = calculate_xp_reward(difficulty, outcome, streak_days)

    # ── 6. Record ActivityAttempt ────────────────────────────────────────────
    attempt = ActivityAttempt(
        user_id=user_id,
        activity_id=activity_id,
        claim_id=claim_id,
        outcome=outcome,
        hints_used=hints_used,
        difficulty=difficulty,
        xp_awarded=xp_awarded,
        rating_change=rating_delta,
    )
    db.add(attempt)

    # ── 7. Update mastery history ────────────────────────────────────────────
    now = datetime.now(timezone.utc)
    mastery_result = await db.execute(
        select(UserMastery).where(
            UserMastery.user_id == user_id,
            UserMastery.claim_id == claim_id,
        )
    )
    mastery = mastery_result.scalar_one_or_none()

    if mastery is not None:
        history_entry = {
            "timestamp": now.isoformat(),
            "outcome": outcome,
            "hints_used": hints_used,
            "difficulty": difficulty,
            "xp_awarded": xp_awarded,
            "rating_change": rating_delta,
            "response_preview": student_response[:200],
        }
        mastery.history = [*(mastery.history or []), history_entry]
        mastery.updated_at = now

    # ── 8. Update user XP and level (XP always awarded, spec 5.1) ───────────
    user.xp = (user.xp or 0) + xp_awarded
    user.level = compute_level(user.xp)

    # ── 9. Mark queue entry as completed if activity_id provided ─────────────
    if activity_id is not None:
        from app.services.queue import complete_queue_entry

        await complete_queue_entry(db, user_id, activity_id)

    # Flush so response reflects latest state (commit handled by dependency)
    await db.flush()

    return {
        "claim_id": claim_id,
        "outcome": outcome,
        "feedback": feedback,
        "hints_used": hints_used,
        "difficulty": difficulty,
        "xp_awarded": xp_awarded,
        "rating_change": rating_delta,
        "new_rating": new_rating,
        "new_status": new_status,
        "streak_days": streak_days,
        "total_xp": user.xp,
        "level": user.level,
    }
