"""Amazon Translate integration — text translation with Custom Terminology."""

from __future__ import annotations

import logging
from typing import Any

import boto3
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_translate_client: Any = None


def _get_translate_client() -> Any:
    global _translate_client
    if _translate_client is None:
        kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
        if settings.aws_access_key_id:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        _translate_client = boto3.client("translate", **kwargs)
    return _translate_client


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def detect_language(text: str) -> str:
    client = _get_translate_client()
    try:
        response = client.translate_text(
            Text=text[:1000],
            SourceLanguageCode="auto",
            TargetLanguageCode="en",
        )
        detected = response.get("SourceLanguageCode", "en")
        logger.info("Detected language: %s", detected)
        return detected
    except Exception as exc:
        logger.warning("Language detection failed: %s — defaulting to 'en'", exc)
        return "en"


_TRANSLATE_MAX_BYTES = 9500  # Stay under AWS Translate's 10,000-byte limit


def _chunk_text_for_translate(text: str, max_bytes: int = _TRANSLATE_MAX_BYTES) -> list[str]:
    """Split text into chunks that each fit within the byte limit."""
    chunks: list[str] = []
    remaining = text
    while remaining:
        encoded = remaining.encode("utf-8")
        if len(encoded) <= max_bytes:
            chunks.append(remaining)
            break
        # Find a safe split point within the byte limit
        truncated = encoded[:max_bytes].decode("utf-8", errors="ignore")
        split_pos = truncated.rfind(". ")
        if split_pos == -1:
            split_pos = truncated.rfind("\n")
        if split_pos == -1:
            split_pos = truncated.rfind(" ")
        if split_pos == -1:
            split_pos = len(truncated)
        else:
            split_pos += 1  # Include the delimiter
        chunks.append(remaining[:split_pos])
        remaining = remaining[split_pos:].lstrip()
    return chunks


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def translate_text(
    text: str,
    source_lang: str,
    target_lang: str,
    terminology_names: list[str] | None = None,
) -> str:
    if source_lang == target_lang:
        return text

    client = _get_translate_client()

    chunks = _chunk_text_for_translate(text)
    translated_parts: list[str] = []

    for chunk in chunks:
        kwargs: dict[str, Any] = {
            "Text": chunk,
            "SourceLanguageCode": source_lang,
            "TargetLanguageCode": target_lang,
        }
        if terminology_names:
            kwargs["TerminologyNames"] = terminology_names

        response = client.translate_text(**kwargs)
        translated_parts.append(response["TranslatedText"])

    translated = " ".join(translated_parts)
    logger.info(
        "Translated %d chars %s→%s (%d chars out, %d chunks)",
        len(text), source_lang, target_lang, len(translated), len(chunks),
    )
    return translated


def register_custom_terminology(csv_path: str, name: str) -> None:
    client = _get_translate_client()
    with open(csv_path, "rb") as f:
        csv_bytes = f.read()

    client.import_terminology(
        Name=name,
        MergeStrategy="OVERWRITE",
        TerminologyData={"File": csv_bytes, "Format": "CSV"},
    )
    logger.info("Registered custom terminology '%s' from %s", name, csv_path)
