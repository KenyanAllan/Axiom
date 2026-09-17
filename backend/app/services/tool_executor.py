"""Chat tool executor — Bedrock Converse API tool definitions and dispatch.

Defines the tools the chat tutor LLM can invoke, and executes them against
existing service functions. Only used by the chat endpoint.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import (
    Activity,
    AtomicClaim,
    GlossaryTerm,
    Topic,
    UserMastery,
    Workspace,
)
from app.services.bedrock import generate_embedding

logger = logging.getLogger(__name__)


# ── Tool definitions (Bedrock toolSpec format) ────────────────────────────────

TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "list_topics",
        "description": (
            "List all topics in the current workspace. "
            "Returns topic IDs, titles, and claim counts. "
            "Use this first to find which topics exist before drilling into claims."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {},
                "required": [],
            }
        },
    },
    {
        "name": "get_topic_claims",
        "description": (
            "Get all atomic claims for a specific topic. "
            "Returns claim IDs, titles, and content summaries. "
            "Use this to find claim_ids before creating activities."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "topic_id": {
                        "type": "string",
                        "description": "The topic ID (e.g. 'top_linear-algebra').",
                    },
                },
                "required": ["topic_id"],
            }
        },
    },
    {
        "name": "create_activities_for_claim",
        "description": (
            "Create practice activities for a specific atomic claim. Available types: "
            "flashcard, true_false, multi_choice, fill_blank, wrong_on_purpose, feynman, "
            "visual_sketch, visual_label, visual_proof, parsons. "
            "For teachers, activities are automatically shared with all students in the "
            "classroom. For students, activities are added to their personal practice queue."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "claim_id": {
                        "type": "string",
                        "description": "The ID of the atomic claim to generate activities for.",
                    },
                    "types": {
                        "type": "array",
                        "items": {
                            "type": "string",
                            "enum": ["flashcard", "true_false", "multi_choice", "fill_blank", "wrong_on_purpose", "feynman", "visual_sketch", "visual_label", "visual_proof", "parsons"],
                        },
                        "description": "Which activity types to generate. Defaults to all ten.",
                    },
                },
                "required": ["claim_id"],
            }
        },
    },
    {
        "name": "get_my_queue",
        "description": (
            "Get the user's current activity queue for this workspace. "
            "Shows pending and completed practice activities."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "limit": {
                        "type": "integer",
                        "description": "Max items to return (default 10).",
                    },
                },
                "required": [],
            }
        },
    },
    {
        "name": "add_activity_to_queue",
        "description": "Add a specific activity to the user's practice queue by its ID.",
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "activity_id": {
                        "type": "integer",
                        "description": "The activity ID to add to the queue.",
                    },
                },
                "required": ["activity_id"],
            }
        },
    },
    {
        "name": "auto_populate_my_queue",
        "description": (
            "Automatically fill the user's practice queue with activities "
            "targeting unmastered claims, following the prerequisite DAG order."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {},
                "required": [],
            }
        },
    },
    {
        "name": "get_learning_frontier",
        "description": (
            "Get the user's learning frontier — topics that are ready to study "
            "because all their prerequisites are mastered. Returns topic names, "
            "claim counts, and mastery progress."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {},
                "required": [],
            }
        },
    },
    {
        "name": "get_mastery_status",
        "description": (
            "Check the user's mastery status for claims in a topic, or for "
            "specific claim IDs. Returns understanding ratings (1-5) and status "
            "(unseen/active/mastered) for each claim."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "topic_id": {
                        "type": "string",
                        "description": "Get mastery for all claims in this topic.",
                    },
                    "claim_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Get mastery for these specific claim IDs.",
                    },
                },
                "required": [],
            }
        },
    },
    {
        "name": "generate_audio_overview",
        "description": (
            "Generate an audio overview (mini podcast) for one or more topics. "
            "Creates an AI-scripted narration synthesized as audio. "
            "Use this when the user asks for an audio summary, podcast, or "
            "listening-based review of topics. Requires at least one topic_id."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "topic_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "One or more topic IDs to include in the overview.",
                    },
                    "style": {
                        "type": "string",
                        "enum": ["conversational", "narrative", "discussion"],
                        "description": "Narration style. 'conversational' is a casual study-buddy tone, 'narrative' is documentary storytelling, 'discussion' is two people talking it through. Default: conversational.",
                    },
                },
                "required": ["topic_ids"],
            }
        },
    },
    {
        "name": "search_glossary",
        "description": (
            "Search the workspace glossary for a term or concept. "
            "Returns matching glossary terms with their definitions. "
            "Use this when the student asks about the meaning of a term, "
            "concept, or wants a definition."
        ),
        "inputSchema": {
            "json": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The term or concept to search for.",
                    },
                },
                "required": ["query"],
            }
        },
    },
]


# ── Tool executor ─────────────────────────────────────────────────────────────


async def execute_tool(
    tool_name: str,
    tool_input: dict[str, Any],
    db: AsyncSession,
    user_id: str,
    workspace_id: int,
    user_role: str,
    classroom_id: int | None,
) -> dict[str, Any]:
    """Dispatch a tool call to the appropriate service function."""
    try:
        if tool_name == "list_topics":
            return await _tool_list_topics(db, workspace_id)

        elif tool_name == "get_topic_claims":
            return await _tool_get_topic_claims(db, workspace_id, tool_input)

        elif tool_name == "create_activities_for_claim":
            return await _tool_create_activities(
                db, tool_input, user_id, workspace_id, user_role, classroom_id
            )

        elif tool_name == "get_my_queue":
            return await _tool_get_queue(db, user_id, workspace_id, tool_input)

        elif tool_name == "add_activity_to_queue":
            return await _tool_add_to_queue(db, user_id, tool_input)

        elif tool_name == "auto_populate_my_queue":
            return await _tool_auto_populate(db, user_id, workspace_id)

        elif tool_name == "get_learning_frontier":
            return await _tool_frontier(db, user_id, workspace_id)

        elif tool_name == "get_mastery_status":
            return await _tool_mastery(db, user_id, workspace_id, tool_input)

        elif tool_name == "generate_audio_overview":
            return await _tool_generate_audio_overview(
                db, tool_input, user_id, workspace_id, user_role, classroom_id
            )

        elif tool_name == "search_glossary":
            return await _tool_search_glossary(db, workspace_id, tool_input)

        else:
            return {"error": f"Unknown tool: {tool_name}"}

    except Exception as exc:
        logger.error("Tool execution failed for '%s': %s", tool_name, exc)
        return {"error": str(exc)}


# ── Individual tool handlers ──────────────────────────────────────────────────


async def _tool_list_topics(db: AsyncSession, workspace_id: int) -> dict:
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Topic)
        .where(Topic.workspace_id == workspace_id)
        .options(selectinload(Topic.claims))
        .order_by(Topic.title)
    )
    topics = result.scalars().all()

    return {
        "topics": [
            {
                "id": t.id,
                "slug": t.slug,
                "title": t.title,
                "summary": t.summary or "",
                "claim_count": len(t.claims or []),
            }
            for t in topics
        ],
        "total": len(topics),
    }


async def _tool_get_topic_claims(
    db: AsyncSession, workspace_id: int, tool_input: dict
) -> dict:
    topic_id = tool_input.get("topic_id")
    if not topic_id:
        return {"error": "topic_id is required"}

    topic = await db.get(Topic, topic_id)
    if topic is None:
        return {"error": f"Topic '{topic_id}' not found"}
    if topic.workspace_id != workspace_id:
        return {"error": f"Topic '{topic_id}' is not in this workspace"}

    result = await db.execute(
        select(AtomicClaim)
        .where(AtomicClaim.topic_id == topic_id)
        .order_by(AtomicClaim.id)
    )
    claims = result.scalars().all()

    return {
        "topic_id": topic_id,
        "topic_title": topic.title,
        "claims": [
            {
                "id": c.id,
                "title": c.title,
                "content": c.content[:200] if c.content else "",
            }
            for c in claims
        ],
        "total": len(claims),
    }


async def _tool_create_activities(
    db: AsyncSession,
    tool_input: dict,
    user_id: str,
    workspace_id: int,
    user_role: str,
    classroom_id: int | None,
) -> dict:
    from app.services.activity_generator import generate_basic_activities
    from app.services.classroom import broadcast_activity_to_class
    from app.services.queue import add_to_queue

    claim_id = tool_input.get("claim_id")
    if not claim_id:
        return {"error": "claim_id is required"}

    claim = await db.get(AtomicClaim, claim_id)
    if claim is None:
        return {"error": f"Claim '{claim_id}' not found"}

    types = tool_input.get("types", ["flashcard", "true_false", "multi_choice", "fill_blank", "wrong_on_purpose", "feynman", "visual_sketch", "visual_label", "visual_proof", "parsons"])

    activities = await generate_basic_activities(
        db=db,
        claim=claim,
        workspace_id=workspace_id,
        creator_id=user_id,
        types=types,
    )

    created = []

    if user_role == "teacher" and classroom_id is not None:
        for act in activities:
            act.scope = "CLASSROOM_SHARED"
            act.classroom_id = classroom_id
        await db.flush()

        for act in activities:
            await broadcast_activity_to_class(db, classroom_id, act.id)
            created.append({"id": act.id, "type": act.type, "title": act.title})

        return {
            "created": created,
            "count": len(created),
            "message": f"Created {len(created)} activities and broadcast to all students in the classroom.",
        }

    else:
        for act in activities:
            await add_to_queue(db, user_id, act.id)
            created.append({"id": act.id, "type": act.type, "title": act.title})

        return {
            "created": created,
            "count": len(created),
            "message": f"Created {len(created)} activities and added them to your practice queue.",
        }


async def _tool_get_queue(
    db: AsyncSession, user_id: str, workspace_id: int, tool_input: dict
) -> dict:
    from app.services.queue import get_user_queue

    limit = tool_input.get("limit", 10)
    result = await get_user_queue(
        db=db, user_id=user_id, workspace_id=workspace_id, limit=limit
    )

    items = []
    for entry in result["items"]:
        act = entry.get("activity") or {}
        items.append({
            "activity_id": act.get("id"),
            "type": act.get("type"),
            "title": act.get("title"),
            "is_completed": entry.get("is_completed", False),
        })

    return {"queue": items, "total": result["total"]}


async def _tool_add_to_queue(db: AsyncSession, user_id: str, tool_input: dict) -> dict:
    from app.services.queue import add_to_queue

    activity_id = tool_input.get("activity_id")
    if activity_id is None:
        return {"error": "activity_id is required"}

    activity = await db.get(Activity, activity_id)
    if activity is None:
        return {"error": f"Activity {activity_id} not found"}

    await add_to_queue(db, user_id, activity_id)
    return {"message": f"Activity '{activity.title}' added to your queue.", "activity_id": activity_id}


async def _tool_auto_populate(db: AsyncSession, user_id: str, workspace_id: int) -> dict:
    from app.services.queue import auto_populate_queue, get_user_queue

    await auto_populate_queue(db, user_id, workspace_id)
    result = await get_user_queue(db=db, user_id=user_id, workspace_id=workspace_id, limit=10)

    items = []
    for entry in result["items"]:
        act = entry.get("activity") or {}
        items.append({
            "activity_id": act.get("id"),
            "type": act.get("type"),
            "title": act.get("title"),
            "is_completed": entry.get("is_completed", False),
        })

    return {
        "message": "Queue auto-populated with activities for your next unmastered topics.",
        "queue": items,
        "total": result["total"],
    }


async def _tool_frontier(db: AsyncSession, user_id: str, workspace_id: int) -> dict:
    from app.services.dag import compute_frontier

    items = await compute_frontier(db, user_id, workspace_id)
    return {
        "frontier": items,
        "total": len(items),
        "message": f"You have {len(items)} topics on your learning frontier." if items else "All topics mastered! Great work.",
    }


async def _tool_mastery(
    db: AsyncSession, user_id: str, workspace_id: int, tool_input: dict
) -> dict:
    topic_id = tool_input.get("topic_id")
    claim_ids = tool_input.get("claim_ids")

    if not topic_id and not claim_ids:
        return {"error": "Provide either topic_id or claim_ids"}

    if topic_id and not claim_ids:
        result = await db.execute(
            select(AtomicClaim.id).where(AtomicClaim.topic_id == topic_id)
        )
        claim_ids = [row[0] for row in result.all()]

    if not claim_ids:
        return {"claims": [], "message": "No claims found for this topic."}

    mastery_result = await db.execute(
        select(UserMastery).where(
            UserMastery.user_id == user_id,
            UserMastery.claim_id.in_(claim_ids),
        )
    )
    masteries = {m.claim_id: m for m in mastery_result.scalars().all()}

    claims_result = await db.execute(
        select(AtomicClaim).where(AtomicClaim.id.in_(claim_ids))
    )
    claims = claims_result.scalars().all()

    items = []
    for c in claims:
        m = masteries.get(c.id)
        items.append({
            "claim_id": c.id,
            "claim_title": c.title,
            "understanding_rating": m.understanding_rating if m else 1,
            "status": m.status if m else "unseen",
            "complexity_score": c.complexity_score,
        })

    mastered = sum(1 for i in items if i["status"] == "mastered")
    return {
        "claims": items,
        "total": len(items),
        "mastered_count": mastered,
        "message": f"Mastered {mastered}/{len(items)} claims.",
    }


async def _tool_generate_audio_overview(
    db: AsyncSession,
    tool_input: dict,
    user_id: str,
    workspace_id: int,
    user_role: str,
    classroom_id: int | None,
) -> dict:
    from app.services.activity_generator import generate_audio_overview
    from app.services.classroom import broadcast_activity_to_class
    from app.services.queue import add_to_queue

    topic_ids = tool_input.get("topic_ids", [])
    if not topic_ids:
        return {"error": "topic_ids is required (at least one topic ID)"}

    style = tool_input.get("style", "conversational")

    try:
        activity = await generate_audio_overview(
            db=db,
            workspace_id=workspace_id,
            creator_id=user_id,
            topic_ids=topic_ids,
            style=style,
        )

        if user_role == "teacher" and classroom_id is not None:
            activity.scope = "CLASSROOM_SHARED"
            activity.classroom_id = classroom_id
            await db.flush()
            await broadcast_activity_to_class(db, classroom_id, activity.id)
        else:
            await add_to_queue(db, user_id, activity.id)

        payload = activity.payload or {}
        audience = "the entire class" if user_role == "teacher" and classroom_id else "your activity feed"
        return {
            "activity_id": activity.id,
            "title": activity.title,
            "style": style,
            "audio_url": payload.get("audio_url", ""),
            "message": f"Created audio overview '{activity.title}'. It has been added to {audience}.",
        }
    except ValueError as exc:
        return {"error": str(exc)}


async def _tool_search_glossary(
    db: AsyncSession, workspace_id: int, tool_input: dict
) -> dict:
    query = tool_input.get("query", "")
    if not query:
        return {"error": "query is required"}

    embedding = await asyncio.to_thread(generate_embedding, query)

    stmt = (
        select(
            GlossaryTerm.id,
            GlossaryTerm.term,
            GlossaryTerm.definition,
            GlossaryTerm.source_document_id,
            GlossaryTerm.source_ref,
            GlossaryTerm.embedding.cosine_distance(embedding).label("distance"),
        )
        .where(
            GlossaryTerm.workspace_id == workspace_id,
            GlossaryTerm.embedding.isnot(None),
        )
        .order_by("distance")
        .limit(5)
    )
    rows = (await db.execute(stmt)).all()

    terms = []
    for row in rows:
        similarity = round(1.0 - (row.distance or 1.0), 4)
        if similarity < 0.5:
            continue
        terms.append({
            "id": row.id,
            "term": row.term,
            "definition": row.definition,
            "source_document_id": row.source_document_id,
            "source_ref": row.source_ref,
            "similarity": similarity,
        })

    return {
        "terms": terms,
        "total": len(terms),
        "message": (
            f"Found {len(terms)} glossary terms matching '{query}'."
            if terms
            else f"No glossary terms found for '{query}'."
        ),
    }
