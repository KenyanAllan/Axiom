"""Amazon Rekognition integration — image label detection and text extraction."""

from __future__ import annotations

import logging
from typing import Any

import boto3
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_rekognition_client: Any = None


def _get_rekognition_client() -> Any:
    """Lazy singleton for the Rekognition client."""
    global _rekognition_client
    if _rekognition_client is None:
        kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
        if settings.aws_access_key_id:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        _rekognition_client = boto3.client("rekognition", **kwargs)
    return _rekognition_client


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def detect_image_text(image_bytes: bytes) -> str:
    """Detect text in an image using Rekognition DetectText.

    Returns concatenated detected text lines. Supports PNG/JPEG up to 5 MB.
    Complements Textract by catching annotations inside diagrams.
    """
    client = _get_rekognition_client()

    response = client.detect_text(Image={"Bytes": image_bytes})

    lines: list[str] = []
    for detection in response.get("TextDetections", []):
        if detection["Type"] == "LINE" and detection.get("Confidence", 0) >= 70:
            lines.append(detection["DetectedText"])

    return "\n".join(lines)


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def detect_image_labels(image_bytes: bytes) -> list[dict]:
    """Detect labels in an image using Rekognition DetectLabels.

    Returns top-10 labels with confidence scores. Used to classify
    image content (diagram, handwriting, photo, etc.).
    """
    client = _get_rekognition_client()

    response = client.detect_labels(
        Image={"Bytes": image_bytes},
        MaxLabels=10,
        MinConfidence=60,
    )

    return [
        {"name": label["Name"], "confidence": round(label["Confidence"], 1)}
        for label in response.get("Labels", [])
    ]
