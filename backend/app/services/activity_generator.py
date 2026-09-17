"""Activity auto-generation service — deterministic + optional AI activities.

Generates flashcard, true/false, multiple-choice, fill-in-the-blank activities,
flashcard decks, and quizzes from atomic claims at zero API cost.
Optionally calls Bedrock for richer activity types.
"""

from __future__ import annotations

import asyncio
import logging
import random
import re

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import Activity, AtomicClaim, Topic, UserMastery

logger = logging.getLogger(__name__)


async def _compute_difficulty(
    db: AsyncSession,
    user_id: str | None,
    claim_ids: list[str],
) -> int:
    """Map average understanding_rating to activity difficulty (1-3).

    Rating 1-2 → difficulty 1 (easy), 3 → difficulty 2 (medium), 4-5 → difficulty 3 (hard).
    Defaults to 1 when no mastery data exists.
    """
    if not user_id or not claim_ids:
        return 1

    result = await db.execute(
        select(UserMastery.understanding_rating).where(
            UserMastery.user_id == user_id,
            UserMastery.claim_id.in_(claim_ids),
        )
    )
    ratings = [r[0] for r in result.all() if r[0] is not None]
    if not ratings:
        return 1

    avg = sum(ratings) / len(ratings)
    if avg >= 4:
        return 3
    if avg >= 3:
        return 2
    return 1


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
        types = ["flashcard", "true_false", "multi_choice", "fill_blank"]

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

    # ── Fill in the Blank ─────────────────────────────────────────────────────
    if "fill_blank" in types:
        blank_statement, answer = _make_fill_blank(claim.title, claim.content)
        if blank_statement:
            activity = Activity(
                workspace_id=workspace_id,
                creator_id=creator_id,
                scope="STUDENT_PERSONAL",
                type="fill_blank",
                title=f"Fill in the Blank: {claim.title}",
                difficulty=1,
                target_claim_ids=[claim.id],
                payload={"statement": blank_statement, "correct_answer": answer},
            )
            db.add(activity)
            activities.append(activity)

    await db.flush()

    # Refresh all activities to get auto-generated IDs
    for a in activities:
        await db.refresh(a)

    return activities


def _make_fill_blank(title: str, content: str) -> tuple[str | None, str]:
    """Replace the claim title (key term) in the content with a blank.

    Returns (statement_with_blank, correct_answer) or (None, "") if the title
    doesn't appear in the content.
    """
    pattern = re.compile(re.escape(title), re.IGNORECASE)
    if not pattern.search(content):
        return None, ""
    blanked = pattern.sub("____", content, count=1)
    return blanked, title


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


# ── Claim selection helper ────────────────────────────────────────────────────


async def _pick_claims(
    db: AsyncSession,
    workspace_id: int,
    count: int,
    topic_ids: list[str] | None = None,
) -> list[AtomicClaim]:
    """Pick *count* claims, optionally filtered to specific topics.

    Randomly samples across topics so decks/quizzes feel varied.
    """
    stmt = select(AtomicClaim).join(Topic, AtomicClaim.topic_id == Topic.id)
    if topic_ids:
        stmt = stmt.where(Topic.id.in_(topic_ids))
    else:
        stmt = stmt.where(Topic.workspace_id == workspace_id)

    stmt = stmt.order_by(func.random()).limit(count)
    result = await db.execute(stmt)
    return list(result.scalars().all())


# ── Flashcard Deck ────────────────────────────────────────────────────────────


async def generate_flashcard_deck(
    db: AsyncSession,
    workspace_id: int,
    creator_id: str,
    deck_size: int = 10,
    topic_ids: list[str] | None = None,
) -> Activity:
    """Create a flashcard deck activity with N cards across topics."""
    claims = await _pick_claims(db, workspace_id, deck_size, topic_ids)
    if not claims:
        raise ValueError("No claims found to build a deck")

    claim_ids = [c.id for c in claims]
    difficulty = await _compute_difficulty(db, creator_id, claim_ids)

    cards = [
        {
            "index": i,
            "claim_id": c.id,
            "front": c.diagnostic_prompt or c.title,
            "back": c.content,
        }
        for i, c in enumerate(claims)
    ]

    activity = Activity(
        workspace_id=workspace_id,
        creator_id=creator_id,
        scope="STUDENT_PERSONAL",
        type="flashcard_deck",
        title=f"Flashcard Deck ({len(cards)} cards)",
        difficulty=difficulty,
        target_claim_ids=claim_ids,
        payload={"deck_size": len(cards), "cards": cards},
    )
    db.add(activity)
    await db.flush()
    await db.refresh(activity)
    return activity


# ── Quiz ──────────────────────────────────────────────────────────────────────

QUIZ_QUESTION_TYPES = ["multi_choice", "true_false", "fill_blank", "short_answer"]


async def generate_quiz(
    db: AsyncSession,
    workspace_id: int,
    creator_id: str,
    question_count: int = 5,
    topic_ids: list[str] | None = None,
    question_types: list[str] | None = None,
) -> Activity:
    """Create a quiz activity with mixed question types across topics."""
    allowed = question_types or QUIZ_QUESTION_TYPES
    claims = await _pick_claims(db, workspace_id, question_count, topic_ids)
    if not claims:
        raise ValueError("No claims found to build a quiz")

    claim_ids = [c.id for c in claims]
    difficulty = await _compute_difficulty(db, creator_id, claim_ids)

    questions: list[dict] = []
    for i, claim in enumerate(claims):
        qtype = random.choice(allowed)
        question = await _build_quiz_question(db, i, qtype, claim, allowed)
        questions.append(question)

    activity = Activity(
        workspace_id=workspace_id,
        creator_id=creator_id,
        scope="STUDENT_PERSONAL",
        type="quiz",
        title=f"Quiz ({len(questions)} questions)",
        difficulty=difficulty,
        target_claim_ids=claim_ids,
        payload={"question_count": len(questions), "questions": questions},
    )
    db.add(activity)
    await db.flush()
    await db.refresh(activity)
    return activity


async def _build_quiz_question(
    db: AsyncSession,
    index: int,
    qtype: str,
    claim: AtomicClaim,
    allowed_types: list[str],
) -> dict:
    """Build a single quiz question dict for the payload."""
    if qtype == "multi_choice":
        return await _build_mc_question(db, index, claim)
    elif qtype == "true_false":
        return {
            "index": index,
            "type": "true_false",
            "claim_id": claim.id,
            "prompt": claim.content,
            "correct_answer": True,
        }
    elif qtype == "fill_blank":
        blanked, answer = _make_fill_blank(claim.title, claim.content)
        if blanked:
            return {
                "index": index,
                "type": "fill_blank",
                "claim_id": claim.id,
                "prompt": blanked,
                "correct_answer": answer,
            }
        # Fall back to true_false if blank couldn't be made
        return {
            "index": index,
            "type": "true_false",
            "claim_id": claim.id,
            "prompt": claim.content,
            "correct_answer": True,
        }
    else:  # short_answer
        return {
            "index": index,
            "type": "short_answer",
            "claim_id": claim.id,
            "prompt": f"Explain in your own words: {claim.title}",
        }


async def _build_mc_question(
    db: AsyncSession, index: int, claim: AtomicClaim
) -> dict:
    """Build a multiple-choice question, falling back to true_false if not enough siblings."""
    sibling_result = await db.execute(
        select(AtomicClaim).where(
            AtomicClaim.topic_id == claim.topic_id,
            AtomicClaim.id != claim.id,
        )
    )
    siblings = list(sibling_result.scalars().all())

    if len(siblings) >= 3:
        distractors = random.sample(siblings, 3)
        options = [claim.content] + [d.content for d in distractors]
        random.shuffle(options)
        correct_index = options.index(claim.content)
        return {
            "index": index,
            "type": "multi_choice",
            "claim_id": claim.id,
            "prompt": f"Which statement is correct about {claim.title}?",
            "options": options,
            "correct_index": correct_index,
        }

    # Not enough siblings for MC, fall back to true/false
    return {
        "index": index,
        "type": "true_false",
        "claim_id": claim.id,
        "prompt": claim.content,
        "correct_answer": True,
    }
