"""Activity queue management — user-facing queue operations.

Implements domain rules spec sections 2.1-2.4.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import and_, delete, func, select
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
    base_filter = [UserActivityQueue.user_id == user_id]

    # Build a subquery to join with Activity for workspace filtering
    query = (
        select(UserActivityQueue)
        .join(Activity, UserActivityQueue.activity_id == Activity.id)
        .options(selectinload(UserActivityQueue.activity))
    )

    if workspace_id is not None:
        query = query.where(
            UserActivityQueue.user_id == user_id,
            Activity.workspace_id == workspace_id,
        )
    else:
        query = query.where(UserActivityQueue.user_id == user_id)

    # Order: incomplete first (False < True, so is_completed ASC puts False first),
    # then by added_at ascending
    query = query.order_by(
        UserActivityQueue.is_completed.asc(),
        UserActivityQueue.added_at.asc(),
    )

    # Count total
    count_query = (
        select(func.count())
        .select_from(UserActivityQueue)
        .join(Activity, UserActivityQueue.activity_id == Activity.id)
    )
    if workspace_id is not None:
        count_query = count_query.where(
            UserActivityQueue.user_id == user_id,
            Activity.workspace_id == workspace_id,
        )
    else:
        count_query = count_query.where(UserActivityQueue.user_id == user_id)

    total = (await db.execute(count_query)).scalar() or 0

    # Apply pagination
    query = query.offset(offset).limit(limit)
    result = await db.execute(query)
    entries = result.scalars().all()

    items = [
        {
            "queue_id": e.id,
            "activity_id": e.activity_id,
            "is_completed": e.is_completed,
            "completed_at": e.completed_at.isoformat() if e.completed_at else None,
            "added_at": e.added_at.isoformat() if e.added_at else None,
            "activity": {
                "id": e.activity.id,
                "type": e.activity.type,
                "title": e.activity.title,
                "difficulty": e.activity.difficulty,
                "scope": e.activity.scope,
            }
            if e.activity
            else None,
        }
        for e in entries
    ]

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


async def drop_mastered_claims(
    db: AsyncSession,
    user_id: str,
    claim_id: str,
) -> None:
    """When claim reaches rating 5, remove all incomplete queue entries for
    activities targeting only that claim (spec 1.1).
    """
    # Find activities whose target_claim_ids contain only this claim
    activities_result = await db.execute(select(Activity))
    activities = activities_result.scalars().all()

    activity_ids_to_drop: list[int] = []
    for activity in activities:
        target_ids = activity.target_claim_ids or []
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


async def auto_populate_queue(
    db: AsyncSession,
    user_id: str,
    workspace_id: int,
) -> None:
    """Auto-populate the user's queue for a workspace (spec 2.3).

    Strategy:
    1. Find topics in the workspace.
    2. For each topic (respecting prerequisite DAG order), find unmastered claims.
    3. Select claims from the first topic that has unmastered claims.
    4. If all claims in a topic are mastered, advance to next topic per DAG.
    5. Create activities for the selected claims and add them to the queue.

    Note: This creates placeholder activity records. The actual activity
    content/type should be determined by the caller or a generation service.
    """
    # Get all topics in workspace, ordered (topics without prereqs first)
    topics_result = await db.execute(
        select(Topic)
        .where(Topic.workspace_id == workspace_id)
        .options(selectinload(Topic.claims))
    )
    topics = list(topics_result.scalars().all())

    if not topics:
        return

    # Build DAG: topic_id -> set of prerequisite topic IDs
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

    # Build reverse dependency map
    dependents: dict[str, list[str]] = {t.id: [] for t in topics}
    for tid, pids in prereq_map.items():
        for pid in pids:
            if pid in dependents:
                dependents[pid].append(tid)

    topic_map = {t.id: t for t in topics}

    while ready:
        # Sort by title for determinism
        ready.sort(key=lambda t: t.title or "")
        current = ready.pop(0)
        queue_order.append(current)
        for dep_id in dependents.get(current.id, []):
            in_degree[dep_id] -= 1
            if in_degree[dep_id] == 0 and dep_id in topic_map:
                ready.append(topic_map[dep_id])

    # Get user's mastery for all claims in workspace
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

    # Find the first topic with unmastered claims
    target_claims: list[AtomicClaim] = []
    for topic in queue_order:
        unmastered = [
            c
            for c in (topic.claims or [])
            if mastery_map.get(c.id, 1) < 5
        ]
        if unmastered:
            target_claims = unmastered
            break

    if not target_claims:
        logger.info("All claims mastered for user=%s workspace=%s", user_id, workspace_id)
        return

    # Check which claims already have activities in the user's queue
    existing_queue = await db.execute(
        select(UserActivityQueue.activity_id).where(
            UserActivityQueue.user_id == user_id,
            UserActivityQueue.is_completed == False,  # noqa: E712
        )
    )
    existing_activity_ids = {row[0] for row in existing_queue.all()}

    # Find activities already targeting these claims in the workspace
    existing_activities = await db.execute(
        select(Activity).where(
            Activity.workspace_id == workspace_id,
        )
    )
    claim_to_activity: dict[str, int] = {}
    for act in existing_activities.scalars().all():
        for cid in (act.target_claim_ids or []):
            if cid not in claim_to_activity:
                claim_to_activity[cid] = act.id

    for claim in target_claims:
        if claim.id in claim_to_activity:
            act_id = claim_to_activity[claim.id]
            if act_id not in existing_activity_ids:
                await add_to_queue(db, user_id, act_id)
        # If no existing activity, skip — activity generation is handled elsewhere

    await db.flush()
