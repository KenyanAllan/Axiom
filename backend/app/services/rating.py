"""Rating adjustment engine — updates understandingRating per activity outcome.

Implements domain rules spec section 4.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import Activity, AtomicClaim, UserActivityQueue, UserMastery

logger = logging.getLogger(__name__)

# Rating bounds (spec 1.1)
MIN_RATING = 1
MAX_RATING = 5


def calculate_rating_change(difficulty: int, outcome: str, hints_used: bool) -> int:
    """Compute the rating delta from spec section 4.

    | Difficulty      | Outcome              | Hints? | Delta |
    |-----------------|----------------------|--------|-------|
    | Simple (1)      | understood (correct) | No     | +1    |
    | Hard (2 or 3)   | understood (correct) | No     | +2    |
    | Any             | did_not_understand   | No     | -1    |
    | Any             | understood (correct) | Yes    |  0    |
    | Any             | did_not_understand   | Yes    | -1    |
    | Any             | neutral              | *      |  0    |

    Returns the raw delta. Caller must clamp the resulting rating to [1, 5].
    """
    # Neutral outcome always results in no change
    if outcome == "neutral":
        return 0

    if hints_used:
        # Used hints + got it right => no change
        if outcome == "understood":
            return 0
        # Used hints + made a mistake => -1
        return -1

    # No hints used
    if outcome == "understood":
        # Simple activity => +1, Hard activity => +2
        if difficulty <= 1:
            return 1
        else:
            return 2

    # did_not_understand without hints => -1
    return -1


async def apply_rating_change(
    db: AsyncSession,
    user_id: str,
    claim_id: str,
    delta: int,
) -> tuple[int, str]:
    """Upsert UserMastery, apply delta (clamped 1-5), derive status.

    Status rules:
    - rating 5 => 'mastered'
    - rating 1 with empty history => 'unseen'
    - else => 'active'

    Side-effect: when rating reaches 5 (mastered), drop all incomplete queue
    entries for activities that target *only* this claim (spec 1.1).

    Returns (new_rating, new_status).
    """
    now = datetime.now(timezone.utc)

    # ── Upsert mastery ───────────────────────────────────────────────────────
    result = await db.execute(
        select(UserMastery).where(
            UserMastery.user_id == user_id,
            UserMastery.claim_id == claim_id,
        )
    )
    mastery = result.scalar_one_or_none()

    if mastery is None:
        mastery = UserMastery(
            user_id=user_id,
            claim_id=claim_id,
            understanding_rating=MIN_RATING,
            status="unseen",
            history=[],
            updated_at=now,
        )
        db.add(mastery)
        await db.flush()

    # Apply delta with clamping
    old_rating = mastery.understanding_rating or MIN_RATING
    new_rating = max(MIN_RATING, min(MAX_RATING, old_rating + delta))
    mastery.understanding_rating = new_rating

    # Derive status
    if new_rating >= MAX_RATING:
        new_status = "mastered"
    elif new_rating <= MIN_RATING and not mastery.history:
        new_status = "unseen"
    else:
        new_status = "active"

    mastery.status = new_status
    mastery.updated_at = now

    # ── Drop queue entries when mastered (spec 1.1) ──────────────────────────
    if new_status == "mastered":
        await _drop_mastered_queue_entries(db, user_id, claim_id)

    return new_rating, new_status


async def _drop_mastered_queue_entries(
    db: AsyncSession,
    user_id: str,
    claim_id: str,
) -> None:
    """Remove incomplete queue entries for activities targeting only this claim."""
    # Find activities that target this claim
    activities_result = await db.execute(select(Activity))
    activities = activities_result.scalars().all()

    activity_ids_to_drop: list[int] = []
    for activity in activities:
        target_ids = activity.target_claim_ids or []
        # Only drop if this claim is the sole target
        if target_ids == [claim_id]:
            activity_ids_to_drop.append(activity.id)

    if activity_ids_to_drop:
        await db.execute(
            delete(UserActivityQueue).where(
                UserActivityQueue.user_id == user_id,
                UserActivityQueue.activity_id.in_(activity_ids_to_drop),
                UserActivityQueue.is_completed == False,  # noqa: E712
            )
        )
