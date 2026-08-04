"""Dictionary lookup, translation, normalize/serialize helpers.

Extracted from service.py (P1.3b). Cross-module and shared symbols
are resolved at runtime via the ``_svc`` handle so that route tests which
patch ``reading_service.X`` keep working.
"""

from __future__ import annotations

import json
import math
import re
from typing import (
    Any,
)

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.english_reading import EnglishReadingDictionaryCache
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    begin_external_ai_call_log,
    complete_external_ai_call_log,
    fail_external_ai_call_log,
)
from memory_anki.infrastructure.llm.openai_compatible import (
    OpenAICompatibleChatConfig,
)
from memory_anki.modules.english_reading.domain.errors import EnglishReadingError
from memory_anki.platform.application import AiRuntimeOptions

from . import service as _svc
from .ai_dependencies import EnglishReadingAiDependencies


def get_english_reading_runtime() -> _svc.EnglishReadingRuntime:
    return _svc._runtime


def prepare_english_reading_runtime(session: Session) -> dict[str, Any]:
    profile = _svc.ensure_profile_row(session)
    return {
        "profileId": profile.id,
        "declaredCefr": profile.declared_cefr,
        **_svc.ensure_english_reading_storage(),
    }


def translate_sentence_text(
    session: Session,
    *,
    ai_dependencies: EnglishReadingAiDependencies,
    text: str,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, str]:
    normalized_text = _svc.normalize_sentence_translation_text(text)
    if not normalized_text:
        raise EnglishReadingError("请先选中要翻译的英文句子。")
    if len(normalized_text) > _svc.SENTENCE_TRANSLATION_MAX_CHARS:
        raise EnglishReadingError(
            f"句子长度不能超过 {_svc.SENTENCE_TRANSLATION_MAX_CHARS} 个字符。"
        )
    if _svc.ASCII_LETTER_RE.search(normalized_text) is None:
        raise EnglishReadingError("请选择包含英文内容的句子。")
    runtime = ai_dependencies.runtime.resolve("translation", options=ai_options)
    if not runtime.api_key:
        raise EnglishReadingError("未配置翻译模型对应的 Provider API Key，无法翻译句子。")

    config = OpenAICompatibleChatConfig(
        api_key=runtime.api_key,
        base_url=runtime.base_url,
        model=runtime.model,
        temperature=0.0 if runtime.supports_temperature else None,
        timeout_seconds=60,
    )
    try:
        translated_text = _svc.call_chat_completion_text(
            config=config,
            messages=[{"role": "user", "content": normalized_text}],
            extra_payload={
                **(runtime.extra_payload or {}),
                "translation_options": {
                    "source_lang": "English",
                    "target_lang": "Chinese",
                }
            },
        )
    except Exception as exc:
        raise EnglishReadingError("句子翻译失败，请稍后重试。") from exc

    normalized_translation = _svc.normalize_sentence_translation_text(translated_text)
    if not normalized_translation:
        raise EnglishReadingError("句子翻译失败，请稍后重试。")
    return {
        "originalText": normalized_text,
        "translatedText": normalized_translation,
    }


def normalize_resolution_source(value: str) -> str:
    source = str(value or "").strip().lower()
    if source in {"dictionary", "exact", "lemma", "phrase_exact"}:
        return "dictionary"
    return "ai"


def call_json_completion(
    *,
    config: OpenAICompatibleChatConfig,
    prompt: str,
    extra_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "config": config,
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
    }
    if extra_payload is not None:
        kwargs["extra_payload"] = extra_payload
    response_text = _svc.call_chat_completion_text(**kwargs)
    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        match = _svc.JSON_BLOCK_RE.search(response_text)
        if not match:
            raise
        parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise EnglishReadingError("模型 JSON 返回结构无效。")
    return parsed


def call_json_completion_with_log(
    *,
    config: OpenAICompatibleChatConfig,
    prompt: str,
    extra_payload: dict[str, Any] | None = None,
    log_context: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], str]:
    kwargs: dict[str, Any] = {
        "config": config,
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"},
    }
    if extra_payload is not None:
        kwargs["extra_payload"] = extra_payload
    log_id = ""
    if log_context is not None:
        log_id = begin_external_ai_call_log(
            feature=str(log_context.get("feature") or "英语阅读"),
            operation=str(log_context.get("operation") or "json_completion"),
            provider="openai_compatible",
            base_url=config.base_url,
            model=config.model,
            request_payload={
                **(log_context.get("request_payload") or {}),
                "prompt": prompt,
                "response_format": {"type": "json_object"},
                "extra_payload": extra_payload or {},
            },
            job_id=str(log_context.get("job_id") or "") or None,
        )
    try:
        response_text = _svc.call_chat_completion_text(**kwargs)
        try:
            parsed = json.loads(response_text)
        except json.JSONDecodeError:
            match = _svc.JSON_BLOCK_RE.search(response_text)
            if not match:
                raise
            parsed = json.loads(match.group(0))
        if not isinstance(parsed, dict):
            raise EnglishReadingError("模型 JSON 返回结构无效。")
        if log_id:
            complete_external_ai_call_log(
                log_id,
                response_payload={
                    "response_text": response_text,
                    "parsed_json": parsed,
                },
            )
        return parsed, log_id
    except Exception as exc:
        if log_id:
            fail_external_ai_call_log(
                log_id,
                error_payload={
                    "error": str(exc),
                    "error_type": exc.__class__.__name__,
                },
            )
        raise


def upsert_dictionary_cache(
    session: Session,
    *,
    normalized_surfaces: set[str],
    payload: dict[str, Any],
) -> None:
    if not normalized_surfaces:
        return
    existing_rows = (
        session.query(EnglishReadingDictionaryCache)
        .filter(EnglishReadingDictionaryCache.normalized_surface.in_(tuple(normalized_surfaces)))
        .all()
    )
    existing_by_surface = {row.normalized_surface: row for row in existing_rows}
    for normalized_surface in normalized_surfaces:
        row = existing_by_surface.get(normalized_surface)
        if row is None:
            row = EnglishReadingDictionaryCache(normalized_surface=normalized_surface)
            session.add(row)
        row.entry_word = str(payload.get("word") or normalized_surface)
        row.lemma = str(payload.get("lemma") or normalized_surface)
        row.phonetic_us = str(payload.get("phoneticUs") or "")
        row.audio_us_url = str(payload.get("audioUsUrl") or "")
        row.summary_zh_json = json.dumps(payload.get("summaryZh") or [], ensure_ascii=False)
        row.parts_of_speech_json = json.dumps(payload.get("partsOfSpeech") or [], ensure_ascii=False)
        row.senses_json = json.dumps(payload.get("senses") or [], ensure_ascii=False)
        row.source = str(payload.get("source") or "dictionary")
        row.updated_at = utc_now_naive()
    session.commit()


def load_cached_dictionary_entry(session: Session, word: str) -> dict[str, Any] | None:
    normalized_surface = _svc.normalize_dictionary_query_word(word)
    if not normalized_surface:
        return None
    row = (
        session.query(EnglishReadingDictionaryCache)
        .filter_by(normalized_surface=normalized_surface)
        .first()
    )
    if row is None:
        return None
    return _svc.serialize_dictionary_cache_row(row)


def normalize_cefr_level(value: str) -> str:
    candidate = str(value or "").strip().upper()
    if candidate not in _svc.LEVEL_TO_INDEX:
        raise EnglishReadingError("CEFR 等级无效。")
    return candidate


def numeric_to_target_cefr(value: float) -> str:
    safe_value = _svc.clamp_numeric(value)
    return _svc.CEFR_LEVELS[min(len(_svc.CEFR_LEVELS) - 1, max(0, math.ceil(safe_value)))]


def default_lexical_value_for_level(level: str) -> float:
    return float(_svc.LEVEL_TO_INDEX[_svc.normalize_cefr_level(level)]) + 0.4


def default_syntactic_value_for_level(level: str) -> float:
    return float(_svc.LEVEL_TO_INDEX[_svc.normalize_cefr_level(level)]) + 0.25


def clamp_numeric(value: float) -> float:
    return min(float(len(_svc.CEFR_LEVELS) - 1), max(0.0, float(value)))


def normalize_dictionary_query_word(value: str) -> str:
    normalized = _svc.normalize_lookup_key(value)
    if not normalized:
        return ""
    if re.fullmatch(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", normalized) is None:
        return ""
    return normalized


def normalize_sentence_translation_text(value: str) -> str:
    return _svc.WHITESPACE_RE.sub(" ", str(value or "").strip())


def normalize_lookup_key(value: str) -> str:
    normalized = _svc.TOKEN_CONNECTOR_RE.sub("-", str(value or "").strip().lower())
    normalized = normalized.replace("’", "'").replace("–", "-").replace("—", "-")
    normalized = _svc.WHITESPACE_RE.sub(" ", normalized)
    return normalized.strip(" .,!?:;\"'()[]{}")


def serialize_float(value: float) -> str:
    return f"{float(value):.4f}"


def parse_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return float(default)


def normalize_feedback(value: str) -> str:
    candidate = str(value or "").strip()
    if candidate not in {"too_easy", "just_right", "too_hard"}:
        raise EnglishReadingError("阅读反馈无效。")
    return candidate


def serialize_dictionary_cache_row(row: EnglishReadingDictionaryCache) -> dict[str, Any]:
    try:
        summary_zh = json.loads(row.summary_zh_json or "[]")
    except json.JSONDecodeError:
        summary_zh = []
    try:
        parts_of_speech = json.loads(row.parts_of_speech_json or "[]")
    except json.JSONDecodeError:
        parts_of_speech = []
    try:
        senses = json.loads(row.senses_json or "[]")
    except json.JSONDecodeError:
        senses = []
    return {
        "word": row.entry_word or row.normalized_surface,
        "lemma": row.lemma or row.normalized_surface,
        "phoneticUs": row.phonetic_us or "",
        "audioUsUrl": row.audio_us_url or None,
        "summaryZh": summary_zh if isinstance(summary_zh, list) else [],
        "partsOfSpeech": parts_of_speech if isinstance(parts_of_speech, list) else [],
        "senses": senses if isinstance(senses, list) else [],
        "source": row.source or "dictionary",
        "cachedAt": row.updated_at.isoformat() if row.updated_at else None,
    }
