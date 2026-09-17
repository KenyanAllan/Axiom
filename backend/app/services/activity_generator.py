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

from app.models.tables import Activity, AtomicClaim, Topic, TopicPrerequisite, UserMastery

logger = logging.getLogger(__name__)


async def _compute_difficulty(
    db: AsyncSession,
    user_id: str | None,
    claim_ids: list[str],
) -> int:
    """Blended difficulty: student mastery (60%) + intrinsic claim complexity (40%).

    Mastery component: understanding_rating 1-2 → 1, 3 → 2, 4-5 → 3.
    Intrinsic component: complexity_score 1-5 mapped to 1-3.
    Defaults to 1 when no data exists.
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
        mastery_diff = 1.0
    else:
        avg = sum(ratings) / len(ratings)
        if avg >= 4:
            mastery_diff = 3.0
        elif avg >= 3:
            mastery_diff = 2.0
        else:
            mastery_diff = 1.0

    complexity_result = await db.execute(
        select(AtomicClaim.complexity_score).where(
            AtomicClaim.id.in_(claim_ids),
            AtomicClaim.complexity_score.isnot(None),
        )
    )
    scores = [r[0] for r in complexity_result.all()]
    if scores:
        avg_complexity = sum(scores) / len(scores)
        intrinsic_diff = 1.0 + (avg_complexity - 1.0) * 0.5
        intrinsic_diff = max(1.0, min(3.0, intrinsic_diff))
    else:
        intrinsic_diff = mastery_diff

    blended = 0.4 * intrinsic_diff + 0.6 * mastery_diff
    return max(1, min(3, round(blended)))


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
        show_true = random.random() < 0.5
        if show_true:
            statement = claim.content
            correct_answer = True
        else:
            statement = _negate_claim(claim.content)
            correct_answer = False
        activity = Activity(
            workspace_id=workspace_id,
            creator_id=creator_id,
            scope="STUDENT_PERSONAL",
            type="true_false",
            title=f"True/False: {claim.title}",
            difficulty=1,
            target_claim_ids=[claim.id],
            payload={"statement": statement, "correct_answer": correct_answer},
        )
        db.add(activity)
        activities.append(activity)

    # ── Multiple Choice (pull distractors from connected topics in the DAG) ──
    if "multi_choice" in types:
        distractors = await _find_distractors(db, claim, 3)
        if len(distractors) >= 3:
            chosen = random.sample(distractors, 3)
            options = [claim.content] + [d.content for d in chosen]
            random.shuffle(options)
            correct_index = options.index(claim.content)
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
                    "correct_index": correct_index,
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

    # ── Visual Sketch (draw the concept) ────────────────────────────────────
    if "visual_sketch" in types:
        activity = Activity(
            workspace_id=workspace_id,
            creator_id=creator_id,
            scope="STUDENT_PERSONAL",
            type="visual_sketch",
            title=f"Sketch: {claim.title}",
            difficulty=2,
            target_claim_ids=[claim.id],
            payload={
                "visual_prompt": (
                    f"Draw a diagram or sketch that represents: {claim.title}. "
                    f"Your drawing should illustrate: {claim.content}"
                ),
                "expected_structure": {
                    "required_labels": _extract_key_terms(claim.content),
                    "expected_label_count_min": 2,
                },
                "reference_description": claim.content,
            },
        )
        db.add(activity)
        activities.append(activity)

    # ── Visual Label (label the components) ─────────────────────────────────
    if "visual_label" in types:
        key_terms = _extract_key_terms(claim.content)
        if len(key_terms) >= 2:
            activity = Activity(
                workspace_id=workspace_id,
                creator_id=creator_id,
                scope="STUDENT_PERSONAL",
                type="visual_label",
                title=f"Label: {claim.title}",
                difficulty=2,
                target_claim_ids=[claim.id],
                payload={
                    "visual_prompt": (
                        f"Draw and label the key components of: {claim.title}. "
                        f"Make sure to label each part clearly."
                    ),
                    "expected_labels": key_terms,
                    "expected_structure": {
                        "required_labels": key_terms,
                        "expected_label_count_min": len(key_terms),
                    },
                    "reference_description": claim.content,
                },
            )
            db.add(activity)
            activities.append(activity)

    # ── Visual Proof (write proof on paper) ─────────────────────────────────
    if "visual_proof" in types:
        activity = Activity(
            workspace_id=workspace_id,
            creator_id=creator_id,
            scope="STUDENT_PERSONAL",
            type="visual_proof",
            title=f"Write & Photograph: {claim.title}",
            difficulty=3,
            target_claim_ids=[claim.id],
            payload={
                "visual_prompt": (
                    f"Write out your detailed solution or proof for: {claim.title}. "
                    f"Photograph your handwritten work and submit the image."
                ),
                "reference_description": claim.content,
                "grading_rubric": (
                    f"Evaluate whether the handwritten response demonstrates understanding of: "
                    f"{claim.content}. Check for logical flow, correct notation, and completeness."
                ),
                "expected_structure": {},
            },
        )
        db.add(activity)
        activities.append(activity)

    await db.flush()

    # Refresh all activities to get auto-generated IDs
    for a in activities:
        await db.refresh(a)

    return activities


async def _find_distractors(
    db: AsyncSession,
    claim: AtomicClaim,
    min_count: int,
) -> list[AtomicClaim]:
    """Find distractor claims for multi-choice questions.

    Searches in widening rings: same topic → DAG-connected topics → workspace.
    """
    # 1. Same topic siblings
    result = await db.execute(
        select(AtomicClaim).where(
            AtomicClaim.topic_id == claim.topic_id,
            AtomicClaim.id != claim.id,
        )
    )
    pool = list(result.scalars().all())
    if len(pool) >= min_count:
        return pool

    # 2. DAG-connected topics (prerequisites + dependents)
    seen_topic_ids = {claim.topic_id}
    prereq_result = await db.execute(
        select(TopicPrerequisite.prerequisite_id).where(
            TopicPrerequisite.topic_id == claim.topic_id
        )
    )
    dependent_result = await db.execute(
        select(TopicPrerequisite.topic_id).where(
            TopicPrerequisite.prerequisite_id == claim.topic_id
        )
    )
    connected_ids = (
        {r[0] for r in prereq_result.all()}
        | {r[0] for r in dependent_result.all()}
    ) - seen_topic_ids

    if connected_ids:
        seen_topic_ids |= connected_ids
        result = await db.execute(
            select(AtomicClaim).where(
                AtomicClaim.topic_id.in_(connected_ids),
                AtomicClaim.id != claim.id,
            )
        )
        pool.extend(result.scalars().all())
        if len(pool) >= min_count:
            return pool

    # 3. Remaining workspace topics
    result = await db.execute(
        select(AtomicClaim)
        .join(Topic, AtomicClaim.topic_id == Topic.id)
        .where(
            Topic.workspace_id == (
                select(Topic.workspace_id).where(Topic.id == claim.topic_id).scalar_subquery()
            ),
            AtomicClaim.id != claim.id,
            AtomicClaim.topic_id.notin_(seen_topic_ids),
        )
        .order_by(func.random())
        .limit(min_count * 2)
    )
    pool.extend(result.scalars().all())
    return pool


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


def _extract_key_terms(content: str) -> list[str]:
    """Extract capitalized or multi-word technical terms from claim content."""
    capitalized = re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b", content)
    unique = list(dict.fromkeys(capitalized))
    if len(unique) < 2:
        words = re.findall(r"\b[a-zA-Z]{4,}\b", content)
        stopwords = {"the", "that", "this", "with", "from", "have", "been", "which", "their", "about"}
        unique = list(dict.fromkeys(w for w in words if w.lower() not in stopwords))
    return unique[:6]


AI_ACTIVITY_PROMPTS: dict[str, str] = {
    "wrong_on_purpose": """\
You are a misconception designer for a technical learning platform.

Given an atomic claim, produce a SUBTLY FLAWED version that a student must
diagnose. The flaw should be the kind of mistake a beginner would make —
not an obvious contradiction.

Return a JSON object with:
- "flawed_statement": the deliberately wrong version (1-2 sentences)
- "flaw_type": one of "negation", "overgeneralization", "off_by_one",
  "confused_prerequisite", "wrong_direction"
- "explanation": why it's wrong (for the rubric, not shown to students)
- "prompt": the question shown to the student

Return ONLY the JSON object. No markdown fences.
""",
    "scenario": """\
You are a scenario designer for a technical learning platform.

Given an atomic claim, create a realistic scenario where a student must
APPLY the concept to solve a problem or make a decision.

Return a JSON object with:
- "scenario": the situation description (2-4 sentences)
- "question": what the student must figure out
- "key_reasoning": the expected line of reasoning (for grading, not shown)

Return ONLY the JSON object. No markdown fences.
""",
}


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
    if activity_type not in AI_ACTIVITY_PROMPTS:
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
        from app.services.bedrock import generate_activity

        result = await asyncio.to_thread(
            generate_activity,
            system_prompt=AI_ACTIVITY_PROMPTS[activity_type],
            claim_title=claim.title,
            claim_content=claim.content,
        )

        if not result:
            return None

        if activity_type == "wrong_on_purpose":
            payload = {
                "claim": result.get("flawed_statement", claim.content),
                "flawed_snippet": None,
                "prompt": result.get("prompt", f"This statement about {claim.title} contains a deliberate error. Find and explain what is wrong."),
                "flaw_type": result.get("flaw_type"),
                "explanation": result.get("explanation"),
            }
            title = f"Spot the Flaw: {claim.title}"
        else:
            payload = {
                "scenario": result.get("scenario", ""),
                "question": result.get("question", ""),
                "key_reasoning": result.get("key_reasoning"),
            }
            title = f"Scenario: {claim.title}"

        activity = Activity(
            workspace_id=workspace_id,
            creator_id=creator_id,
            scope="STUDENT_PERSONAL",
            type=activity_type,
            title=title,
            difficulty=2,
            target_claim_ids=[claim.id],
            payload=payload,
        )
        db.add(activity)
        await db.flush()
        await db.refresh(activity)
        return activity

    except Exception:
        logger.exception("AI activity generation failed for claim %s", claim.id)
        return None


# ── Audio overview generation ────────────────────────────────────────────────


async def generate_audio_overview(
    db: AsyncSession,
    workspace_id: int,
    creator_id: str,
    topic_ids: list[str],
    style: str = "conversational",
    user_instruction: str | None = None,
) -> Activity:
    """Generate an AI-scripted audio overview and synthesize via Polly.

    Fetches topics + claims, calls Bedrock for script generation, calls
    Polly for TTS, and persists the result as a mini_podcast Activity.
    """
    from uuid import uuid4

    from app.services.bedrock import generate_audio_script
    from app.services.polly import synthesize_speech

    # 1. Fetch topics + claims
    result = await db.execute(
        select(Topic)
        .where(Topic.id.in_(topic_ids))
        .order_by(Topic.title)
    )
    topics = list(result.scalars().all())
    if not topics:
        raise ValueError("No topics found for the given IDs")

    # 2. Format prompt input (cap at 10 claims per topic)
    parts: list[str] = []
    all_claim_ids: list[str] = []
    topic_titles: list[str] = []
    for topic in topics:
        topic_titles.append(topic.title)
        section = f"## TOPIC: {topic.title}"
        if topic.summary:
            section += f"\n{topic.summary}"
        claims = topic.claims[:10] if topic.claims else []
        if claims:
            section += "\n\nClaims:"
            for c in claims:
                section += f"\n- {c.title}: {c.content}"
                all_claim_ids.append(c.id)
        parts.append(section)

    topics_text = "\n\n".join(parts)

    # 3. Generate script via Bedrock
    script_result = await asyncio.to_thread(
        generate_audio_script,
        style=style,
        topics_text=topics_text,
        user_instruction=user_instruction,
    )
    script = script_result.get("script", "")
    question = script_result.get("question", "")

    if not script:
        raise ValueError("Bedrock returned an empty script")

    # 4. Synthesize via Polly
    output_key = f"audio/overview_{uuid4().hex}.mp3"
    polly_result = await asyncio.to_thread(synthesize_speech, script, output_key)

    # 5. Generate presigned URL
    from app.api.routes.audio import _generate_polly_download_url
    audio_url = await asyncio.to_thread(
        _generate_polly_download_url, polly_result["s3_key"]
    )

    # 6. Compute difficulty
    difficulty = await _compute_difficulty(db, creator_id, all_claim_ids)

    # 7. Create Activity
    title_text = ", ".join(topic_titles)
    if len(title_text) > 150:
        title_text = title_text[:147] + "..."

    activity = Activity(
        workspace_id=workspace_id,
        creator_id=creator_id,
        scope="STUDENT_PERSONAL",
        type="mini_podcast",
        title=f"Audio Overview: {title_text}",
        difficulty=difficulty,
        target_claim_ids=all_claim_ids,
        payload={
            "summary": script,
            "question": question,
            "audio_url": audio_url,
            "s3_key": polly_result["s3_key"],
            "duration_seconds": polly_result.get("duration_seconds"),
            "style": style,
            "topic_ids": topic_ids,
        },
    )
    db.add(activity)
    await db.flush()
    await db.refresh(activity)
    return activity


# ── Claim selection helper ────────────────────────────────────────────────────


async def _pick_claims(
    db: AsyncSession,
    workspace_id: int,
    count: int,
    topic_ids: list[str] | None = None,
) -> list[AtomicClaim]:
    """Pick *count* claims from the given topics, expanding via the DAG if needed.

    Priority: requested topics → DAG-connected topics → rest of workspace.
    """
    if not topic_ids:
        # No topics specified — grab all workspace topics
        result = await db.execute(
            select(Topic.id).where(Topic.workspace_id == workspace_id)
        )
        topic_ids = [r[0] for r in result.all()]

    if not topic_ids:
        return []

    # 1. Claims from the requested topics
    result = await db.execute(
        select(AtomicClaim)
        .where(AtomicClaim.topic_id.in_(topic_ids))
        .order_by(func.random())
        .limit(count)
    )
    claims = list(result.scalars().all())
    if len(claims) >= count:
        return claims

    # 2. Expand into DAG-connected topics (prerequisites + dependents)
    seen_ids = set(topic_ids)
    prereq_result = await db.execute(
        select(TopicPrerequisite.prerequisite_id).where(
            TopicPrerequisite.topic_id.in_(topic_ids)
        )
    )
    dep_result = await db.execute(
        select(TopicPrerequisite.topic_id).where(
            TopicPrerequisite.prerequisite_id.in_(topic_ids)
        )
    )
    neighbor_ids = (
        {r[0] for r in prereq_result.all()}
        | {r[0] for r in dep_result.all()}
    ) - seen_ids

    if neighbor_ids:
        seen_ids |= neighbor_ids
        claim_ids_seen = {c.id for c in claims}
        result = await db.execute(
            select(AtomicClaim)
            .where(
                AtomicClaim.topic_id.in_(neighbor_ids),
                AtomicClaim.id.notin_(claim_ids_seen),
            )
            .order_by(func.random())
            .limit(count - len(claims))
        )
        claims.extend(result.scalars().all())
        if len(claims) >= count:
            return claims

    # 3. Fall back to remaining workspace topics
    claim_ids_seen = {c.id for c in claims}
    result = await db.execute(
        select(AtomicClaim)
        .join(Topic, AtomicClaim.topic_id == Topic.id)
        .where(
            Topic.workspace_id == workspace_id,
            AtomicClaim.id.notin_(claim_ids_seen),
        )
        .order_by(func.random())
        .limit(count - len(claims))
    )
    claims.extend(result.scalars().all())
    return claims


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
        return _build_tf_question(index, claim)
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
        return _build_tf_question(index, claim)
    else:  # short_answer
        return {
            "index": index,
            "type": "short_answer",
            "claim_id": claim.id,
            "prompt": f"Explain in your own words: {claim.title}",
        }


def _build_tf_question(index: int, claim: AtomicClaim) -> dict:
    """Build a true/false question with a 50/50 chance of negation."""
    show_true = random.random() < 0.5
    if show_true:
        statement = claim.content
        correct_answer = True
    else:
        statement = _negate_claim(claim.content)
        correct_answer = False
    return {
        "index": index,
        "type": "true_false",
        "claim_id": claim.id,
        "prompt": statement,
        "correct_answer": correct_answer,
    }


async def _build_mc_question(
    db: AsyncSession, index: int, claim: AtomicClaim
) -> dict:
    """Build a multiple-choice question using DAG-connected distractors."""
    distractors = await _find_distractors(db, claim, 3)

    if len(distractors) >= 3:
        chosen = random.sample(distractors, 3)
        options = [claim.content] + [d.content for d in chosen]
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

    return _build_tf_question(index, claim)
