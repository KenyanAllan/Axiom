"""Activity queue management — user-facing queue operations.

Implements domain rules spec sections 2.1-2.4.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.tables import (
    Activity,
    AtomicClaim,
    Topic,
    TopicPrerequisite,
    UserActivityQueue,
    UserMastery,
)

logger = logging.getLogger(__name__)


async def get_user_queue(
    db: AsyncSession,
    user_id: str,
    workspace_id: int | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict:
    """Return user's activity queue, filtered by workspace (spec 8.1).

    Ordering: incomplete first, then by added_at ascending.
    Returns {items: [...], total: int}.
    """
    query = (
        select(UserActivityQueue)
        .join(Activity, UserActivityQueue.activity_id == Activity.id)
        .options(selectinload(UserActivityQueue.activity))
        .where(UserActivityQueue.user_id == user_id)
    )

    count_query = (
        select(func.count())
        .select_from(UserActivityQueue)
        .join(Activity, UserActivityQueue.activity_id == Activity.id)
        .where(UserActivityQueue.user_id == user_id)
    )

    if workspace_id is not None:
        query = query.where(Activity.workspace_id == workspace_id)
        count_query = count_query.where(Activity.workspace_id == workspace_id)

    query = query.order_by(
        UserActivityQueue.is_completed.asc(),
        UserActivityQueue.added_at.asc(),
    )

    total = (await db.execute(count_query)).scalar() or 0

    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    entries = result.scalars().all()

    items = []
    for e in entries:
        act = e.activity
        items.append({
            "id": e.id,
            "activity": {
                "id": act.id,
                "type": act.type,
                "title": act.title,
                "difficulty": act.difficulty,
                "scope": act.scope,
                "target_claim_ids": act.target_claim_ids or [],
                "payload": act.payload or {},
                "is_completed": e.is_completed,
                "audit_passed": act.audit_passed,
                "created_at": act.created_at,
                "creator_id": act.creator_id,
                "workspace_id": act.workspace_id,
                "classroom_id": act.classroom_id,
            } if act else None,
            "is_completed": e.is_completed,
            "added_at": e.added_at,
            "completed_at": e.completed_at,
        })

    return {"items": items, "total": total}


async def add_to_queue(
    db: AsyncSession,
    user_id: str,
    activity_id: int,
) -> UserActivityQueue:
    """Add activity to user's queue (idempotent — skip if already exists, spec 2.2)."""
    existing = (
        await db.execute(
            select(UserActivityQueue).where(
                UserActivityQueue.user_id == user_id,
                UserActivityQueue.activity_id == activity_id,
            )
        )
    ).scalar_one_or_none()

    if existing is not None:
        return existing

    entry = UserActivityQueue(
        user_id=user_id,
        activity_id=activity_id,
    )
    db.add(entry)
    await db.flush()
    return entry


async def complete_queue_entry(
    db: AsyncSession,
    user_id: str,
    activity_id: int,
) -> None:
    """Mark queue entry as completed with timestamp."""
    result = await db.execute(
        select(UserActivityQueue).where(
            UserActivityQueue.user_id == user_id,
            UserActivityQueue.activity_id == activity_id,
        )
    )
    entry = result.scalar_one_or_none()

    if entry is None:
        logger.warning(
            "Queue entry not found for user=%s activity=%s", user_id, activity_id
        )
        return

    entry.is_completed = True
    entry.completed_at = datetime.now(timezone.utc)


async def auto_populate_queue(
    db: AsyncSession,
    user_id: str,
    workspace_id: int,
) -> None:
    """Auto-populate the user's queue for a workspace (spec 2.3).

    Strategy:
    1. Find topics in the workspace ordered by prerequisite DAG.
    2. For each topic, find unmastered claims.
    3. Select claims from the first topic that has unmastered claims.
    4. Add existing activities targeting those claims to the queue.
    """
    topics_result = await db.execute(
        select(Topic)
        .where(Topic.workspace_id == workspace_id)
        .options(selectinload(Topic.claims))
    )
    topics = list(topics_result.scalars().all())

    if not topics:
        return

    prereqs_result = await db.execute(
        select(TopicPrerequisite).where(
            TopicPrerequisite.topic_id.in_([t.id for t in topics])
        )
    )
    prereqs = prereqs_result.scalars().all()
    prereq_map: dict[str, set[str]] = {t.id: set() for t in topics}
    for p in prereqs:
        if p.topic_id in prereq_map:
            prereq_map[p.topic_id].add(p.prerequisite_id)

    # Topological sort (Kahn's algorithm)
    in_degree: dict[str, int] = {t.id: len(prereq_map.get(t.id, set())) for t in topics}
    queue_order: list[Topic] = []
    ready = [t for t in topics if in_degree[t.id] == 0]

    dependents: dict[str, list[str]] = {t.id: [] for t in topics}
    for tid, pids in prereq_map.items():
        for pid in pids:
            if pid in dependents:
                dependents[pid].append(tid)

    topic_map = {t.id: t for t in topics}

    while ready:
        ready.sort(key=lambda t: t.title or "")
        current = ready.pop(0)
        queue_order.append(current)
        for dep_id in dependents.get(current.id, []):
            in_degree[dep_id] -= 1
            if in_degree[dep_id] == 0 and dep_id in topic_map:
                ready.append(topic_map[dep_id])

    all_claim_ids = [c.id for t in topics for c in (t.claims or [])]
    mastery_map: dict[str, int] = {}
    if all_claim_ids:
        mastery_result = await db.execute(
            select(UserMastery).where(
                UserMastery.user_id == user_id,
                UserMastery.claim_id.in_(all_claim_ids),
            )
        )
        for m in mastery_result.scalars().all():
            mastery_map[m.claim_id] = m.understanding_rating

    target_claims: list[AtomicClaim] = []
    for topic in queue_order:
        unmastered = [
            c for c in (topic.claims or []) if mastery_map.get(c.id, 1) < 5
        ]
        if unmastered:
            target_claims = unmastered
            break

    if not target_claims:
        logger.info("All claims mastered for user=%s workspace=%s", user_id, workspace_id)
        return

    target_claim_ids = [c.id for c in target_claims]

    existing_activities = await db.execute(
        select(Activity).where(
            Activity.workspace_id == workspace_id,
            Activity.target_claim_ids.op("?|")(target_claim_ids),
        )
    )

    existing_queue = await db.execute(
        select(UserActivityQueue.activity_id).where(
            UserActivityQueue.user_id == user_id,
            UserActivityQueue.is_completed == False,  # noqa: E712
        )
    )
    existing_activity_ids = {row[0] for row in existing_queue.all()}

    for act in existing_activities.scalars().all():
        if act.id not in existing_activity_ids:
            await add_to_queue(db, user_id, act.id)

    await db.flush()
