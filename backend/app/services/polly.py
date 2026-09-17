"""Amazon Polly integration — text-to-speech synthesis and speech marks."""

from __future__ import annotations

import json
import logging
from typing import Any

import boto3

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# Threshold for switching from synchronous to async synthesis
_LONG_TEXT_THRESHOLD = 3000

_polly_client: Any = None
_s3_client: Any = None


def _get_polly_client() -> Any:
    """Lazy singleton for the Polly client."""
    global _polly_client
    if _polly_client is None:
        kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
        if settings.aws_access_key_id:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        _polly_client = boto3.client("polly", **kwargs)
    return _polly_client


def _get_s3_client() -> Any:
    """Lazy singleton for the S3 client (used to upload short-text audio)."""
    global _s3_client
    if _s3_client is None:
        kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
        if settings.aws_access_key_id:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        _s3_client = boto3.client("s3", **kwargs)
    return _s3_client


def synthesize_speech(text: str, output_key: str) -> dict[str, Any]:
    """Synthesize speech from text using Amazon Polly.

    For short text (<= 3000 chars), uses synchronous synthesize_speech.
    For long text (> 3000 chars), uses start_speech_synthesis_task.

    Args:
        text: The text to convert to speech.
        output_key: The S3 key where the audio file should be stored.

    Returns:
        {"s3_key": str, "duration_seconds": float | None}
    """
    polly = _get_polly_client()

    if len(text) > _LONG_TEXT_THRESHOLD:
        return _synthesize_long_text(polly, text, output_key)
    else:
        return _synthesize_short_text(polly, text, output_key)


def _synthesize_short_text(
    polly: Any, text: str, output_key: str
) -> dict[str, Any]:
    """Synchronous synthesis for short text — returns audio directly."""
    try:
        response = polly.synthesize_speech(
            Text=text,
            OutputFormat="mp3",
            VoiceId=settings.polly_voice_id,
            Engine=settings.polly_engine,
        )

        audio_stream = response["AudioStream"].read()

        # Upload to S3
        s3 = _get_s3_client()
        s3.put_object(
            Bucket=settings.polly_output_bucket,
            Key=output_key,
            Body=audio_stream,
            ContentType="audio/mpeg",
        )

        # Estimate duration from content length (MP3 at ~128kbps)
        duration_seconds = len(audio_stream) / (128 * 1000 / 8) if audio_stream else None

        logger.info(
            "Synthesized short text (%d chars) -> s3://%s/%s",
            len(text),
            settings.polly_output_bucket,
            output_key,
        )

        return {"s3_key": output_key, "duration_seconds": round(duration_seconds, 2) if duration_seconds else None}
    except Exception as exc:
        logger.error("Polly short-text synthesis failed: %s", exc)
        raise


def _chunk_text_for_polly(text: str, max_chars: int = 2900) -> list[str]:
    """Split text into chunks under max_chars, breaking at sentence boundaries."""
    chunks: list[str] = []
    remaining = text
    while remaining:
        if len(remaining) <= max_chars:
            chunks.append(remaining)
            break
        # Find a sentence boundary within the limit
        split_pos = remaining.rfind(". ", 0, max_chars)
        if split_pos == -1:
            split_pos = remaining.rfind(" ", 0, max_chars)
        if split_pos == -1:
            split_pos = max_chars
        else:
            split_pos += 1  # Include the period/space
        chunks.append(remaining[:split_pos])
        remaining = remaining[split_pos:].lstrip()
    return chunks


def _synthesize_long_text(
    polly: Any, text: str, output_key: str
) -> dict[str, Any]:
    """Synchronous chunked synthesis for long text — avoids async task 404s."""
    try:
        chunks = _chunk_text_for_polly(text)
        audio_parts: list[bytes] = []

        for i, chunk in enumerate(chunks):
            response = polly.synthesize_speech(
                Text=chunk,
                OutputFormat="mp3",
                VoiceId=settings.polly_voice_id,
                Engine=settings.polly_engine,
            )
            audio_parts.append(response["AudioStream"].read())
            logger.debug("Synthesized chunk %d/%d (%d chars)", i + 1, len(chunks), len(chunk))

        audio_data = b"".join(audio_parts)

        # Upload concatenated audio to S3
        s3 = _get_s3_client()
        s3.put_object(
            Bucket=settings.polly_output_bucket,
            Key=output_key,
            Body=audio_data,
            ContentType="audio/mpeg",
        )

        duration_seconds = len(audio_data) / (128 * 1000 / 8) if audio_data else None

        logger.info(
            "Synthesized long text (%d chars, %d chunks) -> s3://%s/%s",
            len(text),
            len(chunks),
            settings.polly_output_bucket,
            output_key,
        )

        return {
            "s3_key": output_key,
            "duration_seconds": round(duration_seconds, 2) if duration_seconds else None,
        }
    except Exception as exc:
        logger.error("Polly long-text synthesis failed: %s", exc)
        raise


def generate_speech_marks(text: str) -> list[dict[str, Any]]:
    """Generate word-level speech marks for text synchronization.

    Returns:
        List of {"time": int, "type": str, "value": str} dicts.
        time is in milliseconds.
    """
    polly = _get_polly_client()

    try:
        response = polly.synthesize_speech(
            Text=text,
            OutputFormat="json",
            VoiceId=settings.polly_voice_id,
            Engine=settings.polly_engine,
            SpeechMarkTypes=["word"],
        )

        # Speech marks come as newline-delimited JSON
        raw = response["AudioStream"].read().decode("utf-8")
        marks: list[dict[str, Any]] = []

        for line in raw.strip().split("\n"):
            if line.strip():
                mark = json.loads(line)
                marks.append(
                    {
                        "time": mark.get("time", 0),
                        "type": mark.get("type", "word"),
                        "value": mark.get("value", ""),
                    }
                )

        logger.info("Generated %d speech marks for %d chars of text", len(marks), len(text))
        return marks
    except Exception as exc:
        logger.error("Polly speech marks generation failed: %s", exc)
        return []
