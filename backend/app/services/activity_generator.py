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
        types = ["flashcard", "true_false", "multi_choice", "fill_blank", "wrong_on_purpose", "feynman"]

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

    # ── Wrong on Purpose ─────────────────────────────────────────────────────
    if "wrong_on_purpose" in types:
        wop_payload = _build_wrong_on_purpose(claim)
        if wop_payload:
            activity = Activity(
                workspace_id=workspace_id,
                creator_id=creator_id,
                scope="STUDENT_PERSONAL",
                type="wrong_on_purpose",
                title=f"Spot the Flaw: {claim.title}",
                difficulty=2,
                target_claim_ids=[claim.id],
                payload=wop_payload,
            )
            db.add(activity)
            activities.append(activity)

    # ── Feynman (teach the concept) ──────────────────────────────────────────
    if "feynman" in types:
        activity = Activity(
            workspace_id=workspace_id,
            creator_id=creator_id,
            scope="STUDENT_PERSONAL",
            type="feynman",
            title=f"Teach: {claim.title}",
            difficulty=2,
            target_claim_ids=[claim.id],
            payload={
                "concept": claim.title,
                "prompt": (
                    f"Explain {claim.title} in your own words as if teaching someone "
                    f"who has never encountered this concept. Use an analogy if it helps."
                ),
                "key_points": _extract_key_points(claim.content),
            },
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


def _build_wrong_on_purpose(claim: AtomicClaim) -> dict | None:
    """Build a deterministic Wrong on Purpose payload from a claim.

    Uses the claim's flawed_snippet if available.  Otherwise, generates a
    plausible-looking wrong assertion by negating or distorting the claim
    content.  Returns None if there's not enough material.
    """
    if claim.flawed_snippet:
        return {
            "claim": claim.diagnostic_prompt or f"Consider this statement about {claim.title}.",
            "flawed_snippet": claim.flawed_snippet,
            "prompt": "Identify the false premise in this reasoning.",
        }

    if not claim.content or len(claim.content) < 20:
        return None

    wrong_claim = _negate_claim(claim.content)
    return {
        "claim": wrong_claim,
        "flawed_snippet": None,
        "prompt": f"This statement about {claim.title} contains a deliberate error. Find and explain what is wrong.",
    }


def _negate_claim(content: str) -> str:
    """Create a plausibly-wrong version of a claim by inserting a negation."""
    negations = [
        (r"\bis\b", "is not"),
        (r"\bcan\b", "cannot"),
        (r"\bwill\b", "will not"),
        (r"\balways\b", "never"),
        (r"\bevery\b", "no"),
        (r"\bmust\b", "must not"),
    ]
    for pattern, replacement in negations:
        if re.search(pattern, content, re.IGNORECASE):
            return re.sub(pattern, replacement, content, count=1, flags=re.IGNORECASE)
    return content + " This is always true regardless of context."


def _extract_key_points(content: str) -> list[str]:
    """Pull key phrases from claim content for rubric construction.

    Splits on sentence boundaries and returns the most information-dense
    fragments (those with the most non-stopword tokens).
    """
    sentences = re.split(r"(?<=[.!?])\s+", content.strip())
    stopwords = {"the", "a", "an", "is", "are", "was", "were", "be", "been",
                 "being", "have", "has", "had", "do", "does", "did", "will",
                 "would", "could", "should", "may", "might", "shall", "can",
                 "to", "of", "in", "for", "on", "with", "at", "by", "from",
                 "as", "into", "through", "during", "before", "after", "and",
                 "but", "or", "nor", "not", "so", "yet", "both", "either",
                 "neither", "each", "every", "all", "any", "few", "more",
                 "most", "other", "some", "such", "no", "only", "own", "same",
                 "than", "too", "very", "just", "because", "if", "when", "that",
                 "this", "it", "its", "they", "them", "their", "we", "our",
                 "you", "your", "he", "she", "his", "her", "who", "which",
                 "what", "where", "how", "about", "up", "out", "then", "also"}
    scored = []
    for s in sentences:
        words = re.findall(r"\b[a-zA-Z]{2,}\b", s.lower())
        density = sum(1 for w in words if w not in stopwords)
        if density > 0:
            scored.append((density, s.strip()))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [s for _, s in scored[:3]]


async def generate_ai_activity(
    db: AsyncSession,
    claim: AtomicClaim,
    workspace_id: int,
    creator_id: str,
    activity_type: str = "wrong_on_purpose",
) -> Activity | None:
    """Call Bedrock to generate a richer activity (wrong_on_purpose / scenario).

    Returns None if Bedrock fails.  Falls back to a deterministic WoP if
    Bedrock is unavailable.
    """
    if activity_type not in ("wrong_on_purpose", "scenario"):
        activity_type = "wrong_on_purpose"

    # Try deterministic first for WoP — works without Bedrock
    if activity_type == "wrong_on_purpose":
        wop_payload = _build_wrong_on_purpose(claim)
        if wop_payload:
            activity = Activity(
                workspace_id=workspace_id,
                creator_id=creator_id,
                scope="STUDENT_PERSONAL",
                type="wrong_on_purpose",
                title=f"Spot the Flaw: {claim.title}",
                difficulty=2,
                target_claim_ids=[claim.id],
                payload=wop_payload,
            )
            db.add(activity)
            await db.flush()
            await db.refresh(activity)
            return activity

    try:
        from app.services.bedrock import grade_response

        prompt = (
            f"Generate a {activity_type.replace('_', ' ')} learning activity for this claim:\n"
            f"Title: {claim.title}\n"
            f"Content: {claim.content}\n\n"
            f"Return JSON with keys: type, title, payload (with question and context fields)."
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
            type=activity_type,
            title=f"{activity_type.replace('_', ' ').title()}: {claim.title}",
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
