"""DAG manager — topological ordering, prerequisite management, wiki consolidation.

Centralizes all DAG operations on the Topic prerequisite graph:
- Cycle detection (DFS)
- Topological sort (Kahn's algorithm)
- Frontier computation
- Wiki consolidation via vector similarity (spec 9.1)
- Prerequisite auto-inference for newly ingested topics
"""

from __future__ import annotations

import logging
import re
from typing import Sequence

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.tables import (
    AtomicClaim,
    Topic,
    TopicPrerequisite,
    UserMastery,
)

logger = logging.getLogger(__name__)

SIMILARITY_THRESHOLD = 0.82


# ── Cycle detection ──────────────────────────────────────────────────────────


async def would_create_cycle(
    db: AsyncSession,
    topic_id: str,
    new_prerequisite_id: str,
) -> bool:
    """Return True if adding new_prerequisite_id → topic_id would create a cycle.

    DFS from new_prerequisite_id following all prerequisite edges.  If we
    can reach topic_id, the edge would close a cycle.
    """
    if topic_id == new_prerequisite_id:
        return True

    visited: set[str] = set()
    stack = [new_prerequisite_id]

    while stack:
        current = stack.pop()
        if current in visited:
            continue
        visited.add(current)

        result = await db.execute(
            select(TopicPrerequisite.prerequisite_id).where(
                TopicPrerequisite.topic_id == current
            )
        )
        for (prereq_id,) in result.all():
            if prereq_id == topic_id:
                return True
            if prereq_id not in visited:
                stack.append(prereq_id)

    return False


async def add_prerequisite_safe(
    db: AsyncSession,
    topic_id: str,
    prerequisite_id: str,
) -> bool:
    """Add a prerequisite edge if it won't create a cycle.

    Returns True if the edge was added, False if it was skipped (cycle or dup).
    """
    existing = (
        await db.execute(
            select(TopicPrerequisite).where(
                TopicPrerequisite.topic_id == topic_id,
                TopicPrerequisite.prerequisite_id == prerequisite_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return False

    if await would_create_cycle(db, topic_id, prerequisite_id):
        logger.info(
            "Skipped prerequisite %s → %s (would create cycle)",
            prerequisite_id,
            topic_id,
        )
        return False

    db.add(TopicPrerequisite(topic_id=topic_id, prerequisite_id=prerequisite_id))
    await db.flush()
    return True


# ── Topological sort ─────────────────────────────────────────────────────────


async def topological_sort(
    db: AsyncSession,
    workspace_id: int,
) -> list[Topic]:
    """Return topics in the workspace in topological (prerequisite-first) order.

    Uses Kahn's algorithm.  Ties broken alphabetically by title.
    """
    topics_result = await db.execute(
        select(Topic)
        .where(Topic.workspace_id == workspace_id)
        .options(selectinload(Topic.claims))
    )
    topics = list(topics_result.scalars().all())
    if not topics:
        return []

    topic_ids = {t.id for t in topics}

    prereqs_result = await db.execute(
        select(TopicPrerequisite).where(
            TopicPrerequisite.topic_id.in_(topic_ids)
        )
    )
    prereqs = prereqs_result.scalars().all()

    prereq_map: dict[str, set[str]] = {t.id: set() for t in topics}
    for p in prereqs:
        if p.topic_id in prereq_map and p.prerequisite_id in topic_ids:
            prereq_map[p.topic_id].add(p.prerequisite_id)

    in_degree = {t.id: len(prereq_map[t.id]) for t in topics}
    dependents: dict[str, list[str]] = {t.id: [] for t in topics}
    for tid, pids in prereq_map.items():
        for pid in pids:
            if pid in dependents:
                dependents[pid].append(tid)

    topic_map = {t.id: t for t in topics}
    ready = sorted(
        [t for t in topics if in_degree[t.id] == 0],
        key=lambda t: t.title or "",
    )
    result: list[Topic] = []

    while ready:
        current = ready.pop(0)
        result.append(current)
        for dep_id in dependents.get(current.id, []):
            in_degree[dep_id] -= 1
            if in_degree[dep_id] == 0 and dep_id in topic_map:
                ready.append(topic_map[dep_id])
                ready.sort(key=lambda t: t.title or "")

    return result


# ── Frontier computation ─────────────────────────────────────────────────────


async def compute_frontier(
    db: AsyncSession,
    user_id: str,
    workspace_id: int | None = None,
) -> list[dict]:
    """Return the user's learning frontier — topics that are not fully mastered
    and whose prerequisites are all mastered.

    If workspace_id is given, scopes to that workspace.
    Returns list of {topic_id, slug, title, claim_count, mastered_count}.
    """
    params: dict = {"user_id": user_id}
    workspace_filter = ""
    if workspace_id is not None:
        workspace_filter = "AND t.workspace_id = :workspace_id"
        params["workspace_id"] = workspace_id

    sql = text(f"""
    WITH topic_claim_counts AS (
        SELECT
            t.id AS topic_id,
            t.slug,
            t.title,
            t.complexity_score,
            COUNT(ac.id)::int AS claim_count,
            COUNT(um.claim_id) FILTER (WHERE um.status = 'mastered')::int AS mastered_count
        FROM topics t
        LEFT JOIN atomic_claims ac ON ac.topic_id = t.id
        LEFT JOIN user_mastery um
            ON um.claim_id = ac.id AND um.user_id = :user_id
        WHERE 1=1 {workspace_filter}
        GROUP BY t.id, t.slug, t.title, t.complexity_score
    ),
    fully_mastered_topics AS (
        SELECT topic_id
        FROM topic_claim_counts
        WHERE claim_count > 0 AND mastered_count = claim_count
    ),
    frontier AS (
        SELECT tc.*
        FROM topic_claim_counts tc
        WHERE tc.mastered_count < tc.claim_count
          AND NOT EXISTS (
              SELECT 1
              FROM topic_prerequisites tp
              WHERE tp.topic_id = tc.topic_id
                AND tp.prerequisite_id NOT IN (SELECT topic_id FROM fully_mastered_topics)
          )
    )
    SELECT topic_id, slug, title, claim_count, mastered_count, complexity_score
    FROM frontier
    ORDER BY COALESCE(complexity_score, 3.0) ASC, mastered_count DESC, title ASC
    """)

    rows = (await db.execute(sql, params)).all()
    return [
        {
            "topic_id": r.topic_id,
            "slug": r.slug,
            "title": r.title,
            "claim_count": r.claim_count,
            "mastered_count": r.mastered_count,
            "complexity_score": r.complexity_score,
        }
        for r in rows
    ]


# ── Wiki consolidation (spec 9.1) ───────────────────────────────────────────


async def find_matching_topic(
    db: AsyncSession,
    workspace_id: int,
    candidate_embedding: list[float],
    threshold: float = SIMILARITY_THRESHOLD,
) -> Topic | None:
    """Find an existing topic in the workspace whose embedding is above
    the similarity threshold (cosine >= 0.82).

    Returns the best match, or None if all are below threshold.
    """
    stmt = (
        select(
            Topic,
            Topic.embedding.cosine_distance(candidate_embedding).label("distance"),
        )
        .where(
            Topic.workspace_id == workspace_id,
            Topic.embedding.isnot(None),
        )
        .order_by(Topic.embedding.cosine_distance(candidate_embedding))
        .limit(1)
    )
    row = (await db.execute(stmt)).first()

    if row is None:
        return None

    topic, distance = row
    similarity = 1.0 - distance
    logger.info(
        "Best topic match for workspace %s: %s (similarity=%.4f)",
        workspace_id,
        topic.title,
        similarity,
    )

    if similarity >= threshold:
        return topic
    return None


def slugify(title: str) -> str:
    """Convert a title to a URL-friendly slug."""
    slug = title.lower().strip()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"[\s]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug


async def get_or_create_topic(
    db: AsyncSession,
    workspace_id: int,
    title: str,
    summary: str | None,
    embedding: list[float] | None,
) -> tuple[Topic, bool]:
    """Find a matching topic by vector similarity, or create a new one.

    Implements spec 9.1:
      - cosine >= 0.82 → return existing topic (will be extended)
      - cosine <  0.82 → create new topic

    Returns (topic, is_new).
    """
    if embedding is not None:
        existing = await find_matching_topic(db, workspace_id, embedding)
        if existing is not None:
            if summary and (not existing.summary or len(summary) > len(existing.summary)):
                existing.summary = summary
            return existing, False

    slug = slugify(title)
    topic_id = f"top_{slug}"

    # Check if slug already exists (dedup)
    dup = (
        await db.execute(select(Topic).where(Topic.slug == slug))
    ).scalar_one_or_none()
    if dup is not None:
        return dup, False

    topic = Topic(
        id=topic_id,
        workspace_id=workspace_id,
        slug=slug,
        title=title,
        summary=summary,
        embedding=embedding,
    )
    db.add(topic)
    await db.flush()
    logger.info("Created new topic %s in workspace %s", topic_id, workspace_id)
    return topic, True


# ── Prerequisite auto-inference ──────────────────────────────────────────────


async def infer_prerequisites(
    db: AsyncSession,
    topic: Topic,
    workspace_id: int,
) -> list[str]:
    """Attempt to infer prerequisite edges for a newly created topic based on
    vector similarity to existing topics.

    Heuristic: if a topic's embedding is moderately similar (0.5–0.82) to
    another topic, and the other topic has more claims already, assume the
    other is a prerequisite (it covers foundational material).

    Returns list of prerequisite_ids that were added.
    """
    if topic.embedding is None:
        return []

    stmt = (
        select(
            Topic,
            Topic.embedding.cosine_distance(topic.embedding).label("distance"),
        )
        .where(
            Topic.workspace_id == workspace_id,
            Topic.id != topic.id,
            Topic.embedding.isnot(None),
        )
        .order_by(Topic.embedding.cosine_distance(topic.embedding))
        .limit(5)
    )
    rows = (await db.execute(stmt)).all()

    added: list[str] = []
    for candidate, distance in rows:
        similarity = 1.0 - distance
        if similarity < 0.5:
            break

        # Already above merge threshold — skip, these are "same topic"
        if similarity >= SIMILARITY_THRESHOLD:
            continue

        # Heuristic: topic with more claims is likely more foundational
        candidate_claim_count = len(candidate.claims or [])
        topic_claim_count = len(topic.claims or [])

        if candidate_claim_count > topic_claim_count:
            if await add_prerequisite_safe(db, topic.id, candidate.id):
                added.append(candidate.id)
                logger.info(
                    "Auto-inferred prerequisite: %s → %s (similarity=%.3f)",
                    candidate.id,
                    topic.id,
                    similarity,
                )

    return added


# ── Full DAG stats ───────────────────────────────────────────────────────────


async def get_dag_stats(
    db: AsyncSession,
    workspace_id: int,
) -> dict:
    """Return summary statistics about the topic DAG in a workspace."""
    topics = await topological_sort(db, workspace_id)

    edge_result = await db.execute(
        select(func.count()).select_from(TopicPrerequisite).where(
            TopicPrerequisite.topic_id.in_([t.id for t in topics])
        )
    )
    edge_count = edge_result.scalar() or 0

    root_count = 0
    leaf_count = 0
    topic_ids = {t.id for t in topics}

    for t in topics:
        prereqs = [p for p in (t.prerequisites or []) if p.id in topic_ids]
        if not prereqs:
            root_count += 1

    dep_result = await db.execute(
        select(TopicPrerequisite.prerequisite_id).where(
            TopicPrerequisite.prerequisite_id.in_(topic_ids)
        )
    )
    has_dependents = {row[0] for row in dep_result.all()}
    leaf_count = sum(1 for t in topics if t.id not in has_dependents)

    return {
        "workspace_id": workspace_id,
        "topic_count": len(topics),
        "edge_count": edge_count,
        "root_count": root_count,
        "leaf_count": leaf_count,
        "topological_order": [
            {"id": t.id, "title": t.title} for t in topics
        ],
    }
