"""Amazon Bedrock integration — Claude Sonnet 4.6 for grading, Titan for embeddings."""

from __future__ import annotations

import json
import logging
from typing import Any

import boto3
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_bedrock_runtime: Any = None


def _get_client() -> Any:
    """Lazy singleton for the Bedrock Runtime client."""
    global _bedrock_runtime
    if _bedrock_runtime is None:
        kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
        if settings.aws_access_key_id:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        _bedrock_runtime = boto3.client("bedrock-runtime", **kwargs)
    return _bedrock_runtime


# ─── Grading via Converse API ───────────────────────────────────────────────────

GRADING_SYSTEM_PROMPT = """\
You are a precise technical grading assistant for the Axiom learning platform.

You will receive:
1. A CLAIM — the factual assertion the student should understand.
2. A RUBRIC — the acceptance criteria for a correct response.
3. A STUDENT RESPONSE — the student's written answer or diagnosis.

Your task:
- Evaluate the student's response against the rubric and assign one of three outcomes:
  - "understood": the response meets the rubric criteria and demonstrates understanding.
  - "did_not_understand": the response contains errors or misses the rubric criteria.
  - "neutral": the response is ambiguous, partially correct, or shows awareness but not mastery.
- Return a JSON object with exactly two keys:
  - "outcome": one of "understood", "did_not_understand", or "neutral"
  - "feedback": a 2-4 sentence formative explanation. If understood, reinforce
    why the reasoning is sound. If did_not_understand, identify the specific gap
    without giving away the full answer. If neutral, acknowledge partial progress.

Return ONLY the JSON object. No markdown fences, no preamble.
"""


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def grade_response(
    claim_content: str,
    rubric: str,
    student_response: str,
) -> dict[str, Any]:
    """Call Bedrock Converse API to grade a student response.

    Returns {"is_correct": bool, "feedback": str}.
    """
    client = _get_client()

    user_message = (
        f"## CLAIM\n{claim_content}\n\n"
        f"## RUBRIC\n{rubric}\n\n"
        f"## STUDENT RESPONSE\n{student_response}"
    )

    response = client.converse(
        modelId=settings.bedrock_model_id,
        system=[{"text": GRADING_SYSTEM_PROMPT}],
        messages=[
            {
                "role": "user",
                "content": [{"text": user_message}],
            }
        ],
        inferenceConfig={
            "maxTokens": 512,
            "temperature": 0.0,
            "topP": 0.9,
        },
    )

    # Extract text from the Converse response structure
    output_message = response["output"]["message"]
    raw_text = output_message["content"][0]["text"]

    logger.debug("Bedrock raw grading response: %s", raw_text)

    # Parse JSON from the model output
    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError:
        # Attempt to extract JSON from markdown fences if model wrapped it
        import re
        match = re.search(r"\{.*\}", raw_text, re.DOTALL)
        if match:
            result = json.loads(match.group())
        else:
            logger.error("Failed to parse grading JSON: %s", raw_text)
            result = {
                "outcome": "neutral",
                "feedback": "The system could not parse the evaluation. Please try again.",
            }

    # Normalize: support both new 3-outcome and legacy is_correct formats
    outcome = result.get("outcome")
    if outcome not in ("understood", "did_not_understand", "neutral"):
        is_correct = result.get("is_correct", False)
        outcome = "understood" if is_correct else "did_not_understand"

    return {
        "outcome": outcome,
        "feedback": str(result.get("feedback", "No feedback generated.")),
    }


# ─── Activity generation via Converse API ─────────────────────────────────────────

@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def generate_activity(
    system_prompt: str,
    claim_title: str,
    claim_content: str,
) -> dict[str, Any]:
    """Call Bedrock Converse API to generate a learning activity.

    Returns the parsed JSON object from the model.
    """
    client = _get_client()

    user_message = (
        f"## CLAIM TITLE\n{claim_title}\n\n"
        f"## CLAIM CONTENT\n{claim_content}"
    )

    response = client.converse(
        modelId=settings.bedrock_model_id,
        system=[{"text": system_prompt}],
        messages=[
            {
                "role": "user",
                "content": [{"text": user_message}],
            }
        ],
        inferenceConfig={
            "maxTokens": 1024,
            "temperature": 0.4,
        },
    )

    raw_text = response["output"]["message"]["content"][0]["text"]
    logger.debug("Bedrock raw activity generation response: %s", raw_text)

    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        import re as _re
        match = _re.search(r"\{.*\}", raw_text, _re.DOTALL)
        if match:
            return json.loads(match.group())
        logger.error("Failed to parse activity generation JSON: %s", raw_text)
        return {}


# ─── Audio script generation via Converse API ─────────────────────────────────────

AUDIO_SCRIPT_CONVERSATIONAL = """\
You are a friendly study-buddy narrator for the Axiom learning platform.

You will receive a list of TOPICS, each with its ATOMIC CLAIMS — the factual
assertions students need to understand. You may also receive an optional
USER INSTRUCTION with extra guidance.

Your task: write a conversational audio overview script that a text-to-speech
engine will read aloud. Requirements:

1. TONE: Casual, energetic, like explaining to a friend over coffee. Use
   "we", "let's", contractions, and rhetorical questions.
2. STRUCTURE: Open with a 1-2 sentence hook. Walk through the key concepts
   from the claims, connecting them with transitions. Close with a brief recap.
3. ANALOGIES & EXAMPLES: For each major concept, include at least one concrete
   analogy or worked example that makes the idea tangible. Prefer everyday
   analogies a non-expert would grasp.
4. ACCURACY: Every factual statement must be grounded in the provided claims.
   Do not invent facts beyond what the claims state.
5. LENGTH: Aim for 400-800 words (roughly 3-5 minutes when read aloud at
   normal speed). Respect any length constraints in the user instruction.
6. SPEECH-FRIENDLY: Avoid parentheses, bullet points, markdown, URLs,
   or special characters. Spell out abbreviations on first use. Use short
   sentences and natural pauses (periods, not semicolons).

Return a JSON object with exactly two keys:
- "script": the full narration text (string)
- "question": a single comprehension question the listener should be able to
  answer after hearing the overview (string)

Return ONLY the JSON object. No markdown fences, no preamble.
"""

AUDIO_SCRIPT_NARRATIVE = """\
You are a storytelling narrator for the Axiom learning platform.

You will receive a list of TOPICS, each with its ATOMIC CLAIMS — the factual
assertions students need to understand. You may also receive an optional
USER INSTRUCTION with extra guidance.

Your task: write a narrative audio overview script that weaves the concepts
into an engaging story or journey. A text-to-speech engine will read this
aloud. Requirements:

1. TONE: Thoughtful and immersive, like a documentary narrator or a chapter
   from a popular science book. Use vivid analogies and a narrative arc.
2. STRUCTURE: Begin with a compelling scene-setting or "imagine this" opening.
   Introduce concepts as discoveries or steps in a journey. Build toward a
   satisfying conclusion that ties ideas together.
3. ANALOGIES & EXAMPLES: For each major concept, include at least one concrete
   analogy or worked example woven naturally into the narrative. Make abstract
   ideas feel real through vivid comparisons.
4. ACCURACY: Every factual statement must be grounded in the provided claims.
   Do not invent facts beyond what the claims state.
5. LENGTH: Aim for 400-800 words (roughly 3-5 minutes when read aloud at
   normal speed). Respect any length constraints in the user instruction.
6. SPEECH-FRIENDLY: Avoid parentheses, bullet points, markdown, URLs,
   or special characters. Spell out abbreviations on first use. Use short
   sentences and natural pauses (periods, not semicolons).

Return a JSON object with exactly two keys:
- "script": the full narration text (string)
- "question": a single comprehension question the listener should be able to
  answer after hearing the overview (string)

Return ONLY the JSON object. No markdown fences, no preamble.
"""

AUDIO_SCRIPT_DISCUSSION = """\
You are a script writer for the Axiom learning platform.

You will receive a list of TOPICS, each with its ATOMIC CLAIMS — the factual
assertions students need to understand. You may also receive an optional
USER INSTRUCTION with extra guidance.

Your task: write a discussion-style audio script between two speakers — Alex
and Sam — who explore the concepts together in a natural back-and-forth
conversation. A text-to-speech engine will read this aloud. Requirements:

1. TONE: Natural, curious, and enthusiastic. Alex tends to explain and teach.
   Sam asks good questions, pushes back, and connects ideas to real life.
   They build on each other's points.
2. STRUCTURE: Sam opens with a question or observation that kicks off the
   discussion. They work through the key concepts together, with Alex
   introducing ideas and Sam probing deeper. End with a brief summary
   exchange.
3. FORMAT: Prefix each line with the speaker name followed by a colon.
   Example: "Alex: So the key thing about eigenvalues is..."
   "Sam: Wait, so you're saying the matrix just stretches the vector?"
   Keep exchanges short — 1-3 sentences each. Alternate frequently.
4. ANALOGIES & EXAMPLES: For each major concept, at least one speaker must
   offer a concrete analogy or example. Sam often asks "so it's kind of
   like..." and Alex confirms or refines.
5. ACCURACY: Every factual statement must be grounded in the provided claims.
   Do not invent facts beyond what the claims state.
6. LENGTH: Aim for 400-800 words (roughly 3-5 minutes when read aloud at
   normal speed). Respect any length constraints in the user instruction.
7. SPEECH-FRIENDLY: Avoid parentheses, bullet points, markdown, URLs,
   or special characters. Spell out abbreviations on first use.

Return a JSON object with exactly two keys:
- "script": the full discussion script (string, with "Alex:" and "Sam:" prefixes)
- "question": a single comprehension question the listener should be able to
  answer after hearing the discussion (string)

Return ONLY the JSON object. No markdown fences, no preamble.
"""

AUDIO_SCRIPT_PROMPTS: dict[str, str] = {
    "conversational": AUDIO_SCRIPT_CONVERSATIONAL,
    "narrative": AUDIO_SCRIPT_NARRATIVE,
    "discussion": AUDIO_SCRIPT_DISCUSSION,
}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def generate_audio_script(
    style: str,
    topics_text: str,
    user_instruction: str | None = None,
) -> dict[str, Any]:
    """Call Bedrock Converse API to generate an audio overview script.

    Returns {"script": str, "question": str}.
    """
    client = _get_client()

    system_prompt = AUDIO_SCRIPT_PROMPTS.get(style, AUDIO_SCRIPT_CONVERSATIONAL)

    user_message = f"## TOPICS AND CLAIMS\n\n{topics_text}"
    if user_instruction:
        user_message += f"\n\n## USER INSTRUCTION\n{user_instruction}"

    response = client.converse(
        modelId=settings.bedrock_model_id,
        system=[{"text": system_prompt}],
        messages=[
            {
                "role": "user",
                "content": [{"text": user_message}],
            }
        ],
        inferenceConfig={
            "maxTokens": 4096,
            "temperature": 0.7,
        },
    )

    raw_text = response["output"]["message"]["content"][0]["text"]
    logger.debug("Bedrock raw audio script response: %s", raw_text)

    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        import re as _re
        match = _re.search(r"\{.*\}", raw_text, _re.DOTALL)
        if match:
            return json.loads(match.group())
        logger.error("Failed to parse audio script JSON: %s", raw_text)
        return {"script": raw_text, "question": ""}


# ─── Streaming Converse API ──────────────────────────────────────────────────────


def call_bedrock_converse_stream(
    messages: list[dict],
    tool_config: dict | None = None,
    system_prompt: str | None = None,
) -> dict:
    """Call Bedrock converse_stream (synchronous, returns an EventStream iterator).

    The caller iterates ``response["stream"]`` to receive incremental events.
    No @retry — a half-consumed stream cannot be replayed.
    """
    client = _get_client()

    kwargs: dict[str, Any] = {
        "modelId": settings.bedrock_model_id,
        "system": [{"text": system_prompt}] if system_prompt else [],
        "messages": messages,
        "inferenceConfig": {
            "maxTokens": 2048,
            "temperature": 0.3,
            "topP": 0.9,
        },
    }
    if tool_config is not None:
        kwargs["toolConfig"] = tool_config

    return client.converse_stream(**kwargs)


# ─── Embeddings via Titan Embeddings v2 ─────────────────────────────────────────

@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def generate_embedding(text: str) -> list[float]:
    """Generate a 1024-dim embedding using Amazon Titan Embeddings v2."""
    client = _get_client()

    response = client.invoke_model(
        modelId=settings.bedrock_embed_model_id,
        contentType="application/json",
        accept="application/json",
        body=json.dumps({
            "inputText": text,
            "dimensions": 1024,
            "normalize": True,
        }),
    )

    result = json.loads(response["body"].read())
    return result["embedding"]
