"""Amazon Bedrock integration — Claude 3.5 Sonnet for grading, Titan for embeddings."""

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
