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
    """Extract outcome and feedback from the Bedrock grading result.

    Bedrock now returns {"outcome": "understood|did_not_understand|neutral", "feedback": "..."}.
    """
    feedback = str(grading.get("feedback", "No feedback generated."))
    outcome = grading.get("outcome", "did_not_understand")
    if outcome not in VALID_OUTCOMES:
        outcome = "did_not_understand"
    return outcome, feedback


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

    # ── 2. Grade: deterministic for simple types, Bedrock for complex ones ──
    activity_obj = None
    if activity_id is not None:
        activity_obj = await db.get(Activity, activity_id)

    outcome: str
    feedback: str

    # Deterministic grading for known activity types
    DETERMINISTIC_TYPES = {"true_false", "multi_choice", "flashcard"}
    activity_type = activity_obj.type if activity_obj is not None else None

    if activity_type in DETERMINISTIC_TYPES and activity_obj is not None:
        payload = activity_obj.payload or {}

        if activity_type == "flashcard":
            # Self-graded: always understood
            outcome = "understood"
            feedback = "Flashcard reviewed. Keep reinforcing your knowledge!"

        elif activity_type == "true_false":
            correct = str(payload.get("correct_answer", "")).lower().strip()
            given = student_response.lower().strip()
            if given == correct:
                outcome = "understood"
                feedback = "Correct! You got the true/false question right."
            else:
                outcome = "did_not_understand"
                feedback = f"Incorrect. The correct answer was {correct}."

        elif activity_type == "multi_choice":
            correct_index = str(payload.get("correct_index", "")).strip()
            given = student_response.strip()
            options = payload.get("options", [])
            correct_text = ""
            if options and correct_index.isdigit() and int(correct_index) < len(options):
                correct_text = str(options[int(correct_index)])
            if given == correct_index or (correct_text and given == correct_text):
                outcome = "understood"
                feedback = "Correct! You selected the right answer."
            else:
                outcome = "did_not_understand"
                feedback = "Incorrect."
                if correct_text:
                    feedback = f"Incorrect. The correct answer was: {correct_text}"

        else:
            # Should not reach here, but fall back to Bedrock
            outcome = "neutral"
            feedback = ""

    else:
        # Non-deterministic types: call Bedrock
        import asyncio

        grading = await asyncio.to_thread(
            grade_response,
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
    # Reuse activity_obj loaded in step 2 if available
    if activity_obj is not None:
        difficulty = activity_obj.difficulty

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
    await db.flush()

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
        "attempt_id": attempt.id,
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
