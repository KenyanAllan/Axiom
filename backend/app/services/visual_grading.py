"""Visual activity grading — Rekognition structural checks + Claude Vision holistic assessment."""

from __future__ import annotations

import json
import logging
from typing import Any

from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import get_settings
from app.services.rekognition import detect_image_labels, detect_image_text

logger = logging.getLogger(__name__)
settings = get_settings()

VISUAL_GRADING_PROMPT = """\
You are a precise visual grading assistant for the Axiom learning platform.

You will receive:
1. An IMAGE — the student's hand-drawn or photographed submission.
2. A CLAIM — the concept the student should demonstrate understanding of.
3. A RUBRIC — specific criteria for evaluating the visual response.

Your task:
- Evaluate the student's visual submission against the rubric.
- Assign one of three outcomes:
  - "understood": the visual response demonstrates clear understanding of the concept.
  - "did_not_understand": the visual response contains significant errors or misses key elements.
  - "neutral": the visual response is partially correct or hard to evaluate.
- Return a JSON object with exactly two keys:
  - "outcome": one of "understood", "did_not_understand", or "neutral"
  - "feedback": a 2-4 sentence formative explanation. Reference specific visual elements
    you observe. If the drawing is unclear, suggest how to improve it.

Return ONLY the JSON object. No markdown fences, no preamble.
"""


def _get_bedrock_client() -> Any:
    from app.services.bedrock import _get_client
    return _get_client()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def grade_with_vision(
    image_bytes: bytes,
    claim_content: str,
    rubric: str,
    image_format: str = "jpeg",
) -> dict[str, Any]:
    """Send image + rubric to Bedrock Converse for holistic grading."""
    client = _get_bedrock_client()

    fmt = image_format.lower().replace("jpg", "jpeg")
    if fmt not in ("jpeg", "png", "gif", "webp"):
        fmt = "jpeg"

    response = client.converse(
        modelId=settings.bedrock_model_id,
        system=[{"text": VISUAL_GRADING_PROMPT}],
        messages=[
            {
                "role": "user",
                "content": [
                    {"image": {"format": fmt, "source": {"bytes": image_bytes}}},
                    {"text": f"## CLAIM\n{claim_content}\n\n## RUBRIC\n{rubric}"},
                ],
            }
        ],
        inferenceConfig={"maxTokens": 1024, "temperature": 0.1},
    )

    raw_text = response["output"]["message"]["content"][0]["text"]
    logger.debug("Visual grading raw response: %s", raw_text)

    try:
        result = json.loads(raw_text)
    except json.JSONDecodeError:
        logger.warning("Failed to parse visual grading JSON: %s", raw_text)
        result = {"outcome": "neutral", "feedback": raw_text[:500]}

    return result


def _check_structural_elements(
    labels: list[dict],
    detected_text: str,
    expected_structure: dict,
) -> tuple[bool, list[str]]:
    """Check Rekognition results against expected structural criteria.

    Returns (passed, missing_elements).
    """
    missing = []

    required_labels = expected_structure.get("required_labels", [])
    if required_labels:
        label_names = {l["name"].lower() for l in labels}
        text_lower = detected_text.lower()
        for req in required_labels:
            if req.lower() not in label_names and req.lower() not in text_lower:
                missing.append(req)

    min_count = expected_structure.get("expected_label_count_min", 0)
    if min_count > 0 and len(labels) < min_count:
        missing.append(f"Expected at least {min_count} visual elements, found {len(labels)}")

    return len(missing) == 0, missing


def _detect_non_academic_image(labels: list[dict]) -> bool:
    """Detect if image is a selfie or non-academic content."""
    non_academic = {"person", "face", "selfie", "human", "portrait", "smile"}
    academic = {"text", "handwriting", "diagram", "drawing", "document", "paper",
                "writing", "number", "symbol", "graph", "chart", "whiteboard"}

    label_names = {l["name"].lower() for l in labels}
    has_non_academic = bool(label_names & non_academic)
    has_academic = bool(label_names & academic)

    return has_non_academic and not has_academic


def grade_visual_response(
    image_bytes: bytes,
    activity_payload: dict,
    claim_content: str,
    image_format: str = "jpeg",
) -> dict:
    """Grade a visual student submission using Rekognition + Claude Vision.

    1. Rekognition: detect labels + text for structural verification.
    2. Check for non-academic images (selfies, etc.).
    3. Claude Vision: holistic grading with rubric.
    4. Combine: structural check can cap outcome at "neutral".

    Returns: {"outcome", "feedback", "rekognition_labels", "structural_check"}
    """
    labels = detect_image_labels(image_bytes)
    detected_text = detect_image_text(image_bytes)

    logger.info(
        "Rekognition results: %d labels, %d chars text",
        len(labels), len(detected_text),
    )

    if _detect_non_academic_image(labels):
        return {
            "outcome": "did_not_understand",
            "feedback": (
                "This doesn't appear to be your academic work. "
                "Please upload a photo of your drawing or written solution."
            ),
            "rekognition_labels": labels,
            "structural_check": False,
        }

    expected_structure = activity_payload.get("expected_structure", {})
    structural_passed, missing = _check_structural_elements(
        labels, detected_text, expected_structure,
    )

    rubric = activity_payload.get("reference_description", "")
    grading_rubric = activity_payload.get("grading_rubric", "")
    if grading_rubric:
        rubric = f"{rubric}\n\nGrading criteria: {grading_rubric}"
    if not rubric:
        rubric = "Evaluate whether the visual response accurately represents the concept."

    if detected_text:
        rubric += f"\n\nDetected text in the image: {detected_text[:500]}"

    try:
        vision_result = grade_with_vision(image_bytes, claim_content, rubric, image_format)
    except Exception:
        logger.error("Claude Vision grading failed", exc_info=True)
        vision_result = {
            "outcome": "neutral",
            "feedback": "Your image was hard to evaluate. Try taking a clearer photo with better lighting.",
        }

    outcome = vision_result.get("outcome", "neutral")
    feedback = vision_result.get("feedback", "")

    if not structural_passed and outcome == "understood":
        outcome = "neutral"
        if missing:
            feedback += f" Note: some expected elements were not detected: {', '.join(missing)}."

    return {
        "outcome": outcome,
        "feedback": feedback,
        "rekognition_labels": labels,
        "structural_check": structural_passed,
    }
