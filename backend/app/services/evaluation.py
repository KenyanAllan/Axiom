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
    DETERMINISTIC_TYPES = {"true_false", "multi_choice", "flashcard", "flashcard_deck", "fill_blank"}
    activity_type = activity_obj.type if activity_obj is not None else None

    if activity_type in DETERMINISTIC_TYPES and activity_obj is not None:
        payload = activity_obj.payload or {}

        if activity_type in ("flashcard", "flashcard_deck"):
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

        elif activity_type == "fill_blank":
            correct = str(payload.get("correct_answer", "")).strip()
            given = student_response.strip()
            if given.lower() == correct.lower():
                outcome = "understood"
                feedback = f"Correct! The answer is \"{correct}\"."
            else:
                outcome = "did_not_understand"
                feedback = f"Incorrect. The correct answer was \"{correct}\"."

        else:
            outcome = "neutral"
            feedback = ""

    else:
        # Non-deterministic types: call Bedrock
        import asyncio

        grading_rubric = rubric

        if activity_type == "feynman":
            payload = (activity_obj.payload or {}) if activity_obj else {}
            key_points = payload.get("key_points", [])
            points_text = "\n".join(f"- {kp}" for kp in key_points) if key_points else ""
            grading_rubric = (
                "Evaluate whether the student's explanation demonstrates genuine understanding "
                "by teaching the concept clearly. Check for:\n"
                "1. ACCURACY — the explanation must not introduce misconceptions.\n"
                "2. COMPLETENESS — it should cover the core idea, not just restate the term.\n"
                "3. CLARITY — a newcomer should be able to follow the explanation.\n"
            )
            if points_text:
                grading_rubric += f"Key points the explanation should address:\n{points_text}\n"
            grading_rubric += (
                "Award 'understood' only if all three criteria are met. "
                "Award 'neutral' if the explanation is partially correct but misses key points. "
                "Award 'did_not_understand' if it contains errors or is too vague to teach from."
            )
        elif activity_type == "wrong_on_purpose":
            grading_rubric = (
                "The student was shown a deliberately flawed statement and asked to identify the error. "
                "Evaluate whether the student correctly identified the flaw and explained WHY it is wrong. "
                "Award 'understood' if they pinpoint the specific error and reasoning is sound. "
                "Award 'neutral' if they sense something is off but can't articulate the exact flaw. "
                "Award 'did_not_understand' if they miss the flaw or incorrectly validate the statement."
            )

        grading = await asyncio.to_thread(
            grade_response,
            claim_content=claim.content,
            rubric=grading_rubric,
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


def grade_quiz_question(question: dict, response: str) -> tuple[str, str]:
    """Grade a single quiz question deterministically.

    Returns (outcome, feedback).
    """
    qtype = question.get("type", "")

    if qtype == "true_false":
        correct = str(question.get("correct_answer", "")).lower().strip()
        given = response.lower().strip()
        if given == correct:
            return "understood", "Correct!"
        return "did_not_understand", f"Incorrect. The answer was {correct}."

    elif qtype == "multi_choice":
        correct_index = str(question.get("correct_index", "")).strip()
        options = question.get("options", [])
        correct_text = ""
        if options and correct_index.isdigit() and int(correct_index) < len(options):
            correct_text = str(options[int(correct_index)])
        given = response.strip()
        if given == correct_index or (correct_text and given == correct_text):
            return "understood", "Correct!"
        fb = f"Incorrect. The answer was: {correct_text}" if correct_text else "Incorrect."
        return "did_not_understand", fb

    elif qtype == "fill_blank":
        correct = str(question.get("correct_answer", "")).strip()
        given = response.strip()
        if given.lower() == correct.lower():
            return "understood", f"Correct! The answer is \"{correct}\"."
        return "did_not_understand", f"Incorrect. The answer was \"{correct}\"."

    # short_answer — needs LLM, but fall back to lenient heuristic for deterministic path
    return "neutral", ""


async def evaluate_quiz(
    db: AsyncSession,
    user_id: str,
    activity: "Activity",
    answers: list[dict],
) -> dict:
    """Grade all quiz answers, update mastery per claim, return aggregate results.

    Each answer is {"question_index": int, "response": str}.
    """
    payload = activity.payload or {}
    questions = payload.get("questions", [])
    question_map = {q["index"]: q for q in questions}

    user = await db.get(User, user_id)
    if user is None:
        raise ValueError(f"User {user_id} not found")

    streak_days = await update_streak(db, user)
    difficulty = activity.difficulty

    results = []
    total_xp = 0
    correct_count = 0

    for ans in answers:
        idx = ans["question_index"]
        response = ans["response"]
        question = question_map.get(idx)
        if question is None:
            continue

        claim_id = question.get("claim_id")
        qtype = question.get("type", "")

        # Grade the question
        if qtype == "short_answer" and claim_id:
            # Use Bedrock for short answer
            try:
                claim = await db.get(AtomicClaim, claim_id)
                if claim:
                    import asyncio as _aio
                    grading = await _aio.to_thread(
                        grade_response,
                        claim_content=claim.content,
                        rubric=claim.rubric or "Accept any accurate, well-reasoned response.",
                        student_response=response,
                    )
                    outcome, feedback = _map_bedrock_result(grading)
                else:
                    outcome, feedback = "neutral", "Claim not found."
            except Exception:
                outcome, feedback = "neutral", "Could not grade this response."
        else:
            outcome, feedback = grade_quiz_question(question, response)

        is_correct = outcome == "understood"
        if is_correct:
            correct_count += 1

        # Update mastery for this claim
        if claim_id:
            rating_delta = calculate_rating_change(difficulty, outcome, False)
            await apply_rating_change(db, user_id, claim_id, rating_delta)

        xp = calculate_xp_reward(difficulty, outcome, streak_days)
        total_xp += xp

        # Record attempt
        attempt = ActivityAttempt(
            user_id=user_id,
            activity_id=activity.id,
            claim_id=claim_id,
            outcome=outcome,
            hints_used=False,
            difficulty=difficulty,
            xp_awarded=xp,
            rating_change=calculate_rating_change(difficulty, outcome, False),
        )
        db.add(attempt)

        results.append({
            "question_index": idx,
            "claim_id": claim_id or "",
            "type": qtype,
            "is_correct": is_correct,
            "feedback": feedback,
            "xp_awarded": xp,
        })

    # Update user XP
    user.xp = (user.xp or 0) + total_xp
    user.level = compute_level(user.xp)

    # Mark queue entry completed
    from app.services.queue import complete_queue_entry
    await complete_queue_entry(db, user_id, activity.id)

    await db.flush()

    return {
        "activity_id": activity.id,
        "total_questions": len(questions),
        "correct_count": correct_count,
        "total_xp": total_xp,
        "results": results,
    }
