"""Amazon Textract integration — async OCR for scanned/image PDFs."""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

import boto3

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_textract_client: Any = None
_s3_client: Any = None


def _get_textract_client() -> Any:
    """Lazy singleton for the Textract client."""
    global _textract_client
    if _textract_client is None:
        kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
        if settings.aws_access_key_id:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        _textract_client = boto3.client("textract", **kwargs)
    return _textract_client


def _get_s3_client() -> Any:
    """Lazy singleton for the S3 client (used to fetch Textract results)."""
    global _s3_client
    if _s3_client is None:
        kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
        if settings.aws_access_key_id:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        _s3_client = boto3.client("s3", **kwargs)
    return _s3_client


def detect_image_text_sync(image_bytes: bytes) -> str:
    """Synchronous text detection for single-page images (PNG/JPEG/TIFF).

    Uses the inline Bytes API (no S3 required). Supports images up to 10 MB.
    Extracts LINE blocks and joins them with newlines.
    """
    client = _get_textract_client()

    try:
        response = client.detect_document_text(Document={"Bytes": image_bytes})

        lines: list[str] = []
        for block in response.get("Blocks", []):
            if block["BlockType"] == "LINE":
                lines.append(block["Text"])

        text = "\n".join(lines)
        logger.info("Textract sync image OCR: extracted %d lines (%d chars)", len(lines), len(text))
        return text
    except Exception as exc:
        logger.error("Textract sync image OCR failed: %s", exc)
        raise


def start_text_detection(s3_key: str, source_doc_id: int) -> str:
    """Start an async Textract text detection job for a PDF in S3.

    Args:
        s3_key: The S3 object key of the PDF file.
        source_doc_id: The SourceDocument ID (used in the client request token).

    Returns:
        The Textract JobId.
    """
    client = _get_textract_client()

    try:
        response = client.start_document_text_detection(
            DocumentLocation={
                "S3Object": {
                    "Bucket": settings.s3_bucket_name,
                    "Name": s3_key,
                }
            },
            OutputConfig={
                "S3Bucket": settings.textract_output_bucket,
                "S3Prefix": f"textract/{source_doc_id}",
            },
            ClientRequestToken=f"axiom-{source_doc_id}-{uuid4().hex[:8]}",
        )
        job_id = response["JobId"]
        logger.info(
            "Started Textract text detection job %s for source_doc %s",
            job_id,
            source_doc_id,
        )
        return job_id
    except Exception as exc:
        logger.error("Failed to start Textract job: %s", exc)
        raise


def get_text_detection_status(job_id: str) -> dict[str, Any]:
    """Check the status of a Textract text detection job.

    Returns:
        {"status": str, "job_id": str}
        Status is one of: IN_PROGRESS, SUCCEEDED, FAILED, PARTIAL_SUCCESS.
    """
    client = _get_textract_client()

    try:
        response = client.get_document_text_detection(JobId=job_id, MaxResults=1)
        status = response["JobStatus"]
        return {"status": status, "job_id": job_id}
    except Exception as exc:
        logger.error("Failed to get Textract status for %s: %s", job_id, exc)
        return {"status": "UNKNOWN", "job_id": job_id}


def get_detected_text(job_id: str) -> str | None:
    """If the Textract job is complete, fetch and assemble the extracted text.

    Concatenates LINE blocks grouped by page, with double newlines between
    pages — matching the format that parse_pdf_to_text() produces.

    Handles pagination via NextToken for large documents.

    Returns:
        The extracted plain text, or None if not yet complete / on error.
    """
    client = _get_textract_client()

    try:
        pages_text: dict[int, list[str]] = {}
        next_token: str | None = None

        while True:
            kwargs: dict[str, Any] = {"JobId": job_id}
            if next_token:
                kwargs["NextToken"] = next_token

            response = client.get_document_text_detection(**kwargs)

            if response["JobStatus"] != "SUCCEEDED":
                logger.info(
                    "Textract %s not complete (status=%s)", job_id, response["JobStatus"]
                )
                return None

            for block in response.get("Blocks", []):
                if block["BlockType"] == "LINE":
                    page_num = block.get("Page", 1)
                    pages_text.setdefault(page_num, []).append(block["Text"])

            next_token = response.get("NextToken")
            if not next_token:
                break

        sorted_pages = sorted(pages_text.keys())
        page_strings = ["\n".join(pages_text[p]) for p in sorted_pages]
        return "\n\n".join(page_strings)

    except Exception as exc:
        logger.error("Failed to fetch Textract results for %s: %s", job_id, exc)
        return None
