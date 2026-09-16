"""Amazon S3 service — presigned URLs for browser upload/download, object deletion."""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

import boto3

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_s3_client: Any = None


def _get_client() -> Any:
    """Lazy singleton for the S3 client."""
    global _s3_client
    if _s3_client is None:
        kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
        if settings.aws_access_key_id:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        _s3_client = boto3.client("s3", **kwargs)
    return _s3_client


def generate_upload_url(workspace_id: int, filename: str, content_type: str) -> dict:
    """Generate a presigned PUT URL for direct browser upload.

    Returns {"upload_url": str, "s3_key": str}.
    """
    s3_key = f"sources/{workspace_id}/{uuid4()}/{filename}"
    client = _get_client()

    upload_url = client.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_bucket_name,
            "Key": s3_key,
            "ContentType": content_type,
        },
        ExpiresIn=settings.s3_presigned_url_expiry,
    )

    logger.info("Generated presigned upload URL for key=%s", s3_key)
    return {"upload_url": upload_url, "s3_key": s3_key}


def generate_download_url(s3_key: str) -> str:
    """Generate a presigned GET URL for downloading a source document."""
    client = _get_client()

    download_url = client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.s3_bucket_name,
            "Key": s3_key,
        },
        ExpiresIn=settings.s3_presigned_url_expiry,
    )

    logger.info("Generated presigned download URL for key=%s", s3_key)
    return download_url


def delete_object(s3_key: str) -> None:
    """Delete an object from S3."""
    client = _get_client()

    client.delete_object(
        Bucket=settings.s3_bucket_name,
        Key=s3_key,
    )

    logger.info("Deleted S3 object key=%s", s3_key)
