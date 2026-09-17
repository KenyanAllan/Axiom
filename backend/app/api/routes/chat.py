"""Chat endpoints — RAG-powered tutor conversations with tool-use."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
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
from tenacity import retry, stop_after_attempt, wait_exponential

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
    image_s3_keys: list[str] | None = None


class ChatMessageResponse(BaseModel):
    id: int
    session_id: int
    role: str
    content: str
    sources: list[dict[str, Any]] | dict[str, Any] | None = None
    image_s3_keys: list[str] | None = None
    image_urls: list[str] | None = None
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
- create_activities_for_claim generates these types: flashcard, true_false, \
multi_choice, fill_blank, wrong_on_purpose, feynman, visual_sketch, \
visual_label, visual_proof, and parsons. You can specify which types to \
create, or omit to create all of them
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
without using tools

WHEN THE STUDENT SHARES AN IMAGE:
- Describe what you see before diving into analysis
- For homework/problem sets: identify each problem, walk through one at a \
time using Socratic questioning — ask the student what they think the first \
step is before showing the solution
- For diagrams: identify components and relationships, ask if the student \
can explain what the diagram represents
- For handwritten work: read the work carefully, identify where errors \
occur, and guide the student to find the mistake themselves rather than \
pointing it out directly
- Never give away the full answer immediately — scaffold understanding \
through questions"""


# ── RAG + Tool-use converse ────────────────────────────────────────────────


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _call_bedrock_converse(
    messages: list[dict],
    tool_config: dict | None = None,
    system_prompt: str | None = None,
) -> dict:
    """Synchronous Bedrock Converse API call (runs in thread pool)."""
    from app.services.bedrock import _get_client

    client = _get_client()

    kwargs: dict[str, Any] = {
        "modelId": settings.bedrock_model_id,
        "system": [{"text": system_prompt or RAG_SYSTEM_PROMPT}],
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
    conversation_history: list | None = None,
    image_blocks: list[dict] | None = None,
) -> dict[str, Any]:
    """Multi-turn Bedrock Converse with tool-use loop.

    1. Include conversation history for multi-turn context
    2. Send user message with RAG context (+ optional image blocks)
    3. If model requests tool calls, execute them and send results back
    4. Repeat until model returns text (or max rounds reached)
    """
    messages: list[dict] = []

    if conversation_history:
        for msg in conversation_history:
            if messages and messages[-1]["role"] == msg.role:
                continue
            messages.append({
                "role": msg.role,
                "content": [{"text": msg.content}],
            })
        if messages and messages[-1]["role"] == "user":
            messages.pop()

    prompt = (
        f"## CONTEXT (retrieved from the knowledge base)\n{context}\n\n"
        f"## USER MESSAGE\n{user_message}"
    )
    content_blocks: list[dict] = []
    if image_blocks:
        content_blocks.extend(image_blocks)
    content_blocks.append({"text": prompt})
    messages.append({"role": "user", "content": content_blocks})

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

    resp = ChatSessionResponse.model_validate(session)

    from app.services.s3 import generate_download_url

    for msg_resp in resp.messages:
        if msg_resp.image_s3_keys:
            msg_resp.image_urls = [generate_download_url(k) for k in msg_resp.image_s3_keys]

    return resp


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: int,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete a chat session and all its messages."""
    stmt = select(ChatSession).where(
        ChatSession.id == session_id,
        ChatSession.user_id == user_id,
    )
    session = (await db.execute(stmt)).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Chat session not found")
    await db.delete(session)
    await db.flush()
    return Response(status_code=204)


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
    logger.info("send_message: user_id=%s session_id=%s", user_id, session_id)

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

    # Load recent conversation history for multi-turn context
    history_stmt = (
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(10)
    )
    history_rows = (await db.execute(history_stmt)).scalars().all()
    conversation_history = list(reversed(history_rows))

    # 1. Save user message (with optional image keys)
    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=body.content,
        image_s3_keys=body.image_s3_keys,
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

    if embedding is None:
        logger.info("RAG skipped: embedding generation failed for session_id=%s", session_id)

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
            similarity = round(1 - (row.distance or 1.0), 4)
            if similarity < 0.3:
                continue
            rag_sources.append(
                {
                    "claim_id": row.id,
                    "claim_title": row.title,
                    "topic_title": row.topic_title,
                    "relevance_score": similarity,
                }
            )
            context_parts.append(
                f"[{row.topic_title} > {row.title}]: {row.content}"
            )

    if not rag_sources:
        logger.info("RAG context yielded zero results for session_id=%s", session_id)

    # 4. Call Bedrock with tool-use loop
    context_str = (
        "\n\n".join(context_parts)
        if context_parts
        else "No relevant context found in the knowledge base."
    )

    # 4a. Build multimodal image blocks if images attached
    image_blocks: list[dict] | None = None
    if body.image_s3_keys:
        from app.services.s3 import download_bytes

        image_blocks = []
        for s3_key in body.image_s3_keys[:5]:
            try:
                img_bytes = await asyncio.to_thread(download_bytes, s3_key)
                fmt = "jpeg"
                lower_key = s3_key.lower()
                if lower_key.endswith(".png"):
                    fmt = "png"
                elif lower_key.endswith(".gif"):
                    fmt = "gif"
                elif lower_key.endswith(".webp"):
                    fmt = "webp"
                image_blocks.append({
                    "image": {
                        "format": fmt,
                        "source": {"bytes": img_bytes},
                    }
                })
            except Exception as exc:
                logger.warning("Failed to download chat image %s: %s", s3_key, exc)

        if not image_blocks:
            image_blocks = None

    import time as _time
    _bedrock_start = _time.monotonic()
    rag_result = await _rag_converse_with_tools(
        context=context_str,
        user_message=body.content,
        db=db,
        user_id=user_id,
        workspace_id=chat_session.workspace_id,
        user_role=user_role,
        classroom_id=classroom_id,
        conversation_history=conversation_history,
        image_blocks=image_blocks,
    )
    _bedrock_elapsed = _time.monotonic() - _bedrock_start
    logger.info("Bedrock converse completed in %.2fs for session_id=%s", _bedrock_elapsed, session_id)

    # 5. Translate response if user prefers non-English
    user_lang = user.preferred_language if user else "en"
    if user_lang and user_lang != "en":
        try:
            from app.services.translate import translate_text

            rag_result["content"] = await asyncio.to_thread(
                translate_text,
                rag_result["content"],
                "en",
                user_lang,
                [settings.translate_terminology_name],
            )
        except Exception as exc:
            logger.warning("Chat response translation failed: %s", exc)

    # 6. Save and return assistant message
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


# ── Streaming endpoint ─────────────────────────────────────────────────────

TOOL_STATUS_LABELS: dict[str, str] = {
    "search_glossary": "Searching glossary…",
    "list_topics": "Looking up topics…",
    "get_topic_claims": "Fetching claims…",
    "create_activities_for_claim": "Creating activities…",
    "get_my_queue": "Checking your queue…",
    "add_activity_to_queue": "Adding to queue…",
    "auto_populate_my_queue": "Populating queue…",
    "get_learning_frontier": "Analyzing frontier…",
    "get_mastery_status": "Checking mastery…",
    "generate_audio_overview": "Generating audio…",
}


async def _iterate_bedrock_stream(bedrock_response: dict):
    """Bridge blocking Bedrock EventStream iterator to async via a Queue."""
    import threading

    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_event_loop()
    stream = bedrock_response["stream"]

    def _producer():
        try:
            for event in stream:
                loop.call_soon_threadsafe(queue.put_nowait, event)
        except Exception as exc:
            loop.call_soon_threadsafe(queue.put_nowait, exc)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    thread = threading.Thread(target=_producer, daemon=True)
    thread.start()

    while True:
        event = await queue.get()
        if event is None:
            break
        if isinstance(event, Exception):
            raise event
        yield event


async def _stream_rag_converse_with_tools(
    context: str,
    user_message: str,
    db: AsyncSession,
    user_id: str,
    workspace_id: int,
    user_role: str,
    classroom_id: int | None,
    conversation_history: list | None = None,
    image_blocks: list[dict] | None = None,
):
    """Streaming version of _rag_converse_with_tools — yields SSE event dicts."""
    from app.services.bedrock import call_bedrock_converse_stream

    messages: list[dict] = []

    if conversation_history:
        for msg in conversation_history:
            if messages and messages[-1]["role"] == msg.role:
                continue
            messages.append({
                "role": msg.role,
                "content": [{"text": msg.content}],
            })
        if messages and messages[-1]["role"] == "user":
            messages.pop()

    prompt = (
        f"## CONTEXT (retrieved from the knowledge base)\n{context}\n\n"
        f"## USER MESSAGE\n{user_message}"
    )
    content_blocks_list: list[dict] = []
    if image_blocks:
        content_blocks_list.extend(image_blocks)
    content_blocks_list.append({"text": prompt})
    messages.append({"role": "user", "content": content_blocks_list})

    tool_config = {"tools": [{"toolSpec": t} for t in TOOL_DEFINITIONS]}
    tool_calls_made: list[dict] = []

    for _round in range(MAX_TOOL_ROUNDS):
        response = await asyncio.to_thread(
            call_bedrock_converse_stream,
            messages,
            tool_config,
            RAG_SYSTEM_PROMPT,
        )

        stop_reason = "end_turn"
        accumulated_content_blocks: list[dict] = []
        current_text = ""
        current_tool_use_id = ""
        current_tool_name = ""
        current_tool_input_json = ""
        in_tool_block = False

        async for event in _iterate_bedrock_stream(response):
            if "contentBlockStart" in event:
                start = event["contentBlockStart"].get("start", {})
                if "toolUse" in start:
                    in_tool_block = True
                    current_tool_use_id = start["toolUse"]["toolUseId"]
                    current_tool_name = start["toolUse"]["name"]
                    current_tool_input_json = ""
                else:
                    in_tool_block = False
                    current_text = ""

            elif "contentBlockDelta" in event:
                delta = event["contentBlockDelta"].get("delta", {})
                if "text" in delta and not in_tool_block:
                    token = delta["text"]
                    current_text += token
                    yield {"type": "text_delta", "token": token}
                elif "toolUse" in delta and in_tool_block:
                    current_tool_input_json += delta["toolUse"].get("input", "")

            elif "contentBlockStop" in event:
                if in_tool_block:
                    try:
                        tool_input = json.loads(current_tool_input_json) if current_tool_input_json else {}
                    except json.JSONDecodeError:
                        tool_input = {}

                    label = TOOL_STATUS_LABELS.get(current_tool_name, f"Using {current_tool_name}…")
                    yield {"type": "tool_start", "tool": current_tool_name, "label": label}

                    result = await execute_tool(
                        tool_name=current_tool_name,
                        tool_input=tool_input,
                        db=db,
                        user_id=user_id,
                        workspace_id=workspace_id,
                        user_role=user_role,
                        classroom_id=classroom_id,
                    )

                    tool_call_entry: dict[str, Any] = {
                        "tool": current_tool_name,
                        "input": tool_input,
                        "output_summary": _summarize_result(result),
                    }
                    if current_tool_name == "search_glossary" and "terms" in result:
                        tool_call_entry["data"] = result["terms"]
                    tool_calls_made.append(tool_call_entry)

                    accumulated_content_blocks.append({
                        "toolUse": {
                            "toolUseId": current_tool_use_id,
                            "name": current_tool_name,
                            "input": tool_input,
                        }
                    })

                    yield {"type": "tool_end", "tool": current_tool_name, "tool_call": tool_call_entry}
                    in_tool_block = False
                else:
                    if current_text:
                        accumulated_content_blocks.append({"text": current_text})
                    current_text = ""

            elif "messageStop" in event:
                stop_reason = event["messageStop"].get("stopReason", "end_turn")

        messages.append({
            "role": "assistant",
            "content": accumulated_content_blocks if accumulated_content_blocks else [{"text": ""}],
        })

        if stop_reason != "tool_use":
            break

        tool_results: list[dict] = []
        for block in accumulated_content_blocks:
            if "toolUse" in block:
                tu = block["toolUse"]
                matching = [tc for tc in tool_calls_made if tc["tool"] == tu["name"]]
                result_data = matching[-1] if matching else {"output_summary": "ok"}
                tool_results.append({
                    "toolResult": {
                        "toolUseId": tu["toolUseId"],
                        "content": [{"json": {"summary": result_data.get("output_summary", "ok")}}],
                        "status": "success",
                    }
                })
        if tool_results:
            messages.append({"role": "user", "content": tool_results})

    yield {"type": "_done", "tool_calls_made": tool_calls_made}


@router.post("/sessions/{session_id}/messages/stream")
@limiter.limit("20/minute")
async def send_message_stream(
    request: Request,
    session_id: int,
    body: ChatMessageCreate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a message and stream the response via Server-Sent Events."""
    import json as _json
    from sse_starlette.sse import EventSourceResponse

    logger.info("send_message_stream: user_id=%s session_id=%s", user_id, session_id)

    stmt = select(ChatSession).where(
        ChatSession.id == session_id,
        ChatSession.user_id == user_id,
    )
    chat_session = (await db.execute(stmt)).scalar_one_or_none()
    if chat_session is None:
        raise HTTPException(status_code=404, detail="Chat session not found")

    user = await db.get(User, user_id)
    user_role = user.role if user else "student"
    workspace = await db.get(Workspace, chat_session.workspace_id)
    classroom_id = workspace.classroom_id if workspace else None

    history_stmt = (
        select(ChatMessage)
        .where(ChatMessage.session_id == session_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(10)
    )
    history_rows = (await db.execute(history_stmt)).scalars().all()
    conversation_history = list(reversed(history_rows))

    user_msg = ChatMessage(
        session_id=session_id,
        role="user",
        content=body.content,
        image_s3_keys=body.image_s3_keys,
    )
    db.add(user_msg)
    await db.flush()

    try:
        embedding = await asyncio.to_thread(generate_embedding, body.content)
    except Exception as exc:
        logger.error("Embedding generation failed: %s", exc)
        embedding = None

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
            similarity = round(1 - (row.distance or 1.0), 4)
            if similarity < 0.3:
                continue
            rag_sources.append({
                "claim_id": row.id,
                "claim_title": row.title,
                "topic_title": row.topic_title,
                "relevance_score": similarity,
            })
            context_parts.append(f"[{row.topic_title} > {row.title}]: {row.content}")

    context_str = "\n\n".join(context_parts) if context_parts else "No relevant context found in the knowledge base."

    image_blocks: list[dict] | None = None
    if body.image_s3_keys:
        from app.services.s3 import download_bytes

        image_blocks = []
        for s3_key in body.image_s3_keys[:5]:
            try:
                img_bytes = await asyncio.to_thread(download_bytes, s3_key)
                fmt = "jpeg"
                lower_key = s3_key.lower()
                if lower_key.endswith(".png"):
                    fmt = "png"
                elif lower_key.endswith(".gif"):
                    fmt = "gif"
                elif lower_key.endswith(".webp"):
                    fmt = "webp"
                image_blocks.append({"image": {"format": fmt, "source": {"bytes": img_bytes}}})
            except Exception as exc:
                logger.warning("Failed to download chat image %s: %s", s3_key, exc)
        if not image_blocks:
            image_blocks = None

    async def event_generator():
        full_text_parts: list[str] = []
        all_tool_calls: list[dict] = []

        try:
            async for sse_event in _stream_rag_converse_with_tools(
                context=context_str,
                user_message=body.content,
                db=db,
                user_id=user_id,
                workspace_id=chat_session.workspace_id,
                user_role=user_role,
                classroom_id=classroom_id,
                conversation_history=conversation_history,
                image_blocks=image_blocks,
            ):
                evt_type = sse_event.get("type", "")

                if evt_type == "text_delta":
                    full_text_parts.append(sse_event["token"])
                    yield {"event": "text_delta", "data": _json.dumps({"token": sse_event["token"]})}

                elif evt_type == "tool_start":
                    yield {"event": "tool_start", "data": _json.dumps({
                        "tool": sse_event["tool"], "label": sse_event["label"],
                    })}

                elif evt_type == "tool_end":
                    if "tool_call" in sse_event:
                        all_tool_calls.append(sse_event["tool_call"])
                    yield {"event": "tool_end", "data": _json.dumps({"tool": sse_event["tool"]})}

                elif evt_type == "_done":
                    if sse_event.get("tool_calls_made"):
                        all_tool_calls.extend(
                            tc for tc in sse_event["tool_calls_made"]
                            if tc not in all_tool_calls
                        )

            full_content = "".join(full_text_parts)
            if not full_content:
                full_content = "I've completed the requested actions."

            user_lang = user.preferred_language if user else "en"
            if user_lang and user_lang != "en":
                try:
                    from app.services.translate import translate_text

                    translated = await asyncio.to_thread(
                        translate_text, full_content, "en", user_lang,
                        [settings.translate_terminology_name],
                    )
                    yield {"event": "translation", "data": _json.dumps({"content": translated})}
                    full_content = translated
                except Exception:
                    pass

            sources_meta: Any = rag_sources if rag_sources else None
            if all_tool_calls:
                sources_meta = {
                    "rag_sources": rag_sources if rag_sources else None,
                    "tool_calls": all_tool_calls,
                }

            yield {"event": "sources", "data": _json.dumps({"sources": sources_meta})}

            assistant_msg = ChatMessage(
                session_id=session_id,
                role="assistant",
                content=full_content,
                sources=sources_meta,
            )
            db.add(assistant_msg)
            await db.flush()
            await db.refresh(assistant_msg)

            yield {"event": "message_complete", "data": _json.dumps({"message_id": assistant_msg.id})}

        except Exception as exc:
            logger.error("Streaming error: %s", exc, exc_info=True)
            yield {"event": "error", "data": _json.dumps({"detail": str(exc)})}

    return EventSourceResponse(event_generator())


ALLOWED_CHAT_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
MAX_CHAT_IMAGE_SIZE = 3_750_000  # 3.75 MB — Bedrock Converse limit


@router.post("/sessions/{session_id}/upload-image")
async def upload_chat_image(
    session_id: int,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Upload an image for use in a chat message. Returns the S3 key."""
    stmt = select(ChatSession).where(
        ChatSession.id == session_id,
        ChatSession.user_id == user_id,
    )
    chat_session = (await db.execute(stmt)).scalar_one_or_none()
    if chat_session is None:
        raise HTTPException(status_code=404, detail="Chat session not found")

    ct = file.content_type or ""
    if ct not in ALLOWED_CHAT_IMAGE_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported image type: {ct}. Allowed: PNG, JPEG, GIF, WebP.",
        )

    data = await file.read()
    if len(data) > MAX_CHAT_IMAGE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Image too large. Maximum size is 3.75 MB.",
        )

    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    s3_key = f"chat-images/{session_id}/{uuid4().hex}.{ext}"

    from app.services.s3 import upload_bytes, generate_download_url

    await asyncio.to_thread(upload_bytes, s3_key, data, ct)
    url = generate_download_url(s3_key)

    return {"s3_key": s3_key, "content_type": ct, "url": url}


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
