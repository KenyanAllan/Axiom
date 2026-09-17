"""Chat endpoints — RAG-powered tutor conversations with tool-use."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.core.rate_limit import limiter
from app.models.tables import (
    AtomicClaim,
    ChatMessage,
    ChatSession,
    Topic,
    User,
    UserActivityQueue,
    Workspace,
)
from app.services.bedrock import generate_embedding
from app.services.tool_executor import TOOL_DEFINITIONS, execute_tool

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/chat", tags=["chat"])

MAX_TOOL_ROUNDS = 5


# ── Pydantic Schemas ────────────────────────────────────────────────────────


class ChatSessionCreate(BaseModel):
    workspace_id: int
    title: str | None = None


class ChatMessageCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)


class ChatMessageResponse(BaseModel):
    id: int
    session_id: int
    role: str
    content: str
    sources: list[dict[str, Any]] | dict[str, Any] | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatSessionResponse(BaseModel):
    id: int
    user_id: str
    workspace_id: int
    title: str | None = None
    created_at: datetime
    messages: list[ChatMessageResponse] = []

    model_config = {"from_attributes": True}


class ChatSessionListItem(BaseModel):
    id: int
    user_id: str
    workspace_id: int
    title: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class LockStatusResponse(BaseModel):
    locked: bool
    message: str | None = None


# ── System prompt ──────────────────────────────────────────────────────────

RAG_SYSTEM_PROMPT = """\
You are a knowledgeable tutor for the Axiom learning platform. Use the provided \
context to answer the student's question accurately. If the context doesn't \
contain enough information, say so honestly. Always cite which claim or topic \
your answer is based on.

You have access to tools that can take actions in the learning platform:

WHEN TO USE TOOLS:
- When the user asks to create activities (flashcards, quizzes, etc.) for a topic or claim
- When the user asks what they should study next or about their learning progress
- When the user asks to see their queue or manage their practice activities
- When the user asks to browse topics or see what claims are in a topic
- When the user asks for an audio overview, podcast, or listening summary of topics
- When the user asks about the meaning or definition of a term

GUIDELINES:
- Before creating activities, use list_topics or get_topic_claims to find the \
correct claim_id — do NOT guess claim IDs
- create_activities_for_claim generates six types: flashcard, true_false, \
multi_choice, fill_blank, wrong_on_purpose, and feynman. You can specify \
which types to create, or omit to create all six
- Use get_learning_frontier to advise what to study next
- Use get_mastery_status to check progress before making recommendations
- You may chain multiple tool calls to fulfill a request (e.g., list_topics → \
get_topic_claims → create_activities_for_claim)
- Always explain what you did after using tools — tell the user what was \
created, added, or found
- Keep tool usage focused on what the user actually asked for
- When the user asks for an audio overview or podcast, use \
generate_audio_overview with the relevant topic_ids. You can choose a style: \
"conversational" (casual study-buddy), "narrative" (documentary storytelling), \
or "discussion" (two people talking it through). Pick the style that best fits \
what the user is asking for, or ask them if unsure
- When the user asks about the meaning or definition of a term, use \
search_glossary to look it up
- When you find glossary results, present the term and definition clearly
- For simple knowledge questions, just answer from the provided context \
without using tools"""


# ── RAG + Tool-use converse ────────────────────────────────────────────────


def _call_bedrock_converse(
    messages: list[dict],
    tool_config: dict | None = None,
) -> dict:
    """Synchronous Bedrock Converse API call (runs in thread pool)."""
    from app.services.bedrock import _get_client

    client = _get_client()

    kwargs: dict[str, Any] = {
        "modelId": settings.bedrock_model_id,
        "system": [{"text": RAG_SYSTEM_PROMPT}],
        "messages": messages,
        "inferenceConfig": {
            "maxTokens": 2048,
            "temperature": 0.3,
            "topP": 0.9,
        },
    }
    if tool_config is not None:
        kwargs["toolConfig"] = tool_config

    return client.converse(**kwargs)


async def _rag_converse_with_tools(
    context: str,
    user_message: str,
    db: AsyncSession,
    user_id: str,
    workspace_id: int,
    user_role: str,
    classroom_id: int | None,
) -> dict[str, Any]:
    """Multi-turn Bedrock Converse with tool-use loop.

    1. Send user message with RAG context
    2. If model requests tool calls, execute them and send results back
    3. Repeat until model returns text (or max rounds reached)
    """
    prompt = (
        f"## CONTEXT (retrieved from the knowledge base)\n{context}\n\n"
        f"## USER MESSAGE\n{user_message}"
    )

    messages: list[dict] = [
        {"role": "user", "content": [{"text": prompt}]}
    ]

    tool_config = {"tools": [{"toolSpec": t} for t in TOOL_DEFINITIONS]}
    tool_calls_made: list[dict] = []

    for _round in range(MAX_TOOL_ROUNDS):
        response = await asyncio.to_thread(
            _call_bedrock_converse, messages, tool_config
        )

        assistant_message = response["output"]["message"]
        messages.append(assistant_message)

        stop_reason = response.get("stopReason", "end_turn")

        if stop_reason != "tool_use":
            break

        tool_results: list[dict] = []

        for block in assistant_message["content"]:
            if "toolUse" not in block:
                continue

            tool_use = block["toolUse"]
            tool_name = tool_use["name"]
            tool_input = tool_use["input"]
            tool_use_id = tool_use["toolUseId"]

            logger.info("Chat tool call: %s(%s)", tool_name, tool_input)

            result = await execute_tool(
                tool_name=tool_name,
                tool_input=tool_input,
                db=db,
                user_id=user_id,
                workspace_id=workspace_id,
                user_role=user_role,
                classroom_id=classroom_id,
            )

            tool_call_entry = {
                "tool": tool_name,
                "input": tool_input,
                "output_summary": _summarize_result(result),
            }
            if tool_name == "search_glossary" and "terms" in result:
                tool_call_entry["data"] = result["terms"]
            tool_calls_made.append(tool_call_entry)

            tool_results.append({
                "toolResult": {
                    "toolUseId": tool_use_id,
                    "content": [{"json": result}],
                    "status": "error" if "error" in result else "success",
                }
            })

        messages.append({"role": "user", "content": tool_results})

    # Extract final text from the last assistant message
    final_text_parts: list[str] = []
    last_assistant = messages[-1] if messages[-1].get("role") == "assistant" else None
    if last_assistant:
        for block in last_assistant.get("content", []):
            if "text" in block:
                final_text_parts.append(block["text"])

    if not final_text_parts:
        final_text_parts = ["I've completed the requested actions."]

    return {
        "content": "\n".join(final_text_parts),
        "tool_calls_made": tool_calls_made if tool_calls_made else None,
    }


def _summarize_result(result: dict) -> str:
    """Short summary of a tool result for metadata storage."""
    if "error" in result:
        return f"error: {result['error']}"
    if "message" in result:
        return result["message"]
    if "total" in result:
        return f"{result['total']} items"
    return "ok"


# ── Routes ──────────────────────────────────────────────────────────────────


@router.post("/sessions", response_model=ChatSessionResponse, status_code=201)
async def create_session(
    body: ChatSessionCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChatSessionResponse:
    """Create a new chat session for a workspace."""
    session = ChatSession(
        user_id=user_id,
        workspace_id=body.workspace_id,
        title=body.title or "New Chat",
    )
    db.add(session)
    await db.flush()
    await db.refresh(session, attribute_names=["messages"])

    return ChatSessionResponse.model_validate(session)


@router.get("/sessions", response_model=list[ChatSessionListItem])
async def list_sessions(
    workspace_id: int = Query(...),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ChatSessionListItem]:
    """List the user's chat sessions for a workspace."""
    stmt = (
        select(ChatSession)
        .where(
            ChatSession.user_id == user_id,
            ChatSession.workspace_id == workspace_id,
        )
        .order_by(ChatSession.created_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [ChatSessionListItem.model_validate(r) for r in rows]


@router.get("/sessions/{session_id}", response_model=ChatSessionResponse)
async def get_session(
    session_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChatSessionResponse:
    """Get a chat session with all its messages."""
    stmt = (
        select(ChatSession)
        .options(selectinload(ChatSession.messages))
        .where(
            ChatSession.id == session_id,
            ChatSession.user_id == user_id,
        )
    )
    session = (await db.execute(stmt)).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found")

    return ChatSessionResponse.model_validate(session)


@router.post(
    "/sessions/{session_id}/messages",
    response_model=ChatMessageResponse,
    status_code=201,
)
@limiter.limit("20/minute")
async def send_message(
    request: Request,
    session_id: int,
    body: ChatMessageCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChatMessageResponse:
    """Send a message in a chat session and get a tool-augmented RAG response.

    1. Saves user message.
    2. Generates embedding of the question.
    3. Queries pgvector for top-5 relevant atomic claims in the workspace.
    4. Calls Bedrock with tool definitions — model may call tools in a loop.
    5. Saves and returns the assistant message with sources and tool metadata.
    """
    # Verify session ownership
    stmt = select(ChatSession).where(
        ChatSession.id == session_id,
        ChatSession.user_id == user_id,
    )
    chat_session = (await db.execute(stmt)).scalar_one_or_none()
    if chat_session is None:
        raise HTTPException(status_code=404, detail="Chat session not found")

    # Load user role and workspace for tool context
    user = await db.get(User, user_id)
    user_role = user.role if user else "student"

    workspace = await db.get(Workspace, chat_session.workspace_id)
    classroom_id = workspace.classroom_id if workspace else None

    # 1. Save user message
    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=body.content,
    )
    db.add(user_msg)
    await db.flush()

    # 2. Generate embedding for the user's question
    try:
        embedding = await asyncio.to_thread(generate_embedding, body.content)
    except Exception as exc:
        logger.error("Embedding generation failed: %s", exc)
        embedding = None

    # 3. Query pgvector for top-5 relevant claims in this workspace
    rag_sources: list[dict[str, Any]] = []
    context_parts: list[str] = []

    if embedding is not None:
        claim_stmt = (
            select(
                AtomicClaim.id,
                AtomicClaim.title,
                AtomicClaim.content,
                Topic.title.label("topic_title"),
                AtomicClaim.embedding.cosine_distance(embedding).label("distance"),
            )
            .join(Topic, AtomicClaim.topic_id == Topic.id)
            .where(
                Topic.workspace_id == chat_session.workspace_id,
                AtomicClaim.embedding.isnot(None),
            )
            .order_by(AtomicClaim.embedding.cosine_distance(embedding))
            .limit(5)
        )

        claim_rows = (await db.execute(claim_stmt)).all()

        for row in claim_rows:
            rag_sources.append(
                {
                    "claim_id": row.id,
                    "claim_title": row.title,
                    "topic_title": row.topic_title,
                    "relevance_score": round(1 - (row.distance or 1.0), 4),
                }
            )
            context_parts.append(
                f"[{row.topic_title} > {row.title}]: {row.content}"
            )

    # 4. Call Bedrock with tool-use loop
    context_str = (
        "\n\n".join(context_parts)
        if context_parts
        else "No relevant context found in the knowledge base."
    )

    rag_result = await _rag_converse_with_tools(
        context=context_str,
        user_message=body.content,
        db=db,
        user_id=user_id,
        workspace_id=chat_session.workspace_id,
        user_role=user_role,
        classroom_id=classroom_id,
    )

    # 5. Save and return assistant message
    sources_meta: Any = rag_sources if rag_sources else None
    if rag_result.get("tool_calls_made"):
        sources_meta = {
            "rag_sources": rag_sources if rag_sources else None,
            "tool_calls": rag_result["tool_calls_made"],
        }

    assistant_msg = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=rag_result["content"],
        sources=sources_meta,
    )
    db.add(assistant_msg)
    await db.flush()
    await db.refresh(assistant_msg)

    return ChatMessageResponse.model_validate(assistant_msg)


@router.get("/lock-status", response_model=LockStatusResponse)
async def lock_status(
    activity_id: int = Query(...),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LockStatusResponse:
    """Check if chat is locked because the user has an incomplete activity."""
    stmt = select(UserActivityQueue).where(
        UserActivityQueue.user_id == user_id,
        UserActivityQueue.activity_id == activity_id,
        UserActivityQueue.is_completed == False,  # noqa: E712
    )
    incomplete = (await db.execute(stmt)).scalar_one_or_none()

    if incomplete is not None:
        return LockStatusResponse(
            locked=True,
            message="Chat is locked while you have an active practice activity. Complete or skip the activity to unlock chat.",
        )

    return LockStatusResponse(locked=False, message=None)
