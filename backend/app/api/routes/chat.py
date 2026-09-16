"""Chat endpoints — RAG-powered tutor conversations."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.models.tables import (
    AtomicClaim,
    ChatMessage,
    ChatSession,
    Topic,
    UserActivityQueue,
)
from app.services.bedrock import generate_embedding

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/chat", tags=["chat"])


# ── Pydantic Schemas ────────────────────────────────────────────────────────


class ChatSessionCreate(BaseModel):
    workspace_id: int
    title: str | None = None


class ChatMessageCreate(BaseModel):
    content: str


class ChatMessageResponse(BaseModel):
    id: int
    session_id: int
    role: str
    content: str
    sources: list[dict[str, Any]] | None = None
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


# ── RAG Helper ──────────────────────────────────────────────────────────────

RAG_SYSTEM_PROMPT = """\
You are a knowledgeable tutor for the Axiom learning platform. Use the provided \
context to answer the student's question accurately. If the context doesn't \
contain enough information, say so honestly. Always cite which claim or topic \
your answer is based on."""


def _rag_converse(context: str, user_message: str) -> dict[str, Any]:
    """Call Bedrock Converse API with RAG context to generate a tutor response.

    Returns {"content": str, "sources_used": list[str]}.
    """
    from app.services.bedrock import _get_client

    client = _get_client()

    prompt = (
        f"## CONTEXT (retrieved from the knowledge base)\n{context}\n\n"
        f"## STUDENT QUESTION\n{user_message}\n\n"
        "Answer the student's question using the context above. "
        "Cite the relevant claim titles in your response."
    )

    try:
        response = client.converse(
            modelId=settings.bedrock_model_id,
            system=[{"text": RAG_SYSTEM_PROMPT}],
            messages=[
                {
                    "role": "user",
                    "content": [{"text": prompt}],
                }
            ],
            inferenceConfig={
                "maxTokens": 1024,
                "temperature": 0.3,
                "topP": 0.9,
            },
        )

        output_message = response["output"]["message"]
        raw_text = output_message["content"][0]["text"]
        return {"content": raw_text}
    except Exception as exc:
        logger.error("Bedrock RAG call failed: %s", exc)
        return {
            "content": (
                "I'm sorry, I wasn't able to generate a response right now. "
                "Please try again in a moment."
            )
        }


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
async def send_message(
    session_id: int,
    body: ChatMessageCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ChatMessageResponse:
    """Send a message in a chat session and get a RAG-powered response.

    1. Saves user message.
    2. Generates embedding of the question.
    3. Queries pgvector for top-5 relevant atomic claims in the workspace.
    4. Builds RAG context and calls Bedrock for a tutor response.
    5. Saves and returns the assistant message with sources.
    """
    # Verify session ownership
    stmt = select(ChatSession).where(
        ChatSession.id == session_id,
        ChatSession.user_id == user_id,
    )
    chat_session = (await db.execute(stmt)).scalar_one_or_none()
    if chat_session is None:
        raise HTTPException(status_code=404, detail="Chat session not found")

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
        # Fall back to no-context response
        embedding = None

    # 3. Query pgvector for top-5 relevant claims in this workspace
    sources: list[dict[str, Any]] = []
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
            sources.append(
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

    # 4. Build context and call Bedrock
    context_str = "\n\n".join(context_parts) if context_parts else "No relevant context found in the knowledge base."
    rag_result = await asyncio.to_thread(_rag_converse, context_str, body.content)

    # 5. Save and return assistant message
    assistant_msg = ChatMessage(
        session_id=session_id,
        role="assistant",
        content=rag_result["content"],
        sources=sources if sources else None,
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
    """Check if chat is locked because the user has an incomplete activity.

    Per spec section 12: chat is locked during active practice to maintain
    focus.
    """
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
