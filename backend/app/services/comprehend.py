"""Amazon Comprehend integration — syntax analysis for difficulty estimation."""

from __future__ import annotations

import logging
import re
from typing import Any

import boto3
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_comprehend_client: Any = None


def _get_comprehend_client() -> Any:
    """Lazy singleton for the Comprehend client."""
    global _comprehend_client
    if _comprehend_client is None:
        kwargs: dict[str, Any] = {"region_name": settings.aws_default_region}
        if settings.aws_access_key_id:
            kwargs["aws_access_key_id"] = settings.aws_access_key_id
            kwargs["aws_secret_access_key"] = settings.aws_secret_access_key
        _comprehend_client = boto3.client("comprehend", **kwargs)
    return _comprehend_client


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def analyze_syntax(text: str, language_code: str = "en") -> dict:
    """Call Comprehend DetectSyntax. Max 5000 bytes — truncates if needed."""
    client = _get_comprehend_client()
    truncated = text.encode("utf-8")[:5000].decode("utf-8", errors="ignore")
    response = client.detect_syntax(Text=truncated, LanguageCode=language_code)
    tokens = response.get("SyntaxTokens", [])
    pos_tags = [t["PartOfSpeech"]["Tag"] for t in tokens if "PartOfSpeech" in t]
    return {"tokens": tokens, "pos_tags": pos_tags, "token_count": len(tokens)}


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def detect_key_phrases(text: str, language_code: str = "en") -> list[dict]:
    """Call Comprehend DetectKeyPhrases. Returns key phrases with confidence."""
    client = _get_comprehend_client()
    truncated = text.encode("utf-8")[:5000].decode("utf-8", errors="ignore")
    response = client.detect_key_phrases(Text=truncated, LanguageCode=language_code)
    return [
        {"text": kp["Text"], "confidence": round(kp["Score"], 3)}
        for kp in response.get("KeyPhrases", [])
    ]


RARE_POS_TAGS = {"SCONJ", "PART", "ADP", "CCONJ"}


def compute_complexity_score(text: str, language_code: str = "en") -> float:
    """Compute a 1.0-5.0 complexity score from multiple syntactic signals.

    Signals and weights:
      0.25 — average sentence length (words per sentence)
      0.20 — POS diversity (unique tags / total tokens)
      0.20 — noun phrase density (key phrases per sentence)
      0.20 — rare POS tag ratio (subordinating conjunctions, particles, etc.)
      0.15 — average word length (proxy for vocabulary sophistication)
    """
    if not text or len(text.strip()) < 10:
        return 3.0

    sentences = [s.strip() for s in re.split(r"[.!?]+", text) if s.strip()]
    if not sentences:
        return 3.0

    words = re.findall(r"\b[a-zA-Z]+\b", text)
    if not words:
        return 3.0

    avg_sentence_len = len(words) / len(sentences)
    avg_word_len = sum(len(w) for w in words) / len(words)

    try:
        syntax = analyze_syntax(text, language_code)
        pos_tags = syntax["pos_tags"]
        token_count = syntax["token_count"] or 1

        pos_diversity = len(set(pos_tags)) / token_count if token_count > 0 else 0
        rare_ratio = sum(1 for t in pos_tags if t in RARE_POS_TAGS) / token_count if token_count > 0 else 0
    except Exception:
        logger.warning("Comprehend syntax analysis failed, using text-only signals", exc_info=True)
        pos_diversity = 0.3
        rare_ratio = 0.1

    try:
        key_phrases = detect_key_phrases(text, language_code)
        np_density = len(key_phrases) / len(sentences) if sentences else 0
    except Exception:
        logger.warning("Comprehend key phrase detection failed", exc_info=True)
        np_density = 1.0

    def _normalize(value: float, low: float, high: float) -> float:
        """Map value from [low, high] to [0, 1], clamped."""
        if high <= low:
            return 0.5
        return max(0.0, min(1.0, (value - low) / (high - low)))

    sent_len_factor = _normalize(avg_sentence_len, 8, 30)
    pos_div_factor = _normalize(pos_diversity, 0.1, 0.6)
    np_density_factor = _normalize(np_density, 0.5, 4.0)
    rare_pos_factor = _normalize(rare_ratio, 0.0, 0.2)
    word_len_factor = _normalize(avg_word_len, 3.5, 8.0)

    raw = (
        0.25 * sent_len_factor
        + 0.20 * pos_div_factor
        + 0.20 * np_density_factor
        + 0.20 * rare_pos_factor
        + 0.15 * word_len_factor
    )

    score = 1.0 + raw * 4.0
    return round(max(1.0, min(5.0, score)), 1)
