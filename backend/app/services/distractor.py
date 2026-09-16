"""Distractor sampling — history-aware neighboring claim selection.

Implements domain rules spec section 10.
"""

from __future__ import annotations

import logging
import random
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import (
    ActivityAttempt,
    AtomicClaim,
    Topic,
    TopicPrerequisite,
)

logger = logging.getLogger(__name__)


async def sample_distractors(
    db: AsyncSession,
    user_id: str,
    target_claim_id: str,
    count: int = 3,
) -> list[dict]:
    """Sample distractor claims for a target claim (spec 10.1).

    Algorithm:
    1. Get target claim's topic + neighboring prerequisite/dependent topics.
    2. Collect candidate claims from those topics (excluding target).
    3. Exclude claims used as distractors in student's last 3 attempts for this target.
    4. If fewer than `count` remain, relax history filter.
    5. Return list of {id, title, content} for distractor claims.
    """
    # ── 1. Get target claim and its topic ────────────────────────────────────
    target_claim = await db.get(AtomicClaim, target_claim_id)
    if target_claim is None:
        raise ValueError(f"Claim {target_claim_id} not found")

    target_topic_id = target_claim.topic_id

    # ── 2. Get neighboring topics (prerequisites + dependents) ───────────────
    # Prerequisites of target topic
    prereq_result = await db.execute(
        select(TopicPrerequisite.prerequisite_id).where(
            TopicPrerequisite.topic_id == target_topic_id
        )
    )
    prereq_ids = {row[0] for row in prereq_result.all()}

    # Topics that depend on target topic (target is their prerequisite)
    dependent_result = await db.execute(
        select(TopicPrerequisite.topic_id).where(
            TopicPrerequisite.prerequisite_id == target_topic_id
        )
    )
    dependent_ids = {row[0] for row in dependent_result.all()}

    # Combine: target topic + neighbors
    neighboring_topic_ids = {target_topic_id} | prereq_ids | dependent_ids

    # ── 3. Collect candidate claims from neighboring topics ──────────────────
    candidates_result = await db.execute(
        select(AtomicClaim).where(
            AtomicClaim.topic_id.in_(neighboring_topic_ids),
            AtomicClaim.id != target_claim_id,
        )
    )
    all_candidates = list(candidates_result.scalars().all())

    if not all_candidates:
        logger.warning(
            "No distractor candidates for claim=%s", target_claim_id
        )
        return []

    # ── 4. History exclusion — last 3 attempts for this target ───────────────
    recent_attempts_result = await db.execute(
        select(ActivityAttempt)
        .where(
            ActivityAttempt.user_id == user_id,
            ActivityAttempt.claim_id == target_claim_id,
        )
        .order_by(ActivityAttempt.attempted_at.desc())
        .limit(3)
    )
    recent_attempts = recent_attempts_result.scalars().all()

    # Collect claim IDs used as distractors in those attempts
    # Distractors are stored in the activity payload
    from app.models.tables import Activity

    recent_distractor_ids: set[str] = set()
    for attempt in recent_attempts:
        activity = await db.get(Activity, attempt.activity_id)
        if activity and activity.payload:
            distractor_ids = activity.payload.get("distractor_claim_ids", [])
            recent_distractor_ids.update(distractor_ids)

    # Filter out recently used distractors
    filtered_candidates = [
        c for c in all_candidates if c.id not in recent_distractor_ids
    ]

    # ── 5. Fallback: relax filter if not enough candidates ───────────────────
    if len(filtered_candidates) < count:
        logger.info(
            "Relaxing history filter for claim=%s (only %d candidates after filter)",
            target_claim_id,
            len(filtered_candidates),
        )
        filtered_candidates = all_candidates

    # ── 6. Sample and return ─────────────────────────────────────────────────
    selected = random.sample(
        filtered_candidates, min(count, len(filtered_candidates))
    )

    return [
        {
            "id": c.id,
            "title": c.title,
            "content": c.content,
        }
        for c in selected
    ]
