"""Amazon Transcribe integration — async speech-to-text for source documents."""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import uuid4

import boto3

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_transcribe_client: Any = None
_s3_client: Any = None


def _get_transcribe_client() -> Any:
    """Lazy singleton for the Transcribe client."""
    global _transcribe_client
    if _transcribe_client is None:
        kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
        if settings.aws_access_key_id:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        _transcribe_client = boto3.client("transcribe", **kwargs)
    return _transcribe_client


def _get_s3_client() -> Any:
    """Lazy singleton for the S3 client (used to fetch transcript results)."""
    global _s3_client
    if _s3_client is None:
        kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
        if settings.aws_access_key_id:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        _s3_client = boto3.client("s3", **kwargs)
    return _s3_client


def start_transcription(s3_key: str, source_doc_id: int) -> str:
    """Start an async transcription job for an audio/video file in S3.

    Args:
        s3_key: The S3 object key of the media file.
        source_doc_id: The SourceDocument ID (used in the job name).

    Returns:
        The transcription job name.
    """
    client = _get_transcribe_client()

    job_name = f"axiom-{source_doc_id}-{uuid4().hex[:8]}"
    media_uri = f"s3://{settings.s3_bucket_name}/{s3_key}"

    try:
        client.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={"MediaFileUri": media_uri},
            OutputBucketName=settings.transcribe_output_bucket,
            LanguageCode="en-US",
            Settings={
                "ShowSpeakerLabels": False,
                "ChannelIdentification": False,
            },
        )
        logger.info(
            "Started transcription job %s for source_doc %s",
            job_name,
            source_doc_id,
        )
    except Exception as exc:
        logger.error("Failed to start transcription job: %s", exc)
        raise

    return job_name


def get_transcription_status(job_name: str) -> dict[str, Any]:
    """Check the status of a transcription job.

    Returns:
        {"status": str, "transcript_uri": str | None}
        Status is one of: QUEUED, IN_PROGRESS, COMPLETED, FAILED.
    """
    client = _get_transcribe_client()

    try:
        response = client.get_transcription_job(
            TranscriptionJobName=job_name,
        )
        job = response["TranscriptionJob"]
        status = job["TranscriptionJobStatus"]
        transcript_uri = None

        if status == "COMPLETED":
            transcript_uri = job.get("Transcript", {}).get("TranscriptFileUri")

        return {"status": status, "transcript_uri": transcript_uri}
    except Exception as exc:
        logger.error("Failed to get transcription status for %s: %s", job_name, exc)
        return {"status": "UNKNOWN", "transcript_uri": None}


def get_transcript_text(job_name: str) -> str | None:
    """If the transcription is complete, fetch and return the transcript text.

    Returns:
        The plain text transcript, or None if not yet complete / on error.
    """
    status_info = get_transcription_status(job_name)

    if status_info["status"] != "COMPLETED":
        logger.info(
            "Transcription %s not complete (status=%s)", job_name, status_info["status"]
        )
        return None

    # The transcript JSON is stored in the output bucket with the job name as key
    s3 = _get_s3_client()
    transcript_key = f"{job_name}.json"

    try:
        response = s3.get_object(
            Bucket=settings.transcribe_output_bucket,
            Key=transcript_key,
        )
        transcript_data = json.loads(response["Body"].read().decode("utf-8"))

        # Amazon Transcribe JSON structure
        transcripts = transcript_data.get("results", {}).get("transcripts", [])
        if transcripts:
            return transcripts[0].get("transcript", "")

        return None
    except Exception as exc:
        logger.error("Failed to fetch transcript text for %s: %s", job_name, exc)
        return None
