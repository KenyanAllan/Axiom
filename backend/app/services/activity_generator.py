"""Activity auto-generation service — deterministic + optional AI activities.

Generates flashcard, true/false, and multiple-choice activities from atomic claims
at zero API cost.  Optionally calls Bedrock for richer activity types.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import Activity, AtomicClaim, Topic

logger = logging.getLogger(__name__)


async def generate_basic_activities(
    db: AsyncSession,
    claim: AtomicClaim,
    workspace_id: int,
    creator_id: str,
    types: list[str] | None = None,
) -> list[Activity]:
    """Generate deterministic (zero-cost) activities for a claim.

    Returns a list of persisted Activity rows.  ``types`` filters which
    activity types to generate (default: all three).
    """
    if types is None:
        types = ["flashcard", "true_false", "multi_choice"]

    activities: list[Activity] = []

    # ── Flashcard ────────────────────────────────────────────────────────────
    if "flashcard" in types:
        front = claim.diagnostic_prompt or claim.title
        activity = Activity(
            workspace_id=workspace_id,
            creator_id=creator_id,
            scope="STUDENT_PERSONAL",
            type="flashcard",
            title=f"Flashcard: {claim.title}",
            difficulty=1,
            target_claim_ids=[claim.id],
            payload={"front": front, "back": claim.content},
        )
        db.add(activity)
        activities.append(activity)

    # ── True / False ─────────────────────────────────────────────────────────
    if "true_false" in types:
        activity = Activity(
            workspace_id=workspace_id,
            creator_id=creator_id,
            scope="STUDENT_PERSONAL",
            type="true_false",
            title=f"True/False: {claim.title}",
            difficulty=1,
            target_claim_ids=[claim.id],
            payload={"statement": claim.content, "correct_answer": True},
        )
        db.add(activity)
        activities.append(activity)

    # ── Multiple Choice (needs sibling claims in the same topic) ─────────────
    if "multi_choice" in types:
        sibling_result = await db.execute(
            select(AtomicClaim).where(
                AtomicClaim.topic_id == claim.topic_id,
                AtomicClaim.id != claim.id,
            )
        )
        siblings = list(sibling_result.scalars().all())

        if len(siblings) >= 3:
            # Take up to 3 distractors
            distractors = siblings[:3]
            options = [claim.content] + [d.content for d in distractors]
            activity = Activity(
                workspace_id=workspace_id,
                creator_id=creator_id,
                scope="STUDENT_PERSONAL",
                type="multi_choice",
                title=f"Multiple Choice: {claim.title}",
                difficulty=1,
                target_claim_ids=[claim.id],
                payload={
                    "question": f"Which statement is correct about {claim.title}?",
                    "options": options,
                    "correct_index": 0,
                },
            )
            db.add(activity)
            activities.append(activity)

    await db.flush()

    # Refresh all activities to get auto-generated IDs
    for a in activities:
        await db.refresh(a)

    return activities


async def generate_ai_activity(
    db: AsyncSession,
    claim: AtomicClaim,
    workspace_id: int,
    creator_id: str,
) -> Activity | None:
    """Call Bedrock to generate a richer activity (wrong_on_purpose / scenario).

    Returns None if Bedrock fails.
    """
    try:
        from app.services.bedrock import grade_response  # reuse client infrastructure

        prompt = (
            f"Generate a scenario-based learning activity for this claim:\n"
            f"Title: {claim.title}\n"
            f"Content: {claim.content}\n\n"
            f"Return JSON with keys: type (wrong_on_purpose or scenario), "
            f"title, payload (with question and context fields)."
        )

        result = await asyncio.to_thread(
            grade_response,
            claim_content=claim.content,
            rubric="Generate an activity, not grade a response.",
            student_response=prompt,
        )

        activity = Activity(
            workspace_id=workspace_id,
            creator_id=creator_id,
            scope="STUDENT_PERSONAL",
            type="scenario",
            title=f"Scenario: {claim.title}",
            difficulty=2,
            target_claim_ids=[claim.id],
            payload={"question": result.get("feedback", claim.content), "context": claim.content},
        )
        db.add(activity)
        await db.flush()
        await db.refresh(activity)
        return activity

    except Exception:
        logger.exception("AI activity generation failed for claim %s", claim.id)
        return None
