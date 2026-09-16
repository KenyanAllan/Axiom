"""Evaluation orchestrator — ties Bedrock grading to DB mastery updates."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.tables import AtomicClaim, User, UserMastery
from app.services.bedrock import grade_response

logger = logging.getLogger(__name__)
settings = get_settings()

XP_CORRECT = settings.xp_per_correct_answer  # 50


def _compute_level(xp: int) -> int:
    """Simple threshold leveling: level = xp // 200 + 1, capped at 99."""
    return min(xp // 200 + 1, 99)


async def evaluate_student_response(
    db: AsyncSession,
    user_id: str,
    claim_id: str,
    student_response: str,
) -> dict:
    """Run the full evaluation pipeline.

    1. Fetch claim + rubric from DB.
    2. Call Bedrock to grade.
    3. Update mastery and XP.
    4. Return evaluation result.
    """
    # ── 1. Load the claim ────────────────────────────────────────────────────
    claim = await db.get(AtomicClaim, claim_id)
    if claim is None:
        raise ValueError(f"Claim {claim_id} not found")

    rubric = claim.rubric or "Accept any accurate, well-reasoned response."

    # ── 2. Grade with Bedrock ────────────────────────────────────────────────
    grading = grade_response(
        claim_content=claim.content,
        rubric=rubric,
        student_response=student_response,
    )
    is_correct = grading["is_correct"]
    feedback = grading["feedback"]

    # ── 3. Upsert mastery record ─────────────────────────────────────────────
    mastery = (
        await db.execute(
            select(UserMastery).where(
                UserMastery.user_id == user_id,
                UserMastery.claim_id == claim_id,
            )
        )
    ).scalar_one_or_none()

    now = datetime.now(timezone.utc)
    xp_awarded = 0

    if mastery is None:
        mastery = UserMastery(
            user_id=user_id,
            claim_id=claim_id,
            status="active",
            history=[],
            updated_at=now,
        )
        db.add(mastery)

    # Build history entry
    history_entry = {
        "timestamp": now.isoformat(),
        "is_correct": is_correct,
        "response_preview": student_response[:200],
    }

    # Append to JSONB history (creates new list to trigger change detection)
    mastery.history = [*(mastery.history or []), history_entry]
    mastery.updated_at = now

    if is_correct and mastery.status != "mastered":
        mastery.status = "mastered"
        xp_awarded = XP_CORRECT
    elif not is_correct and mastery.status == "unseen":
        mastery.status = "active"

    # ── 4. Update user XP ────────────────────────────────────────────────────
    user = await db.get(User, user_id)
    if user is None:
        raise ValueError(f"User {user_id} not found")

    if xp_awarded > 0:
        user.xp = (user.xp or 0) + xp_awarded
        user.level = _compute_level(user.xp)

    # Flush so response reflects latest state (commit handled by dependency)
    await db.flush()

    return {
        "claim_id": claim_id,
        "is_correct": is_correct,
        "feedback": feedback,
        "xp_awarded": xp_awarded,
        "new_status": mastery.status,
        "total_xp": user.xp,
        "level": user.level,
    }
