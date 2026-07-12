from __future__ import annotations

import json
import math  # noqa: F401
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
import uuid  # noqa: F401
from collections import Counter  # noqa: F401
from dataclasses import dataclass, replace  # noqa: F401
from datetime import timedelta  # noqa: F401
from pathlib import Path
from typing import Any

import fitz  # noqa: F401
from sqlalchemy.orm import Session  # noqa: F401

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,  # noqa: F401
    DASHSCOPE_BASE_URL,  # noqa: F401
    DASHSCOPE_TEXT_MODEL,  # noqa: F401
    ENGLISH_READING_CEFR_PATH,
    ENGLISH_READING_DEFAULT_CEFR_SOURCE,
    ENGLISH_TRANSLATION_MODEL,  # noqa: F401
)
from memory_anki.core.time import utc_now_naive  # noqa: F401
from memory_anki.infrastructure.db._tables.english_reading import (
    EnglishReadingMaterial,  # noqa: F401
)
from memory_anki.infrastructure.llm.config_helpers import (
    has_non_empty_config as _has_non_empty_config,  # noqa: F401
)
from memory_anki.infrastructure.llm.external_ai_call_logs import (
    begin_external_ai_call_log,  # noqa: F401
    complete_external_ai_call_log,  # noqa: F401
    fail_external_ai_call_log,  # noqa: F401
)
from memory_anki.infrastructure.llm.openai_compatible import (
    OpenAICompatibleChatConfig,  # noqa: F401
    call_chat_completion_text,  # noqa: F401
)
from memory_anki.modules.english_reading.domain.errors import EnglishReadingError
from memory_anki.platform.application import AiRuntimeOptions  # noqa: F401

CEFR_LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
LEVEL_TO_INDEX = {level: index for index, level in enumerate(CEFR_LEVELS)}
WORD_RE = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*|\d+(?:\.\d+)?")
PAGE_NUMBER_RE = re.compile(r"^\s*(?:page\s+)?\d+\s*$", re.IGNORECASE)
TOKEN_CONNECTOR_RE = re.compile(r"\s*-\s*")
WHITESPACE_RE = re.compile(r"\s+")
JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)
CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
ASCII_LETTER_RE = re.compile(r"[A-Za-z]")
STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "but",
    "by",
    "for",
    "from",
    "if",
    "in",
    "into",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "their",
    "there",
    "this",
    "to",
    "was",
    "were",
    "with",
}
SUBORDINATE_MARKERS = {
    "although",
    "because",
    "despite",
    "if",
    "since",
    "that",
    "though",
    "unless",
    "when",
    "where",
    "which",
    "while",
    "who",
    "whose",
}
NOMINALIZATION_SUFFIXES = ("tion", "sion", "ment", "ness", "ity", "ance", "ence")
MAX_UNKNOWN_SURFACES_FOR_AI_CLASSIFICATION = 24
MAX_SENTENCE_AI_BATCH_ITEMS = 8
MAX_SENTENCE_AI_BATCH_CHARS = 4000
READING_GENERATION_TOTAL_STEPS = 8
READING_DIFFICULTY_BASE_DELTA = {
    "lexical": 0.45,
    "syntactic": 0.35,
}
READING_ALLOWED_DIFFICULTY_DELTAS = (0.5, 1.0, 1.5, 2.0)
READING_ALLOWED_DIFFICULTY_DIRECTIONS = {"easier", "same", "harder"}
XXAPI_DICTIONARY_API_URL = "https://v2.xxapi.cn/api/englishwords"
XXAPI_DICTIONARY_TIMEOUT_SECONDS = 4
SENTENCE_TRANSLATION_MAX_CHARS = 400


@dataclass(slots=True)
class EnglishReadingRuntime:
    cefr_source_path: Path | None = ENGLISH_READING_DEFAULT_CEFR_SOURCE


@dataclass(slots=True)
class LexiconState:
    source_path: Path
    modified_at: float
    exact_map: dict[str, str]
    max_phrase_words: int


@dataclass(slots=True)
class SurfaceResolution:
    normalized_surface: str
    cefr: str
    source: str
    lemma: str = ""
    base_phrase: str = ""
    explain_zh: str = ""
    confidence: float = 1.0


@dataclass(slots=True)
class SentenceSpan:
    surface: str
    normalized_surface: str
    start: int
    end: int
    token_count: int
    cefr: str | None = None
    cefr_value: float | None = None
    source: str = "unknown"
    lemma: str = ""
    base_phrase: str = ""
    explain_zh: str = ""


@dataclass(slots=True)
class SentenceState:
    text: str
    spans: list[SentenceSpan]
    estimated_syntax_value: float


_runtime = EnglishReadingRuntime()
_lexicon_state: LexiconState | None = None


def configure_english_reading_runtime(runtime: EnglishReadingRuntime) -> None:
    global _runtime
    _runtime = runtime


def ensure_english_reading_storage() -> dict[str, Any]:
    source_path = get_english_reading_runtime().cefr_source_path
    target_path = ENGLISH_READING_CEFR_PATH
    copied = False
    if source_path and source_path.exists():
        # Keep the managed copy aligned with the user's local CEFR source.
        source_mtime = source_path.stat().st_mtime
        target_mtime = target_path.stat().st_mtime if target_path.exists() else -1.0
        if not target_path.exists() or source_mtime > target_mtime:
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, target_path)
            copied = True
    global _lexicon_state
    _lexicon_state = None
    return {
        "targetPath": str(target_path),
        "exists": target_path.exists(),
        "copied": copied,
    }


def fetch_xxapi_dictionary_payload(word: str) -> dict[str, Any]:
    query = urllib.parse.urlencode({"word": word})
    request = urllib.request.Request(
        f"{XXAPI_DICTIONARY_API_URL}?{query}",
        method="GET",
        headers={
            "Accept": "application/json",
            "User-Agent": "MemoryAnki/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=XXAPI_DICTIONARY_TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise EnglishReadingError(f"未找到单词“{word}”的词典结果。") from exc
        raise EnglishReadingError("词典服务暂时不可用，请稍后重试。") from exc
    except urllib.error.URLError as exc:
        raise EnglishReadingError("词典服务暂时不可用，请稍后重试。") from exc
    except json.JSONDecodeError as exc:
        raise EnglishReadingError("词典服务返回了无法解析的数据。") from exc

    if not isinstance(payload, dict):
        raise EnglishReadingError("词典服务返回结构无效。")
    code = int(payload.get("code") or 0)
    if code != 200:
        message = str(payload.get("msg") or "").strip()
        if "未找到" in message:
            raise EnglishReadingError(f"未找到单词“{word}”的词典结果。")
        raise EnglishReadingError(message or "词典服务暂时不可用，请稍后重试。")
    data = payload.get("data")
    if not isinstance(data, dict):
        raise EnglishReadingError("词典服务返回结构无效。")
    return data


def load_lexicon_state() -> LexiconState:
    global _lexicon_state
    source_path = ENGLISH_READING_CEFR_PATH
    if not source_path.exists():
        raise EnglishReadingError(f"本地 CEFR 词典不存在：{source_path}")
    modified_at = source_path.stat().st_mtime
    if (
        _lexicon_state is not None
        and _lexicon_state.source_path == source_path
        and _lexicon_state.modified_at >= modified_at
    ):
        return _lexicon_state
    try:
        payload = json.loads(source_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EnglishReadingError("本地 CEFR 词典无法解析。") from exc
    if not isinstance(payload, list):
        raise EnglishReadingError("本地 CEFR 词典格式错误。")
    exact_map: dict[str, str] = {}
    max_phrase_words = 1
    for item in payload:
        if not isinstance(item, dict):
            continue
        raw_word = str(item.get("word") or "").strip()
        raw_levels = item.get("cefr")
        if not raw_word or not isinstance(raw_levels, list) or not raw_levels:
            continue
        normalized_key = normalize_lookup_key(raw_word)
        if not normalized_key:
            continue
        safe_levels = sorted(
            (normalize_cefr_level(level) for level in raw_levels if str(level).strip()),
            key=lambda level: LEVEL_TO_INDEX[level],
        )
        if not safe_levels:
            continue
        existing_level = exact_map.get(normalized_key)
        selected_level = safe_levels[0]
        if (
            existing_level is None
            or LEVEL_TO_INDEX[selected_level] < LEVEL_TO_INDEX[existing_level]
        ):
            exact_map[normalized_key] = selected_level
        max_phrase_words = max(max_phrase_words, len(normalized_key.split(" ")))
    _lexicon_state = LexiconState(
        source_path=source_path,
        modified_at=modified_at,
        exact_map=exact_map,
        max_phrase_words=max_phrase_words,
    )
    return _lexicon_state


# ---------------------------------------------------------------------
# Service split (P1.3b): the implementations of the functions below now
# live in material_service / version_service / session_service /
# lexicon_service / dictionary_service. They are re-exported here so that
# existing ``from ...application.service import X`` imports (router and
# route tests that patch ``reading_service.X``) keep resolving unchanged.
# Imported at module tail to avoid a circular import (sub-modules do
# ``from . import service as _svc``).
# ---------------------------------------------------------------------
from .material_service import (  # noqa: E402,F401,I001
    get_profile,
    get_workspace,
    update_profile,
    create_material,
    get_material,
    update_material,
    delete_material,
    get_material_version,
    list_recent_materials,
    get_reading_stats,
    get_reading_duration_seconds,
    get_total_reading_duration_seconds,
    resolve_material_source,
    extract_text_from_pdf,
    detect_repeated_pdf_edge_lines,
    join_pdf_lines,
    clean_material_text,
    derive_material_title,
    extract_visible_english_text,
    is_visible_english_paragraph,
    normalize_english_candidate,
    count_words,
    ensure_profile_row,
    get_material_row,
    serialize_profile,
    serialize_material,
)
from .version_service import (  # noqa: E402,F401,I001
    generate_material_version,
    generate_material_version_events,
    resolve_generation_working_values,
    normalize_generation_direction,
    normalize_generation_delta,
    complete_material,
    _build_generation_status,
    _consume_status_stream,
    build_reading_version_payload,
    build_reading_version_payload_stream,
    get_latest_version,
    resolve_session_version,
    serialize_version,
    serialize_session,
)
from .session_service import (  # noqa: E402,F401,I001
    plan_yellow_allocations,
    build_ai_sentence_tasks,
    build_sentence_state,
    match_phrase_span,
    render_sentence_locally,
    resolve_span_lemma,
    materialize_ai_rendered_parts,
    classify_original_span_render,
    chunk_sentence_tasks,
    generate_sentence_renders_with_ai,
    should_skip_ai_surface_resolution,
    choose_sentence_ai_adaptations,
    build_parts_from_annotations,
    split_into_paragraphs,
    split_paragraph_into_sentences,
    estimate_sentence_syntax_value,
    should_upgrade_span,
)
from .lexicon_service import (  # noqa: E402,F401,I001
    generate_surface_resolutions_with_ai,
    validate_ai_sentence_item,
    parse_ai_surface_items,
    find_local_candidate_match,
    build_annotation_from_rendered_part,
    texts_match_for_annotation,
    normalize_annotation_fragment,
    upsert_lexicon_cache,
    load_cached_surface_resolutions,
    apply_surface_resolution,
    resolve_surface_locally,
    resolve_key_in_lexicon,
    basic_lemma_candidates,
)
from .dictionary_service import (  # noqa: E402,F401,I001
    get_english_reading_runtime,
    prepare_english_reading_runtime,
    get_dictionary_entry,
    _resolve_legacy_dashscope_runtime,
    translate_sentence_text,
    build_xxapi_dictionary_entry_payload,
    normalize_dictionary_phonetic,
    normalize_resolution_source,
    call_json_completion,
    call_json_completion_with_log,
    upsert_dictionary_cache,
    load_cached_dictionary_entry,
    normalize_cefr_level,
    numeric_to_target_cefr,
    default_lexical_value_for_level,
    default_syntactic_value_for_level,
    clamp_numeric,
    normalize_dictionary_query_word,
    normalize_sentence_translation_text,
    normalize_lookup_key,
    serialize_float,
    parse_float,
    normalize_feedback,
    serialize_dictionary_cache_row,
)
from .vocabulary_service import (  # noqa: E402,F401,I001
    create_vocabulary_note,
    list_vocabulary_notes,
    review_vocabulary_note,
    serialize_vocabulary_note,
)
