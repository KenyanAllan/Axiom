"""Gamification engine — XP awards, streak tracking, and leveling.

Implements domain rules spec sections 5.1-5.3.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import User

logger = logging.getLogger(__name__)

# ── XP Constants (spec 5.3) ──────────────────────────────────────────────────

BASE_XP = 10

PERFORMANCE_BONUS: dict[str, int] = {
    "understood": 20,
    "did_not_understand": 5,
    "neutral": 10,
}

DIFFICULTY_MULTIPLIER: dict[int, float] = {
    1: 1.0,
    2: 1.5,
    3: 2.0,
}

MAX_STREAK_MULTIPLIER = 2.0
STREAK_BOOST_PER_DAY = 0.05


# ── Pure Functions ────────────────────────────────────────────────────────────


def calculate_streak_multiplier(streak_days: int) -> float:
    """1.0 base + 0.05 per streak day, capped at 2.0 (spec 5.3)."""
    return min(1.0 + STREAK_BOOST_PER_DAY * streak_days, MAX_STREAK_MULTIPLIER)


def calculate_xp_reward(difficulty: int, outcome: str, streak_days: int) -> int:
    """Full XP formula from spec 5.3.

    XPAwarded = (BaseXP + PerformanceBonus * DifficultyMultiplier) * StreakBoostMultiplier

    IMPORTANT: Always awards XP, even on failure (spec 5.1 — Completion Guarantee).
    """
    perf_bonus = PERFORMANCE_BONUS.get(outcome, PERFORMANCE_BONUS["neutral"])
    diff_mult = DIFFICULTY_MULTIPLIER.get(difficulty, DIFFICULTY_MULTIPLIER[1])
    streak_mult = calculate_streak_multiplier(streak_days)

    raw_xp = (BASE_XP + perf_bonus * diff_mult) * streak_mult
    xp = int(raw_xp)
    logger.info("Calculated XP reward: xp=%d, difficulty=%d, outcome=%s, streak_days=%d", xp, difficulty, outcome, streak_days)
    return xp


def compute_level(xp: int) -> int:
    """Level = xp // 200 + 1, capped at 99."""
    return min(xp // 200 + 1, 99)


# ── DB-Aware Functions ────────────────────────────────────────────────────────


async def update_streak(db: AsyncSession, user: User) -> int:
    """Update the user's daily streak counter (spec 5.2).

    Rules:
    - Same calendar day as last_active_date: no change (streak already counted).
    - Yesterday: increment streak_days by 1.
    - Older than yesterday (or no prior activity): reset streak_days to 1.

    Always updates last_active_date to today. Returns the new streak_days.
    """
    from datetime import timedelta

    today = date.today()

    if user.last_active_date is None:
        # First ever activity
        user.streak_days = 1
    elif user.last_active_date == today:
        # Already active today — no change to streak
        pass
    elif user.last_active_date == today - timedelta(days=1):
        # Last active yesterday — extend the streak
        user.streak_days = (user.streak_days or 0) + 1
    else:
        # Missed one or more days — reset streak
        user.streak_days = 1

    user.last_active_date = today

    logger.info("Updated streak: user_id=%s, streak_days=%d", user.id, user.streak_days)
    return user.streak_days
