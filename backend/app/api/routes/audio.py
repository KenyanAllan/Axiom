"""Audio endpoints — text-to-speech via Amazon Polly."""

from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.core.database import get_db
from app.models.tables import AtomicClaim, Topic
from app.services.s3 import generate_download_url

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/audio", tags=["audio"])


# ── Schemas ────────────────────────────────────────────────────────────────────


class SynthesizeRequest(BaseModel):
    text: str | None = Field(None, max_length=10000, description="Raw text to synthesize")
    claim_id: str | None = Field(None, description="Synthesize this claim's content instead")
    topic_id: str | None = Field(None, description="Synthesize all claims in this topic as one audio")


class SynthesizeResponse(BaseModel):
    audio_url: str
    s3_key: str
    duration_seconds: float | None = None
    text_length: int


class SpeechMarksResponse(BaseModel):
    marks: list[dict]
    text_length: int


# ── POST /api/audio/synthesize ─────────────────────────────────────────────


@router.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize(
    body: SynthesizeRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SynthesizeResponse:
    """Convert text to speech using Amazon Polly. Returns a presigned URL to the MP3.

    Provide one of: `text`, `claim_id`, or `topic_id`.
    """
    from app.services.polly import synthesize_speech

    text = await _resolve_text(body, db)

    output_key = f"audio/{uuid4().hex}.mp3"

    result = await asyncio.to_thread(synthesize_speech, text, output_key)

    audio_url = await asyncio.to_thread(
        _generate_polly_download_url, result["s3_key"]
    )

    return SynthesizeResponse(
        audio_url=audio_url,
        s3_key=result["s3_key"],
        duration_seconds=result.get("duration_seconds"),
        text_length=len(text),
    )


# ── POST /api/audio/speech-marks ───────────────────────────────────────────


@router.post("/speech-marks", response_model=SpeechMarksResponse)
async def speech_marks(
    body: SynthesizeRequest,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SpeechMarksResponse:
    """Generate word-level speech marks for text-audio synchronization.

    Returns timestamps (ms) for each word. Use alongside /synthesize
    to highlight words as audio plays.
    """
    from app.services.polly import generate_speech_marks

    text = await _resolve_text(body, db)

    marks = await asyncio.to_thread(generate_speech_marks, text)

    return SpeechMarksResponse(marks=marks, text_length=len(text))


# ── Helpers ────────────────────────────────────────────────────────────────────


async def _resolve_text(body: SynthesizeRequest, db: AsyncSession) -> str:
    """Resolve the text to synthesize from the request body."""
    if body.text:
        return body.text

    if body.claim_id:
        claim = await db.get(AtomicClaim, body.claim_id)
        if claim is None:
            raise HTTPException(status_code=404, detail=f"Claim '{body.claim_id}' not found")
        parts = []
        if claim.title:
            parts.append(claim.title + ".")
        if claim.content:
            parts.append(claim.content)
        return " ".join(parts)

    if body.topic_id:
        topic = await db.get(Topic, body.topic_id)
        if topic is None:
            raise HTTPException(status_code=404, detail=f"Topic '{body.topic_id}' not found")

        result = await db.execute(
            select(AtomicClaim)
            .where(AtomicClaim.topic_id == body.topic_id)
            .order_by(AtomicClaim.id)
        )
        claims = result.scalars().all()
        if not claims:
            raise HTTPException(status_code=400, detail="Topic has no claims to synthesize")

        parts = [f"{topic.title}."]
        if topic.summary:
            parts.append(topic.summary)
        for c in claims:
            parts.append(f"{c.title}. {c.content}")
        return " ".join(parts)

    raise HTTPException(status_code=400, detail="Provide one of: text, claim_id, or topic_id")


def _generate_polly_download_url(s3_key: str) -> str:
    """Generate a presigned GET URL from the Polly output bucket."""
    import boto3
    from app.core.config import get_settings

    settings = get_settings()
    kwargs = {"region_name": settings.aws_default_region}
    if settings.aws_access_key_id:
        kwargs["aws_access_key_id"] = settings.aws_access_key_id
        kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
    s3 = boto3.client("s3", **kwargs)

    return s3.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.polly_output_bucket,
            "Key": s3_key,
        },
        ExpiresIn=settings.s3_presigned_url_expiry,
    )
