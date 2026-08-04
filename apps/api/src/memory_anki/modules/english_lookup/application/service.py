"""Application services for standalone English lookup operations."""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor, wait
from typing import Any

from memory_anki.modules.english_lookup.application import (
    cambridge_engine,
    google_translate_engine,
    vocabulary_engine,
)
from memory_anki.modules.english_lookup.application.normalize import (
    is_valid_lookup_query,
    is_valid_translation_query,
    normalize_translation_query,
    validate_lookup_query,
)
from memory_anki.modules.english_lookup.domain.errors import EnglishLookupError

_ENGINE_TIMEOUT_SECONDS = 3.0


def translate_english_text(query: str) -> dict[str, Any]:
    normalized = normalize_translation_query(query)
    if not is_valid_translation_query(normalized):
        raise EnglishLookupError("请输入不超过 1000 个字符的待翻译内容。")
    return {"query": normalized, **google_translate_engine.search(normalized)}


def lookup_vocabulary(query: str) -> dict[str, Any]:
    normalized = _validate_dictionary_query(query)
    return _run_engine(vocabulary_engine.search, normalized, _vocabulary_timeout_result)


def lookup_cambridge(query: str) -> dict[str, Any]:
    normalized = _validate_dictionary_query(query)
    return _run_engine(cambridge_engine.search, normalized, _cambridge_timeout_result)


def _validate_dictionary_query(query: str) -> str:
    normalized, word_count = validate_lookup_query(query)
    if not is_valid_lookup_query(normalized, word_count):
        raise EnglishLookupError("词典查询仅支持 1–5 个英文词（连字符词算 1 个）。")
    return normalized


def _run_engine(
    engine: Callable[[str], dict[str, Any]],
    query: str,
    fallback: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        future = pool.submit(engine, query)
        wait((future,), timeout=_ENGINE_TIMEOUT_SECONDS)
        return _resolve_engine(future, fallback)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def _resolve_engine(
    future: Future[dict[str, Any]],
    fallback: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    if not future.done():
        return fallback()
    try:
        return future.result()
    except Exception:
        return fallback()


def _vocabulary_timeout_result() -> dict[str, Any]:
    return {
        "status": "error",
        "short": None,
        "long": None,
        "error": "Vocabulary.com 响应超时，请稍后重试。",
        "sourceUrl": None,
    }

def _cambridge_timeout_result() -> dict[str, Any]:
    return {
        "status": "error",
        "entries": [],
        "audio": {"us": None, "uk": None},
        "error": "Cambridge 响应超时，请稍后重试。",
        "sourceUrl": None,
    }
