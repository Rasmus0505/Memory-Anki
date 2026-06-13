from __future__ import annotations

import json
import math
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass, replace
from datetime import timedelta
from pathlib import Path
from typing import Any

import fitz
from sqlalchemy.orm import Session

from memory_anki.core.config import (
    DASHSCOPE_API_KEY,
    DASHSCOPE_BASE_URL,
    DASHSCOPE_TEXT_MODEL,
    ENGLISH_READING_CEFR_PATH,
    ENGLISH_READING_DEFAULT_CEFR_SOURCE,
    ENGLISH_TRANSLATION_MODEL,
)
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import (
    Config,
    EnglishReadingDictionaryCache,
    EnglishReadingLexiconCache,
    EnglishReadingMaterial,
    EnglishReadingProfile,
    EnglishReadingSession,
    EnglishReadingVersion,
    TimeRecord,
)
from memory_anki.infrastructure.llm.openai_compatible import (
    OpenAICompatibleChatConfig,
    call_chat_completion_text,
)
from memory_anki.modules.english_reading.domain.errors import EnglishReadingError
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
    resolve_scenario_runtime,
)
from memory_anki.modules.settings.application.ai_prompts import get_prompt_template
from memory_anki.modules.time_records.application.time_records_service import get_threshold_seconds

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
MAX_SENTENCE_AI_ADAPTATIONS = 1
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


def get_english_reading_runtime() -> EnglishReadingRuntime:
    return _runtime


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


def prepare_english_reading_runtime(session: Session) -> dict[str, Any]:
    profile = ensure_profile_row(session)
    return {
        "profileId": profile.id,
        "declaredCefr": profile.declared_cefr,
        **ensure_english_reading_storage(),
    }


def get_profile(session: Session) -> dict[str, Any]:
    return serialize_profile(ensure_profile_row(session))


def get_workspace(session: Session) -> dict[str, Any]:
    return {
        "profile": get_profile(session),
        "stats": get_reading_stats(session),
        "recentMaterials": list_recent_materials(session),
    }


def get_dictionary_entry(session: Session, *, word: str) -> dict[str, Any]:
    safe_word = normalize_dictionary_query_word(word)
    if not safe_word:
        raise EnglishReadingError("请提供要查询的英文单词。")
    cached_entry = load_cached_dictionary_entry(session, safe_word)
    if cached_entry is not None:
        return cached_entry

    candidate_words: list[str] = []
    seen_words: set[str] = set()
    for candidate in [safe_word, *basic_lemma_candidates(safe_word)]:
        normalized_candidate = normalize_dictionary_query_word(candidate)
        if not normalized_candidate or normalized_candidate in seen_words:
            continue
        seen_words.add(normalized_candidate)
        candidate_words.append(normalized_candidate)

    last_upstream_error: EnglishReadingError | None = None
    for candidate_word in candidate_words:
        try:
            payload = fetch_xxapi_dictionary_payload(candidate_word)
            entry_payload = build_xxapi_dictionary_entry_payload(
                payload,
                query_word=safe_word,
                requested_word=candidate_word,
            )
        except EnglishReadingError as exc:
            if "未找到单词" in str(exc):
                continue
            last_upstream_error = exc
            break

        if entry_payload is None:
            continue

        cache_keys = {safe_word}
        lemma_key = normalize_dictionary_query_word(str(entry_payload["lemma"] or ""))
        if lemma_key:
            cache_keys.add(lemma_key)
        upsert_dictionary_cache(
            session,
            normalized_surfaces=cache_keys,
            payload=entry_payload,
        )
        cached = load_cached_dictionary_entry(session, safe_word)
        if cached is not None:
            return cached
        return {
            **entry_payload,
            "cachedAt": utc_now_naive().isoformat(),
        }

    if last_upstream_error is not None:
        raise last_upstream_error
    raise EnglishReadingError(f"未找到单词“{safe_word}”的词典结果。")


def _has_non_empty_config(session: Session, key: str) -> bool:
    row = session.query(Config).filter_by(key=key).first()
    return bool(row and str(row.value or "").strip())


def _resolve_legacy_dashscope_runtime(
    session: Session,
    *,
    scenario_key: str,
    ai_options: AiRuntimeOptions | None,
    legacy_default_model: str,
):
    runtime = resolve_scenario_runtime(session, scenario_key, ai_options=ai_options)
    if runtime.provider != "dashscope":
        return runtime
    model = runtime.model
    if not (ai_options and ai_options.model) and not _has_non_empty_config(
        session, runtime.scenario.config_key
    ):
        model = str(legacy_default_model or runtime.model or "").strip()
    api_key = (
        runtime.api_key
        if _has_non_empty_config(session, "dashscope_api_key")
        else str(DASHSCOPE_API_KEY or "").strip()
    )
    base_url = (
        runtime.base_url
        if _has_non_empty_config(session, "dashscope_base_url")
        else str(DASHSCOPE_BASE_URL or runtime.base_url or "").strip()
    )
    return replace(
        runtime,
        model=model,
        api_key=api_key,
        base_url=base_url,
    )


def translate_sentence_text(
    session: Session,
    *,
    text: str,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, str]:
    normalized_text = normalize_sentence_translation_text(text)
    if not normalized_text:
        raise EnglishReadingError("请先选中要翻译的英文句子。")
    if len(normalized_text) > SENTENCE_TRANSLATION_MAX_CHARS:
        raise EnglishReadingError(
            f"句子长度不能超过 {SENTENCE_TRANSLATION_MAX_CHARS} 个字符。"
        )
    if ASCII_LETTER_RE.search(normalized_text) is None:
        raise EnglishReadingError("请选择包含英文内容的句子。")
    runtime = _resolve_legacy_dashscope_runtime(
        session,
        scenario_key="translation",
        ai_options=ai_options,
        legacy_default_model=ENGLISH_TRANSLATION_MODEL,
    )
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
        translated_text = call_chat_completion_text(
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

    normalized_translation = normalize_sentence_translation_text(translated_text)
    if not normalized_translation:
        raise EnglishReadingError("句子翻译失败，请稍后重试。")
    return {
        "originalText": normalized_text,
        "translatedText": normalized_translation,
    }


def update_profile(
    session: Session,
    *,
    declared_cefr: str,
) -> dict[str, Any]:
    safe_level = normalize_cefr_level(declared_cefr)
    profile = ensure_profile_row(session)
    if profile.declared_cefr != safe_level:
        profile.declared_cefr = safe_level
        profile.working_lexical_i = serialize_float(default_lexical_value_for_level(safe_level))
        profile.working_syntactic_i = serialize_float(default_syntactic_value_for_level(safe_level))
        profile.xp = 0
        profile.confidence = serialize_float(0.35)
        profile.easy_streak = 0
        profile.hard_streak = 0
        profile.updated_at = utc_now_naive()
        session.commit()
        session.refresh(profile)
    return serialize_profile(profile)


def create_material(
    session: Session,
    *,
    pasted_text: str,
    file_bytes: bytes | None,
    original_filename: str,
) -> dict[str, Any]:
    source_type, raw_text = resolve_material_source(
        pasted_text=pasted_text,
        file_bytes=file_bytes,
        original_filename=original_filename,
    )
    cleaned_text = clean_material_text(raw_text)
    if not cleaned_text.strip():
        raise EnglishReadingError("未提取到可阅读的正文内容。")
    material = EnglishReadingMaterial(
        title=derive_material_title(cleaned_text, original_filename=original_filename),
        source_type=source_type,
        original_filename=original_filename or "",
        original_text=raw_text,
        cleaned_text=cleaned_text,
        word_count=count_words(cleaned_text),
    )
    session.add(material)
    session.commit()
    session.refresh(material)
    return serialize_material(material)


def get_material(session: Session, material_id: int) -> dict[str, Any]:
    material = get_material_row(session, material_id)
    return serialize_material(material)


def update_material(
    session: Session,
    *,
    material_id: int,
    title: str,
) -> dict[str, Any]:
    material = get_material_row(session, material_id)
    safe_title = str(title or "").strip()
    if not safe_title:
        raise EnglishReadingError("阅读材料标题不能为空。")
    material.title = safe_title[:240]
    material.updated_at = utc_now_naive()
    session.commit()
    session.refresh(material)
    return serialize_material(material)


def delete_material(session: Session, material_id: int) -> dict[str, Any]:
    material = get_material_row(session, material_id)
    deleted_material_id = int(material.id)
    session.delete(material)
    session.commit()
    return {"deletedMaterialId": deleted_material_id}


def get_material_version(session: Session, material_id: int) -> dict[str, Any]:
    material = get_material_row(session, material_id)
    version = get_latest_version(material)
    if version is None:
        raise EnglishReadingError("当前材料还没有生成阅读版本。")
    return serialize_version(version)


def list_recent_materials(session: Session, limit: int = 12) -> list[dict[str, Any]]:
    safe_limit = max(1, min(50, int(limit)))
    materials = (
        session.query(EnglishReadingMaterial)
        .order_by(EnglishReadingMaterial.updated_at.desc(), EnglishReadingMaterial.id.desc())
        .limit(safe_limit)
        .all()
    )
    return [serialize_material(material) for material in materials]


def get_reading_stats(session: Session) -> dict[str, int]:
    total_materials = session.query(EnglishReadingMaterial).count()
    generated_materials = session.query(EnglishReadingVersion.material_id).distinct().count()
    completed_sessions = session.query(EnglishReadingSession).count()
    today_start = utc_now_naive().replace(hour=0, minute=0, second=0, microsecond=0)
    tomorrow_start = today_start.replace(day=today_start.day) + timedelta(days=1)
    week_start = today_start - timedelta(days=today_start.weekday())
    return {
        "totalMaterials": total_materials,
        "generatedMaterials": generated_materials,
        "completedSessions": completed_sessions,
        "todayReadingSeconds": get_reading_duration_seconds(
            session,
            start=today_start,
            end=tomorrow_start,
        ),
        "weeklyReadingSeconds": get_reading_duration_seconds(
            session,
            start=week_start,
            end=tomorrow_start,
        ),
        "totalReadingSeconds": get_total_reading_duration_seconds(session),
    }


def get_reading_duration_seconds(
    session: Session,
    *,
    start,
    end,
) -> int:
    threshold = get_threshold_seconds(session)
    records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.deleted_at.is_(None),
            TimeRecord.kind == "practice",
            TimeRecord.effective_seconds > threshold,
            TimeRecord.source_kind == "english_reading",
            TimeRecord.started_at >= start,
            TimeRecord.started_at < end,
        )
        .all()
    )
    return sum(int(record.effective_seconds or 0) for record in records)


def get_total_reading_duration_seconds(session: Session) -> int:
    threshold = get_threshold_seconds(session)
    records = (
        session.query(TimeRecord)
        .filter(
            TimeRecord.deleted_at.is_(None),
            TimeRecord.kind == "practice",
            TimeRecord.effective_seconds > threshold,
            TimeRecord.source_kind == "english_reading",
        )
        .all()
    )
    return sum(int(record.effective_seconds or 0) for record in records)


def generate_material_version(
    session: Session,
    *,
    material_id: int,
    mode: str = "initial",
    difficulty_direction: str | None = None,
    difficulty_delta: float | None = None,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    material = get_material_row(session, material_id)
    profile = ensure_profile_row(session)
    reading_text = extract_visible_english_text(material.cleaned_text)
    if not reading_text.strip():
        raise EnglishReadingError("当前材料没有可生成阅读结果的英文正文。")
    declared_cefr = normalize_cefr_level(profile.declared_cefr)
    working_lexical_i = parse_float(
        profile.working_lexical_i, default_lexical_value_for_level(declared_cefr)
    )
    working_syntactic_i = parse_float(
        profile.working_syntactic_i,
        default_syntactic_value_for_level(declared_cefr),
    )
    working_lexical_i, working_syntactic_i = resolve_generation_working_values(
        working_lexical_i=working_lexical_i,
        working_syntactic_i=working_syntactic_i,
        mode=mode,
        difficulty_direction=difficulty_direction,
        difficulty_delta=difficulty_delta,
    )
    target_lexical_i = clamp_numeric(working_lexical_i + 0.75)
    target_syntactic_i = clamp_numeric(working_syntactic_i + 0.65)
    target_cefr = numeric_to_target_cefr(target_lexical_i)
    render_payload = build_reading_version_payload(
        session,
        text=reading_text,
        declared_cefr=declared_cefr,
        working_lexical_i=working_lexical_i,
        working_syntactic_i=working_syntactic_i,
        target_lexical_i=target_lexical_i,
        target_syntactic_i=target_syntactic_i,
        total_word_count=max(1, count_words(reading_text)),
        ai_options=ai_options,
    )
    version = EnglishReadingVersion(
        material=material,
        declared_cefr=declared_cefr,
        working_lexical_i=serialize_float(working_lexical_i),
        working_syntactic_i=serialize_float(working_syntactic_i),
        target_cefr=target_cefr,
        target_lexical_i=serialize_float(target_lexical_i),
        target_syntactic_i=serialize_float(target_syntactic_i),
        render_blocks_json=json.dumps(render_payload["renderBlocks"], ensure_ascii=False),
        span_annotations_json=json.dumps(render_payload["spanAnnotations"], ensure_ascii=False),
        sentence_annotations_json=json.dumps(
            render_payload["sentenceAnnotations"], ensure_ascii=False
        ),
        summary_json=json.dumps(render_payload["summary"], ensure_ascii=False),
    )
    material.updated_at = utc_now_naive()
    session.add(version)
    session.commit()
    session.refresh(version)
    return serialize_version(version)


def resolve_generation_working_values(
    *,
    working_lexical_i: float,
    working_syntactic_i: float,
    mode: str,
    difficulty_direction: str | None,
    difficulty_delta: float | None,
) -> tuple[float, float]:
    safe_mode = str(mode or "initial").strip().lower()
    if safe_mode == "initial":
        return working_lexical_i, working_syntactic_i
    if safe_mode == "ease":
        difficulty_direction = "easier"
        difficulty_delta = 0.5
        safe_mode = "regenerate"
    if safe_mode != "regenerate":
        raise EnglishReadingError("不支持的生成模式。")

    safe_direction = normalize_generation_direction(difficulty_direction)
    if safe_direction == "same":
        return working_lexical_i, working_syntactic_i

    safe_delta = normalize_generation_delta(difficulty_delta)
    multiplier = safe_delta / 0.5
    lexical_offset = READING_DIFFICULTY_BASE_DELTA["lexical"] * multiplier
    syntactic_offset = READING_DIFFICULTY_BASE_DELTA["syntactic"] * multiplier
    direction_sign = -1 if safe_direction == "easier" else 1
    return (
        clamp_numeric(working_lexical_i + direction_sign * lexical_offset),
        clamp_numeric(working_syntactic_i + direction_sign * syntactic_offset),
    )


def normalize_generation_direction(direction: str | None) -> str:
    if direction is None or not str(direction).strip():
        return "same"
    safe_direction = str(direction).strip().lower()
    if safe_direction not in READING_ALLOWED_DIFFICULTY_DIRECTIONS:
        raise EnglishReadingError("难度方向仅支持 easier、same 或 harder。")
    return safe_direction


def normalize_generation_delta(delta: float | None) -> float:
    if delta is None:
        raise EnglishReadingError("请提供有效的难度变化幅度。")
    safe_delta = round(float(delta), 2)
    if safe_delta not in READING_ALLOWED_DIFFICULTY_DELTAS:
        raise EnglishReadingError("难度变化幅度仅支持 0.5、1.0、1.5 或 2.0。")
    return safe_delta


def complete_material(
    session: Session,
    *,
    material_id: int,
    version_id: int | None,
    feedback: str,
    duration_seconds: int,
    hover_count: int,
    expand_count: int,
) -> dict[str, Any]:
    material = get_material_row(session, material_id)
    version = resolve_session_version(material, version_id)
    profile = ensure_profile_row(session)
    safe_feedback = normalize_feedback(feedback)
    safe_duration = max(1, int(duration_seconds))
    safe_hover_count = max(0, int(hover_count))
    safe_expand_count = max(0, int(expand_count))
    words_per_minute = max(1, round(material.word_count / max(safe_duration / 60, 1 / 60)))
    xp_awarded = min(40, round(material.word_count / 35))
    if safe_feedback == "just_right":
        xp_awarded += 5
    elif safe_feedback == "too_easy":
        xp_awarded += 3

    declared_cefr = normalize_cefr_level(profile.declared_cefr)
    working_lexical_i = parse_float(
        profile.working_lexical_i, default_lexical_value_for_level(declared_cefr)
    )
    working_syntactic_i = parse_float(
        profile.working_syntactic_i,
        default_syntactic_value_for_level(declared_cefr),
    )
    confidence = parse_float(profile.confidence, 0.35)

    lexical_delta = 0.0
    syntactic_delta = 0.0
    confidence_delta = 0.0
    if safe_feedback == "too_easy":
        lexical_delta += 0.22
        syntactic_delta += 0.18
        confidence_delta += 0.08
        profile.easy_streak += 1
        profile.hard_streak = 0
    elif safe_feedback == "just_right":
        lexical_delta += 0.12
        syntactic_delta += 0.1
        confidence_delta += 0.05
        profile.easy_streak += 1
        profile.hard_streak = 0
    else:
        lexical_delta -= 0.18
        syntactic_delta -= 0.16
        confidence_delta -= 0.04
        profile.hard_streak += 1
        profile.easy_streak = 0

    if words_per_minute < 95:
        lexical_delta -= 0.05
    if safe_hover_count >= max(5, round(material.word_count / 45)):
        lexical_delta -= 0.03
    if safe_expand_count >= max(2, round(material.word_count / 120)):
        syntactic_delta -= 0.04

    next_working_lexical_i = clamp_numeric(working_lexical_i + lexical_delta)
    next_working_syntactic_i = clamp_numeric(working_syntactic_i + syntactic_delta)
    next_confidence = min(0.95, max(0.2, confidence + confidence_delta))

    profile.working_lexical_i = serialize_float(next_working_lexical_i)
    profile.working_syntactic_i = serialize_float(next_working_syntactic_i)
    profile.confidence = serialize_float(next_confidence)
    profile.xp = max(0, int(profile.xp) + xp_awarded)

    leveled_up = False
    if profile.xp >= 100 and next_confidence >= 0.55 and profile.easy_streak >= 2:
        current_index = LEVEL_TO_INDEX[declared_cefr]
        if current_index < len(CEFR_LEVELS) - 1:
            leveled_up = True
            profile.declared_cefr = CEFR_LEVELS[current_index + 1]
            profile.xp -= 100
            profile.confidence = serialize_float(max(0.35, next_confidence - 0.12))

    calibration = {
        "feedback": safe_feedback,
        "lexicalDelta": round(lexical_delta, 3),
        "syntacticDelta": round(syntactic_delta, 3),
        "confidenceDelta": round(confidence_delta, 3),
        "leveledUp": leveled_up,
        "nextDeclaredCefr": profile.declared_cefr,
    }
    reading_session = EnglishReadingSession(
        material=material,
        version=version,
        feedback=safe_feedback,
        duration_seconds=safe_duration,
        words_per_minute=words_per_minute,
        hover_count=safe_hover_count,
        expand_count=safe_expand_count,
        xp_awarded=xp_awarded,
        calibration_json=json.dumps(calibration, ensure_ascii=False),
    )
    material.updated_at = utc_now_naive()
    session.add(reading_session)
    session.commit()
    session.refresh(profile)
    session.refresh(reading_session)
    return {
        "material": serialize_material(material),
        "profile": serialize_profile(profile),
        "session": serialize_session(reading_session),
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


def build_xxapi_dictionary_entry_payload(
    payload: dict[str, Any],
    *,
    query_word: str,
    requested_word: str,
) -> dict[str, Any] | None:
    word = normalize_dictionary_query_word(str(payload.get("word") or requested_word or query_word))
    lemma = word or query_word
    translations = payload.get("translations")
    translation_items = translations if isinstance(translations, list) else []

    parts_of_speech: list[str] = []
    summary_zh: list[str] = []
    seen_summary_zh: set[str] = set()
    senses: list[dict[str, Any]] = []

    for item in translation_items:
        if not isinstance(item, dict):
            continue
        part_of_speech = str(item.get("pos") or "").strip() or "unknown"
        if part_of_speech not in parts_of_speech:
            parts_of_speech.append(part_of_speech)
        definition_zh = str(item.get("tran_cn") or "").strip()
        if definition_zh and definition_zh not in seen_summary_zh and len(summary_zh) < 3:
            seen_summary_zh.add(definition_zh)
            summary_zh.append(definition_zh)
        if not definition_zh:
            continue
        senses.append(
            {
                "partOfSpeech": part_of_speech,
                "definitionZh": definition_zh,
                "definition": "",
                "exampleZh": None,
                "example": None,
            }
        )

    if not lemma and not senses:
        return None

    return {
        "word": query_word,
        "lemma": lemma or query_word,
        "phoneticUs": normalize_dictionary_phonetic(str(payload.get("usphone") or "").strip()),
        "audioUsUrl": str(payload.get("usspeech") or "").strip() or None,
        "summaryZh": summary_zh,
        "partsOfSpeech": parts_of_speech,
        "senses": senses,
        "source": "xxapi",
    }


def normalize_dictionary_phonetic(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.startswith("/") and text.endswith("/"):
        return text
    return f"/{text.strip('/')}/"


def build_reading_version_payload(
    session: Session,
    *,
    text: str,
    declared_cefr: str,
    working_lexical_i: float,
    working_syntactic_i: float,
    target_lexical_i: float,
    target_syntactic_i: float,
    total_word_count: int,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    lexicon_state = load_lexicon_state()
    paragraph_sentences = [
        [sentence for sentence in split_paragraph_into_sentences(paragraph) if sentence.strip()]
        for paragraph in split_into_paragraphs(text)
    ]
    sentence_states: list[SentenceState] = []
    unresolved_surfaces: set[str] = set()
    still_unresolved: set[str] = set()
    pending_spans_by_surface: dict[str, list[SentenceSpan]] = {}
    for paragraph in paragraph_sentences:
        for sentence in paragraph:
            state = build_sentence_state(sentence, lexicon_state)
            sentence_states.append(state)
            for span in state.spans:
                if span.cefr is not None:
                    continue
                unresolved_surfaces.add(span.normalized_surface)
                pending_spans_by_surface.setdefault(span.normalized_surface, []).append(span)

    if unresolved_surfaces:
        cached_resolutions = load_cached_surface_resolutions(session, unresolved_surfaces)
        still_unresolved = set(unresolved_surfaces)
        for normalized_surface, resolution in cached_resolutions.items():
            apply_surface_resolution(
                pending_spans_by_surface.get(normalized_surface, []), resolution
            )
            still_unresolved.discard(normalized_surface)
    _, provisional_yellow_allocations = plan_yellow_allocations(
        sentence_states,
        total_word_count=total_word_count,
        working_lexical_i=working_lexical_i,
        target_lexical_i=target_lexical_i,
    )
    ai_adaptation_indices = choose_sentence_ai_adaptations(
        sentence_states,
        yellow_allocations=provisional_yellow_allocations,
        target_lexical_i=target_lexical_i,
        target_syntactic_i=target_syntactic_i,
    )
    sentence_tasks = build_ai_sentence_tasks(
        sentence_states,
        ai_indices=ai_adaptation_indices,
        yellow_allocations=provisional_yellow_allocations,
        working_lexical_i=working_lexical_i,
        target_lexical_i=target_lexical_i,
        target_syntactic_i=target_syntactic_i,
    )
    sentence_task_map = {task["sentenceId"]: task for task in sentence_tasks}
    ai_sentence_renders: dict[str, dict[str, Any]] = {}
    if sentence_tasks or still_unresolved:
        ai_result = generate_reading_assists_with_ai(
            session,
            lexicon_state=lexicon_state,
            unresolved_surfaces=still_unresolved,
            sentence_tasks=sentence_tasks,
            declared_cefr=declared_cefr,
            target_cefr=numeric_to_target_cefr(target_lexical_i),
            ai_options=ai_options,
        )
        ai_surface_resolutions = ai_result["surfaceResolutions"]
        if ai_surface_resolutions:
            for normalized_surface, resolution in ai_surface_resolutions.items():
                apply_surface_resolution(
                    pending_spans_by_surface.get(normalized_surface, []), resolution
                )
        ai_sentence_renders = ai_result["sentenceRenders"]

    _, yellow_allocations = plan_yellow_allocations(
        sentence_states,
        total_word_count=total_word_count,
        working_lexical_i=working_lexical_i,
        target_lexical_i=target_lexical_i,
    )

    render_blocks: list[dict[str, Any]] = []
    span_annotations: list[dict[str, Any]] = []
    sentence_annotations: list[dict[str, Any]] = []
    span_counter = 0
    sentence_counter = 0
    version_target_cefr = numeric_to_target_cefr(target_lexical_i)
    summary = {
        "wordCount": total_word_count,
        "greenCount": 0,
        "yellowCount": 0,
        "redCount": 0,
        "sentenceSimplifiedCount": 0,
        "workingLexicalI": round(working_lexical_i, 3),
        "workingSyntacticI": round(working_syntactic_i, 3),
        "targetLexicalI": round(target_lexical_i, 3),
        "targetSyntacticI": round(target_syntactic_i, 3),
        "targetCefr": version_target_cefr,
    }

    sentence_cursor = 0
    for paragraph in paragraph_sentences:
        paragraph_payload = {
            "id": f"paragraph-{len(render_blocks) + 1}",
            "sentences": [],
        }
        for _original_sentence in paragraph:
            state = sentence_states[sentence_cursor]
            sentence_cursor += 1
            green_spans = [
                span
                for span in state.spans
                if span.cefr_value is not None
                and working_lexical_i < span.cefr_value <= target_lexical_i
            ]
            red_spans = [
                span
                for span in state.spans
                if span.cefr_value is not None and span.cefr_value > target_lexical_i
            ]
            yellow_spans = yellow_allocations.get(sentence_cursor - 1, [])
            needs_syntax_simplification = state.estimated_syntax_value > target_syntactic_i + 0.2
            sentence_counter += 1
            sentence_id = f"sentence-{sentence_counter}"

            if red_spans or yellow_spans or needs_syntax_simplification:
                rendered = ai_sentence_renders.get(sentence_id)
                if rendered is None:
                    rendered = render_sentence_locally(
                        state.text,
                        green_spans=green_spans,
                        yellow_spans=yellow_spans,
                        red_spans=red_spans,
                        sentence_kind="unchanged",
                    )
            else:
                rendered = render_sentence_locally(
                    state.text,
                    green_spans=green_spans,
                    yellow_spans=[],
                    red_spans=[],
                    sentence_kind="unchanged",
                )

            candidate_spans = sentence_task_map.get(sentence_id, {}).get("candidateSpans", {})
            rendered_parts = rendered["parts"]
            if rendered.get("source") == "ai":
                rendered_parts = materialize_ai_rendered_parts(rendered_parts, candidate_spans)

            parts_payload: list[dict[str, Any]] = []
            for part in rendered_parts:
                annotation = build_annotation_from_rendered_part(part)
                if annotation is None:
                    parts_payload.append({"text": str(part.get("text") or "")})
                    continue
                span_counter += 1
                annotation_id = f"span-{span_counter}"
                annotation["id"] = annotation_id
                span_annotations.append(annotation)
                parts_payload.append(
                    {
                        "text": str(part.get("text") or ""),
                        "spanAnnotationId": annotation_id,
                    }
                )
                summary[f"{annotation['kind']}Count"] += max(
                    1, count_words(annotation["displayText"])
                )

            sentence_annotation = rendered["sentenceAnnotation"]
            sentence_annotation_id = f"{sentence_id}-annotation"
            sentence_annotations.append(
                {
                    "id": sentence_annotation_id,
                    "kind": sentence_annotation["kind"],
                    "originalText": sentence_annotation["originalText"],
                    "displayText": sentence_annotation["displayText"],
                    "skeletonHints": sentence_annotation["skeletonHints"],
                }
            )
            if sentence_annotation["kind"] == "syntax_simplified":
                summary["sentenceSimplifiedCount"] += 1
            paragraph_payload["sentences"].append(
                {
                    "id": sentence_id,
                    "parts": parts_payload,
                    "sentenceAnnotationId": sentence_annotation_id,
                    "displayText": "".join(part["text"] for part in parts_payload),
                }
            )
        render_blocks.append(paragraph_payload)

    comfort_count = max(
        0, total_word_count - summary["greenCount"] - summary["yellowCount"] - summary["redCount"]
    )
    summary["comfortCount"] = comfort_count
    summary["growthCount"] = summary["greenCount"] + summary["yellowCount"]
    return {
        "renderBlocks": render_blocks,
        "spanAnnotations": span_annotations,
        "sentenceAnnotations": sentence_annotations,
        "summary": summary,
    }


def plan_yellow_allocations(
    sentence_states: list[SentenceState],
    *,
    total_word_count: int,
    working_lexical_i: float,
    target_lexical_i: float,
) -> tuple[int, dict[int, list[SentenceSpan]]]:
    natural_green_count = 0
    yellow_candidates: list[tuple[int, SentenceSpan]] = []
    seen_yellow_surfaces: set[str] = set()
    for sentence_index, state in enumerate(sentence_states):
        for span in state.spans:
            if span.cefr_value is None:
                continue
            if working_lexical_i < span.cefr_value <= target_lexical_i:
                natural_green_count += max(1, span.token_count)
            if (
                span.cefr_value <= max(0.0, working_lexical_i - 0.75)
                and span.normalized_surface not in seen_yellow_surfaces
                and should_upgrade_span(span)
            ):
                yellow_candidates.append((sentence_index, span))
                seen_yellow_surfaces.add(span.normalized_surface)
    target_growth_count = max(3, min(24, round(total_word_count * 0.12)))
    yellow_budget = max(0, min(12, target_growth_count - natural_green_count))
    yellow_allocations: dict[int, list[SentenceSpan]] = {}
    for sentence_index, span in yellow_candidates[:yellow_budget]:
        yellow_allocations.setdefault(sentence_index, []).append(span)
    return natural_green_count, yellow_allocations


def build_ai_sentence_tasks(
    sentence_states: list[SentenceState],
    *,
    ai_indices: set[int],
    yellow_allocations: dict[int, list[SentenceSpan]],
    working_lexical_i: float,
    target_lexical_i: float,
    target_syntactic_i: float,
) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    for sentence_index in sorted(ai_indices):
        state = sentence_states[sentence_index]
        green_spans = [
            span
            for span in state.spans
            if span.cefr_value is not None
            and working_lexical_i < span.cefr_value <= target_lexical_i
        ]
        red_spans = [
            span
            for span in state.spans
            if span.cefr_value is not None and span.cefr_value > target_lexical_i
        ]
        yellow_spans = yellow_allocations.get(sentence_index, [])
        unresolved_spans = [span for span in state.spans if span.cefr_value is None]
        needs_syntax_simplification = state.estimated_syntax_value > target_syntactic_i + 0.2
        candidate_counter = 0
        candidate_payloads: list[dict[str, Any]] = []
        candidate_spans: dict[str, SentenceSpan] = {}
        for kind, spans in (
            ("green", green_spans),
            ("yellow", yellow_spans),
            ("red", red_spans),
            ("unknown", unresolved_spans),
        ):
            for span in spans:
                candidate_counter += 1
                candidate_id = f"{kind[0]}{candidate_counter}"
                candidate_spans[candidate_id] = span
                candidate_payloads.append(
                    {
                        "candidateId": candidate_id,
                        "kind": kind,
                        "text": span.surface,
                        "cefr": span.cefr or "",
                        "resolvedLemma": span.lemma or span.base_phrase or "",
                    }
                )
        tasks.append(
            {
                "sentenceId": f"sentence-{sentence_index + 1}",
                "sentence": state.text,
                "needsSyntaxSimplification": needs_syntax_simplification,
                "candidates": candidate_payloads,
                "candidateSpans": candidate_spans,
            }
        )
    return tasks


def build_sentence_state(text: str, lexicon_state: LexiconState) -> SentenceState:
    word_matches = list(WORD_RE.finditer(text))
    spans: list[SentenceSpan] = []
    token_index = 0
    while token_index < len(word_matches):
        matched_phrase = match_phrase_span(text, word_matches, token_index, lexicon_state)
        if matched_phrase is not None:
            spans.append(matched_phrase["span"])
            token_index += matched_phrase["consumed"]
            continue
        match = word_matches[token_index]
        surface = match.group(0)
        local_resolution = resolve_surface_locally(surface, lexicon_state)
        if local_resolution is None:
            spans.append(
                SentenceSpan(
                    surface=surface,
                    normalized_surface=normalize_lookup_key(surface),
                    start=match.start(),
                    end=match.end(),
                    token_count=1,
                )
            )
        else:
            spans.append(
                SentenceSpan(
                    surface=surface,
                    normalized_surface=local_resolution.normalized_surface,
                    start=match.start(),
                    end=match.end(),
                    token_count=1,
                    cefr=local_resolution.cefr,
                    cefr_value=float(LEVEL_TO_INDEX[local_resolution.cefr]),
                    source=local_resolution.source,
                    lemma=local_resolution.lemma,
                    base_phrase=local_resolution.base_phrase,
                    explain_zh=local_resolution.explain_zh,
                )
            )
        token_index += 1
    return SentenceState(
        text=text,
        spans=spans,
        estimated_syntax_value=estimate_sentence_syntax_value(text),
    )


def match_phrase_span(
    text: str,
    word_matches: list[re.Match[str]],
    token_index: int,
    lexicon_state: LexiconState,
) -> dict[str, Any] | None:
    max_size = min(lexicon_state.max_phrase_words, len(word_matches) - token_index)
    for phrase_size in range(max_size, 1, -1):
        raw_phrase = " ".join(
            word_matches[token_index + offset].group(0) for offset in range(phrase_size)
        )
        normalized_phrase = normalize_lookup_key(raw_phrase)
        cefr = lexicon_state.exact_map.get(normalized_phrase)
        if not cefr:
            continue
        start = word_matches[token_index].start()
        end = word_matches[token_index + phrase_size - 1].end()
        return {
            "consumed": phrase_size,
            "span": SentenceSpan(
                surface=text[start:end],
                normalized_surface=normalized_phrase,
                start=start,
                end=end,
                token_count=phrase_size,
                cefr=cefr,
                cefr_value=float(LEVEL_TO_INDEX[cefr]),
                source="phrase_exact",
                base_phrase=normalized_phrase,
                explain_zh="Recognized locally as a fixed expression.",
            ),
        }
    return None


def render_sentence_locally(
    sentence_text: str,
    *,
    green_spans: list[SentenceSpan],
    yellow_spans: list[SentenceSpan],
    red_spans: list[SentenceSpan],
    sentence_kind: str,
) -> dict[str, Any]:
    annotations: list[dict[str, Any]] = []
    for span in green_spans:
        annotations.append(
            {
                "start": span.start,
                "end": span.end,
                "kind": "green",
                "originalText": span.surface,
                "displayText": span.surface,
                "cefr": span.cefr or "",
                "resolvedLemma": resolve_span_lemma(span),
                "resolutionSource": normalize_resolution_source(span.source),
            }
        )
    del yellow_spans, red_spans
    parts = build_parts_from_annotations(sentence_text, annotations)
    return {
        "parts": parts,
        "sentenceAnnotation": {
            "kind": sentence_kind,
            "originalText": sentence_text,
            "displayText": sentence_text,
            "skeletonHints": [],
        },
    }


def resolve_span_lemma(span: SentenceSpan) -> str:
    return str(span.lemma or span.base_phrase or "").strip()


def normalize_resolution_source(value: str) -> str:
    source = str(value or "").strip().lower()
    if source in {"dictionary", "exact", "lemma", "phrase_exact"}:
        return "dictionary"
    return "ai"


def materialize_ai_rendered_parts(
    parts: list[dict[str, Any]],
    candidate_spans: dict[str, SentenceSpan],
) -> list[dict[str, Any]]:
    materialized: list[dict[str, Any]] = []
    for part in parts:
        text = str(part.get("text") or "")
        if not text:
            continue
        kind = str(part.get("kind") or "").strip()
        candidate_id = str(part.get("candidateId") or "").strip()
        candidate_span = candidate_spans.get(candidate_id)
        if (
            kind not in {"green", "yellow", "red"}
            or candidate_span is None
            or candidate_span.cefr is None
        ):
            materialized.append({"text": text})
            continue
        if kind == "green" and not texts_match_for_annotation(text, candidate_span.surface):
            materialized.append({"text": text})
            continue
        if kind in {"yellow", "red"} and texts_match_for_annotation(text, candidate_span.surface):
            materialized.append({"text": text})
            continue
        materialized.append(
            {
                "text": text,
                "kind": kind,
                "originalText": candidate_span.surface,
                "displayText": text,
                "cefr": candidate_span.cefr or "",
                "resolvedLemma": resolve_span_lemma(candidate_span),
                "resolutionSource": normalize_resolution_source(candidate_span.source),
            }
        )
    return materialized


def generate_reading_assists_with_ai(
    session: Session,
    *,
    lexicon_state: LexiconState,
    unresolved_surfaces: set[str],
    sentence_tasks: list[dict[str, Any]],
    declared_cefr: str,
    target_cefr: str,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    runtime = _resolve_legacy_dashscope_runtime(
        session,
        scenario_key="english_reading",
        ai_options=ai_options,
        legacy_default_model=DASHSCOPE_TEXT_MODEL,
    )
    if not runtime.api_key:
        return {"surfaceResolutions": {}, "sentenceRenders": {}}
    requested_surfaces = sorted(surface for surface in unresolved_surfaces if surface)
    if should_skip_ai_surface_resolution(set(requested_surfaces)):
        requested_surfaces = []
    if not requested_surfaces and not sentence_tasks:
        return {"surfaceResolutions": {}, "sentenceRenders": {}}
    config = OpenAICompatibleChatConfig(
        api_key=runtime.api_key,
        base_url=runtime.base_url,
        model=runtime.model,
        temperature=0.1 if runtime.supports_temperature else None,
        timeout_seconds=90,
    )
    prompt_payload = {
        "declared_cefr": declared_cefr,
        "target_cefr": target_cefr,
        "unknown_surfaces": requested_surfaces,
        "sentence_tasks": [
            {
                "sentenceId": task["sentenceId"],
                "sentence": task["sentence"],
                "needsSyntaxSimplification": bool(task["needsSyntaxSimplification"]),
                "candidates": task["candidates"],
            }
            for task in sentence_tasks
        ],
    }
    base_prompt = get_prompt_template(session, "ai_prompt_english_reading_generate")
    prompt = f"{base_prompt}\n\n输入数据：{json.dumps(prompt_payload, ensure_ascii=False)}"
    try:
        payload = call_json_completion(
            config=config,
            prompt=prompt,
            extra_payload=runtime.extra_payload,
        )
    except Exception:
        return {"surfaceResolutions": {}, "sentenceRenders": {}}
    surface_resolutions = parse_ai_surface_items(
        payload.get("surfaceItems"),
        requested_surfaces=requested_surfaces,
        lexicon_state=lexicon_state,
    )
    if surface_resolutions:
        upsert_lexicon_cache(session, surface_resolutions)
    sentence_renders: dict[str, dict[str, Any]] = {}
    requested_sentence_ids = {str(task["sentenceId"]) for task in sentence_tasks}
    raw_sentence_items = payload.get("sentenceItems")
    if isinstance(raw_sentence_items, list):
        for item in raw_sentence_items:
            rendered = validate_ai_sentence_item(item)
            if rendered is None:
                continue
            sentence_id = str(rendered.get("sentenceId") or "")
            if sentence_id not in requested_sentence_ids:
                continue
            sentence_renders[sentence_id] = rendered
    return {
        "surfaceResolutions": surface_resolutions,
        "sentenceRenders": sentence_renders,
    }


def validate_ai_sentence_item(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    sentence_id = str(item.get("sentenceId") or "").strip()
    if not sentence_id:
        return None
    raw_parts = item.get("parts")
    if not isinstance(raw_parts, list) or not raw_parts:
        return None
    parts: list[dict[str, Any]] = []
    for raw_part in raw_parts:
        if not isinstance(raw_part, dict):
            continue
        text = str(raw_part.get("text") or "")
        if not text:
            continue
        kind = str(raw_part.get("kind") or "").strip()
        candidate_id = str(raw_part.get("candidateId") or "").strip()
        if kind not in {"green", "yellow", "red"}:
            parts.append({"text": text})
            continue
        part: dict[str, Any] = {
            "text": text,
            "kind": kind,
        }
        if candidate_id:
            part["candidateId"] = candidate_id
        parts.append(part)
    if not parts:
        return None
    display_text = "".join(part["text"] for part in parts).strip()
    sentence_annotation = item.get("sentenceAnnotation")
    if not isinstance(sentence_annotation, dict):
        sentence_annotation = {}
    kind = str(sentence_annotation.get("kind") or "unchanged").strip()
    if kind not in {"unchanged", "syntax_simplified"}:
        kind = "unchanged"
    raw_hints = sentence_annotation.get("skeletonHints")
    skeleton_hints = (
        [str(hint).strip() for hint in raw_hints if str(hint).strip()][:4]
        if isinstance(raw_hints, list)
        else []
    )
    return {
        "source": "ai",
        "sentenceId": sentence_id,
        "parts": parts,
        "sentenceAnnotation": {
            "kind": kind,
            "originalText": str(
                sentence_annotation.get("originalText") or item.get("sentence") or ""
            ),
            "displayText": str(sentence_annotation.get("displayText") or display_text),
            "skeletonHints": skeleton_hints,
        },
    }


def parse_ai_surface_items(
    raw_items: Any,
    *,
    requested_surfaces: list[str],
    lexicon_state: LexiconState,
) -> dict[str, SurfaceResolution]:
    if not isinstance(raw_items, list) or not requested_surfaces:
        return {}
    requested_set = set(requested_surfaces)
    resolved: dict[str, SurfaceResolution] = {}
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        surface = normalize_lookup_key(str(item.get("surface") or ""))
        if surface not in requested_set or not surface:
            continue
        raw_candidates = item.get("candidates")
        candidates: list[str] = []
        if isinstance(raw_candidates, list):
            for candidate in raw_candidates:
                normalized_candidate = normalize_lookup_key(str(candidate or ""))
                if normalized_candidate and normalized_candidate not in candidates:
                    candidates.append(normalized_candidate)
                if len(candidates) >= 3:
                    break
        local_match = find_local_candidate_match(candidates, lexicon_state)
        confidence = max(0.0, min(1.0, parse_float(item.get("confidence"), 0.75)))
        note = str(item.get("note") or "").strip()
        if local_match is not None:
            resolved[surface] = SurfaceResolution(
                normalized_surface=surface,
                cefr=local_match["cefr"],
                source="dictionary",
                lemma=local_match["candidate"],
                base_phrase=local_match["candidate"],
                explain_zh=note or "Matched local dictionary after AI candidate expansion.",
                confidence=confidence,
            )
            continue
        raw_cefr = str(item.get("cefr") or "").strip()
        try:
            safe_cefr = normalize_cefr_level(raw_cefr)
        except EnglishReadingError:
            continue
        best_candidate = candidates[0] if candidates else surface
        resolved[surface] = SurfaceResolution(
            normalized_surface=surface,
            cefr=safe_cefr,
            source="ai",
            lemma=best_candidate,
            base_phrase=best_candidate,
            explain_zh=note or "Used AI CEFR because no local dictionary match was found.",
            confidence=confidence,
        )
    return resolved


def find_local_candidate_match(
    candidates: list[str],
    lexicon_state: LexiconState,
) -> dict[str, str] | None:
    for candidate in candidates:
        cefr = resolve_key_in_lexicon(candidate, lexicon_state)
        if cefr is not None:
            return {
                "candidate": candidate,
                "cefr": cefr,
            }
    return None


def build_annotation_from_rendered_part(
    part: dict[str, Any],
) -> dict[str, Any] | None:
    kind = str(part.get("kind") or "").strip()
    if kind not in {"green", "yellow", "red"}:
        return None
    text = str(part.get("text") or "")
    original_text = str(part.get("originalText") or "")
    display_text = str(part.get("displayText") or text)
    cefr = str(part.get("cefr") or "")
    if not original_text or not display_text or not cefr:
        return None
    if kind == "green" and not texts_match_for_annotation(display_text, original_text):
        return None
    if kind in {"yellow", "red"} and texts_match_for_annotation(display_text, original_text):
        return None
    return {
        "kind": kind,
        "originalText": original_text,
        "displayText": display_text,
        "cefr": cefr,
        "resolvedLemma": str(part.get("resolvedLemma") or ""),
        "resolutionSource": normalize_resolution_source(str(part.get("resolutionSource") or "")),
    }


def texts_match_for_annotation(left: str, right: str) -> bool:
    return normalize_annotation_fragment(left) == normalize_annotation_fragment(right)


def normalize_annotation_fragment(value: str) -> str:
    return WHITESPACE_RE.sub(" ", str(value or "")).strip()


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
    response_text = call_chat_completion_text(**kwargs)
    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        match = JSON_BLOCK_RE.search(response_text)
        if not match:
            raise
        parsed = json.loads(match.group(0))
    if not isinstance(parsed, dict):
        raise EnglishReadingError("模型 JSON 返回结构无效。")
    return parsed


def should_skip_ai_surface_resolution(surfaces: set[str]) -> bool:
    return len(surfaces) > MAX_UNKNOWN_SURFACES_FOR_AI_CLASSIFICATION


def choose_sentence_ai_adaptations(
    sentence_states: list[SentenceState],
    *,
    yellow_allocations: dict[int, list[SentenceSpan]],
    target_lexical_i: float,
    target_syntactic_i: float,
) -> set[int]:
    ranked_candidates: list[tuple[float, int]] = []
    for sentence_index, state in enumerate(sentence_states):
        red_spans = [
            span
            for span in state.spans
            if span.cefr_value is not None and span.cefr_value > target_lexical_i
        ]
        yellow_spans = yellow_allocations.get(sentence_index, [])
        unresolved_spans = [span for span in state.spans if span.cefr_value is None]
        needs_syntax_simplification = state.estimated_syntax_value > target_syntactic_i + 0.2
        if (
            not red_spans
            and not yellow_spans
            and not needs_syntax_simplification
            and not unresolved_spans
        ):
            continue
        score = 0.0
        if needs_syntax_simplification:
            score += 100.0
        score += sum((span.cefr_value or target_lexical_i) - target_lexical_i for span in red_spans)
        score += len(red_spans) * 3.0
        score += len(yellow_spans) * 1.5
        score += len(unresolved_spans) * 1.25
        score += min(2.0, max(0.0, count_words(state.text) - 12) * 0.08)
        ranked_candidates.append((score, sentence_index))
    ranked_candidates.sort(reverse=True)
    return {sentence_index for _, sentence_index in ranked_candidates[:MAX_SENTENCE_AI_ADAPTATIONS]}


def upsert_lexicon_cache(
    session: Session,
    items: dict[str, SurfaceResolution],
) -> None:
    if not items:
        return
    existing_rows = (
        session.query(EnglishReadingLexiconCache)
        .filter(EnglishReadingLexiconCache.normalized_surface.in_(tuple(items.keys())))
        .all()
    )
    existing_by_surface = {row.normalized_surface: row for row in existing_rows}
    for normalized_surface, resolution in items.items():
        row = existing_by_surface.get(normalized_surface)
        if row is None:
            row = EnglishReadingLexiconCache(normalized_surface=normalized_surface)
            session.add(row)
        row.lemma = resolution.lemma
        row.base_phrase = resolution.base_phrase
        row.cefr = resolution.cefr
        row.confidence = serialize_float(resolution.confidence)
        row.explain_zh = resolution.explain_zh
        row.source = resolution.source
        row.updated_at = utc_now_naive()
    session.commit()


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
        row.source = str(payload.get("source") or "xxapi")
        row.updated_at = utc_now_naive()
    session.commit()


def load_cached_dictionary_entry(session: Session, word: str) -> dict[str, Any] | None:
    normalized_surface = normalize_dictionary_query_word(word)
    if not normalized_surface:
        return None
    row = (
        session.query(EnglishReadingDictionaryCache)
        .filter_by(normalized_surface=normalized_surface)
        .first()
    )
    if row is None:
        return None
    return serialize_dictionary_cache_row(row)


def load_cached_surface_resolutions(
    session: Session,
    normalized_surfaces: set[str],
) -> dict[str, SurfaceResolution]:
    if not normalized_surfaces:
        return {}
    rows = (
        session.query(EnglishReadingLexiconCache)
        .filter(EnglishReadingLexiconCache.normalized_surface.in_(tuple(normalized_surfaces)))
        .all()
    )
    return {
        row.normalized_surface: SurfaceResolution(
            normalized_surface=row.normalized_surface,
            cefr=normalize_cefr_level(row.cefr),
            source=row.source or "cache",
            lemma=row.lemma or "",
            base_phrase=row.base_phrase or "",
            explain_zh=row.explain_zh or "",
            confidence=parse_float(row.confidence, 0.75),
        )
        for row in rows
    }


def apply_surface_resolution(spans: list[SentenceSpan], resolution: SurfaceResolution) -> None:
    for span in spans:
        span.cefr = resolution.cefr
        span.cefr_value = float(LEVEL_TO_INDEX[resolution.cefr])
        span.source = resolution.source
        span.lemma = resolution.lemma
        span.base_phrase = resolution.base_phrase
        span.explain_zh = resolution.explain_zh


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


def resolve_surface_locally(surface: str, lexicon_state: LexiconState) -> SurfaceResolution | None:
    normalized_surface = normalize_lookup_key(surface)
    direct_cefr = resolve_key_in_lexicon(normalized_surface, lexicon_state)
    if direct_cefr is not None:
        return SurfaceResolution(
            normalized_surface=normalized_surface,
            cefr=direct_cefr,
            source="dictionary",
            lemma=normalized_surface,
            base_phrase=normalized_surface,
            explain_zh="本地词典直接命中。",
            confidence=1.0,
        )
    for lemma in basic_lemma_candidates(surface):
        cefr = resolve_key_in_lexicon(lemma, lexicon_state)
        if cefr is None:
            continue
        return SurfaceResolution(
            normalized_surface=normalized_surface,
            cefr=cefr,
            source="dictionary",
            lemma=lemma,
            base_phrase=lemma,
            explain_zh="本地词典通过基础词形还原命中。",
            confidence=0.82,
        )
    return None


def resolve_key_in_lexicon(key: str, lexicon_state: LexiconState) -> str | None:
    return lexicon_state.exact_map.get(normalize_lookup_key(key))


def build_parts_from_annotations(
    sentence_text: str,
    annotations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not annotations:
        return [{"text": sentence_text}]
    sorted_annotations = sorted(
        annotations,
        key=lambda item: (int(item["start"]), -int(item["end"])),
    )
    parts: list[dict[str, Any]] = []
    cursor = 0
    for annotation in sorted_annotations:
        start = int(annotation["start"])
        end = int(annotation["end"])
        if start < cursor or end <= start:
            continue
        if cursor < start:
            parts.append({"text": sentence_text[cursor:start]})
        parts.append(
            {
                "text": sentence_text[start:end],
                "kind": annotation["kind"],
                "originalText": annotation["originalText"],
                "displayText": annotation["displayText"],
                "cefr": annotation["cefr"],
                "resolvedLemma": annotation["resolvedLemma"],
                "resolutionSource": annotation["resolutionSource"],
            }
        )
        cursor = end
    if cursor < len(sentence_text):
        parts.append({"text": sentence_text[cursor:]})
    return [part for part in parts if part.get("text")]


def split_into_paragraphs(text: str) -> list[str]:
    paragraphs = [item.strip() for item in re.split(r"\n{2,}", text) if item.strip()]
    return paragraphs or [text.strip()]


def split_paragraph_into_sentences(paragraph: str) -> list[str]:
    result: list[str] = []
    start = 0
    for match in re.finditer(r"[.!?]+(?:['\")\]]+)?\s+", paragraph):
        end = match.end()
        sentence = paragraph[start:end].strip()
        if sentence:
            result.append(sentence)
        start = end
    tail = paragraph[start:].strip()
    if tail:
        result.append(tail)
    return result or [paragraph.strip()]


def estimate_sentence_syntax_value(text: str) -> float:
    words = [match.group(0).lower() for match in WORD_RE.finditer(text)]
    if not words:
        return 0.0
    score = 0
    word_count = len(words)
    comma_count = text.count(",")
    if word_count > 14:
        score += 0.6
    if word_count > 22:
        score += 0.8
    if word_count > 32:
        score += 0.8
    if comma_count >= 2:
        score += 0.8
    if ";" in text or ":" in text:
        score += 0.8
    if "(" in text or ")" in text:
        score += 0.5
    subordinate_hits = sum(1 for word in words if word in SUBORDINATE_MARKERS)
    score += min(1.5, subordinate_hits * 0.45)
    nominalization_hits = sum(
        1
        for word in words
        if any(
            word.endswith(suffix) and len(word) >= len(suffix) + 3
            for suffix in NOMINALIZATION_SUFFIXES
        )
    )
    score += min(1.0, nominalization_hits * 0.25)
    passive_hits = len(
        re.findall(r"\b(?:is|are|was|were|be|been|being)\s+[a-z]+ed\b", text.lower())
    )
    score += min(0.8, passive_hits * 0.4)
    return clamp_numeric(score)


def should_upgrade_span(span: SentenceSpan) -> bool:
    return (
        len(span.surface) >= 5
        and span.surface.isascii()
        and span.surface.lower() not in STOPWORDS
        and re.fullmatch(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", span.surface) is not None
    )


def basic_lemma_candidates(surface: str) -> list[str]:
    normalized = normalize_lookup_key(surface)
    if not normalized:
        return []
    candidates = {normalized}
    if normalized.endswith("'s"):
        candidates.add(normalized[:-2])
    if normalized.endswith("ies") and len(normalized) > 4:
        candidates.add(normalized[:-3] + "y")
    if normalized.endswith("ied") and len(normalized) > 4:
        candidates.add(normalized[:-3] + "y")
    if normalized.endswith("ing") and len(normalized) > 5:
        base = normalized[:-3]
        candidates.add(base)
        candidates.add(base + "e")
        if len(base) >= 2 and base[-1] == base[-2]:
            candidates.add(base[:-1])
    if normalized.endswith("ed") and len(normalized) > 4:
        base = normalized[:-2]
        candidates.add(base)
        candidates.add(base + "e")
        if len(base) >= 2 and base[-1] == base[-2]:
            candidates.add(base[:-1])
    if normalized.endswith("es") and len(normalized) > 4:
        candidates.add(normalized[:-2])
    if normalized.endswith("s") and len(normalized) > 3:
        candidates.add(normalized[:-1])
    if normalized.endswith("ment") and len(normalized) > 6:
        candidates.add(normalized[:-4])
    if normalized.endswith("ness") and len(normalized) > 6:
        candidates.add(normalized[:-4])
    if normalized.endswith("quisition") and len(normalized) > 10:
        candidates.add(normalized[:-9] + "quire")
    if normalized.endswith("ation") and len(normalized) > 8:
        stem = normalized[:-5]
        candidates.add(stem)
        candidates.add(stem + "e")
        candidates.add(stem + "ate")
    if normalized.endswith("ition") and len(normalized) > 8:
        candidates.add(normalized[:-5] + "e")
    if normalized.endswith("sion") and len(normalized) > 7:
        stem = normalized[:-4]
        candidates.add(stem)
        candidates.add(stem + "e")
        candidates.add(stem + "de")
        candidates.add(stem + "se")
    if normalized.endswith("tion") and len(normalized) > 7:
        stem = normalized[:-4]
        candidates.add(stem + "e")
        candidates.add(stem + "te")
    if normalized.endswith("ity") and len(normalized) > 6:
        candidates.add(normalized[:-3])
        candidates.add(normalized[:-3] + "e")
    return [item for item in sorted(candidates, key=len, reverse=True) if item]


def resolve_material_source(
    *,
    pasted_text: str,
    file_bytes: bytes | None,
    original_filename: str,
) -> tuple[str, str]:
    text_value = str(pasted_text or "").strip()
    if text_value:
        return ("paste", text_value)
    if not file_bytes:
        raise EnglishReadingError("请粘贴正文或上传 txt / md / pdf 文件。")
    suffix = Path(original_filename or "").suffix.lower()
    if suffix == ".pdf":
        return ("pdf", extract_text_from_pdf(file_bytes))
    if suffix in {".txt", ".md"} or not suffix:
        try:
            return (suffix.lstrip(".") or "txt", file_bytes.decode("utf-8"))
        except UnicodeDecodeError:
            try:
                return (suffix.lstrip(".") or "txt", file_bytes.decode("utf-8-sig"))
            except UnicodeDecodeError as exc:
                raise EnglishReadingError("文本文件需要是 UTF-8 编码。") from exc
    raise EnglishReadingError("暂只支持 txt / md / pdf 文件。")


def extract_text_from_pdf(file_bytes: bytes) -> str:
    try:
        document = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as exc:
        raise EnglishReadingError("PDF 打开失败。") from exc
    page_lines: list[list[str]] = []
    for page in document:
        raw_lines = [line.rstrip() for line in page.get_text("text").splitlines()]
        page_lines.append(raw_lines)
    repeated_edge_lines = detect_repeated_pdf_edge_lines(page_lines)
    cleaned_pages: list[str] = []
    for lines in page_lines:
        filtered = []
        for index, line in enumerate(lines):
            normalized_line = line.strip()
            if not normalized_line:
                filtered.append("")
                continue
            if PAGE_NUMBER_RE.match(normalized_line):
                continue
            if index < 2 or index >= max(0, len(lines) - 2):
                if normalized_line in repeated_edge_lines:
                    continue
            filtered.append(line)
        cleaned_pages.append(join_pdf_lines(filtered))
    return "\n\n".join(page for page in cleaned_pages if page.strip())


def detect_repeated_pdf_edge_lines(page_lines: list[list[str]]) -> set[str]:
    edge_counter: Counter[str] = Counter()
    for lines in page_lines:
        stripped = [line.strip() for line in lines if line.strip()]
        if not stripped:
            continue
        for line in stripped[:2] + stripped[-2:]:
            if len(line) < 3:
                continue
            edge_counter[line] += 1
    minimum_hits = max(2, math.ceil(len(page_lines) * 0.4))
    return {line for line, count in edge_counter.items() if count >= minimum_hits}


def join_pdf_lines(lines: list[str]) -> str:
    paragraphs: list[str] = []
    current_parts: list[str] = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            if current_parts:
                paragraphs.append(" ".join(current_parts).strip())
                current_parts = []
            continue
        if not current_parts:
            current_parts.append(line)
            continue
        previous = current_parts[-1]
        if previous.endswith(("-", "/")):
            current_parts[-1] = previous[:-1] + line
        elif previous.endswith((".", "?", "!", ":", ";")):
            current_parts.append(line)
        elif line[:1].islower():
            current_parts[-1] = previous + " " + line
        else:
            current_parts.append(line)
    if current_parts:
        paragraphs.append(" ".join(current_parts).strip())
    return "\n\n".join(paragraphs)


def clean_material_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"\s+", " ", line).strip() for line in normalized.split("\n")]
    cleaned_lines: list[str] = []
    blank_streak = 0
    for line in lines:
        if not line:
            blank_streak += 1
            if blank_streak <= 2:
                cleaned_lines.append("")
            continue
        blank_streak = 0
        cleaned_lines.append(line)
    return "\n".join(cleaned_lines).strip()


def derive_material_title(text: str, *, original_filename: str) -> str:
    english_text = extract_visible_english_text(text)
    english_lines = [line.strip() for line in english_text.splitlines() if line.strip()]
    preferred_line = next(
        (line for line in english_lines if len(WORD_RE.findall(line)) >= 4),
        english_lines[0] if english_lines else "",
    )
    first_non_empty = preferred_line
    if first_non_empty:
        return first_non_empty[:80]
    stem = Path(original_filename or "").stem.strip()
    english_stem_words = WORD_RE.findall(stem)
    if english_stem_words:
        return " ".join(english_stem_words)[:80]
    return stem or "未命名英语阅读材料"


def extract_visible_english_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    mixed_chunks = [normalize_english_candidate(chunk) for chunk in CJK_RE.split(normalized)]
    chunk_paragraphs = [
        chunk
        for chunk in mixed_chunks
        if is_visible_english_paragraph(chunk) and len(WORD_RE.findall(chunk)) >= 4
    ]
    if chunk_paragraphs:
        return "\n\n".join(chunk_paragraphs).strip()
    english_paragraphs: list[str] = []
    current_lines: list[str] = []
    for raw_line in normalized.split("\n"):
        line = normalize_english_candidate(raw_line)
        if not line:
            if current_lines:
                english_paragraphs.append(" ".join(current_lines).strip())
                current_lines = []
            continue
        if is_visible_english_paragraph(line):
            current_lines.append(line)
            continue
        if current_lines:
            english_paragraphs.append(" ".join(current_lines).strip())
            current_lines = []
    if current_lines:
        english_paragraphs.append(" ".join(current_lines).strip())
    english_paragraphs = [paragraph for paragraph in english_paragraphs if paragraph]
    if english_paragraphs:
        return "\n\n".join(english_paragraphs).strip()
    return ""


def is_visible_english_paragraph(paragraph: str) -> bool:
    stripped = normalize_english_candidate(paragraph)
    if not stripped:
        return False
    words = WORD_RE.findall(stripped)
    if len(words) < 2:
        return False
    cjk_count = len(CJK_RE.findall(stripped))
    ascii_letter_count = sum(1 for char in stripped if char.isascii() and char.isalpha())
    if ascii_letter_count < 12:
        return False
    if cjk_count == 0:
        return True
    return ascii_letter_count >= cjk_count * 3


def normalize_english_candidate(value: str) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "")).strip()
    normalized = normalized.replace("’", "'").replace("“", '"').replace("”", '"')
    normalized = normalized.strip(" -_/|")
    return normalized


def count_words(text: str) -> int:
    return len(WORD_RE.findall(text))


def ensure_profile_row(session: Session) -> EnglishReadingProfile:
    profile = session.query(EnglishReadingProfile).order_by(EnglishReadingProfile.id.asc()).first()
    if profile is not None:
        return profile
    profile = EnglishReadingProfile(
        declared_cefr="B1",
        working_lexical_i=serialize_float(default_lexical_value_for_level("B1")),
        working_syntactic_i=serialize_float(default_syntactic_value_for_level("B1")),
        xp=0,
        confidence=serialize_float(0.35),
        easy_streak=0,
        hard_streak=0,
    )
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return profile


def get_material_row(session: Session, material_id: int) -> EnglishReadingMaterial:
    material = session.query(EnglishReadingMaterial).filter_by(id=material_id).first()
    if material is None:
        raise EnglishReadingError("英语阅读材料不存在。")
    return material


def get_latest_version(material: EnglishReadingMaterial) -> EnglishReadingVersion | None:
    if not material.versions:
        return None
    return material.versions[-1]


def resolve_session_version(
    material: EnglishReadingMaterial,
    version_id: int | None,
) -> EnglishReadingVersion:
    if version_id is not None:
        for version in material.versions:
            if version.id == version_id:
                return version
    version = get_latest_version(material)
    if version is None:
        raise EnglishReadingError("当前材料还没有生成阅读版本。")
    return version


def serialize_profile(profile: EnglishReadingProfile) -> dict[str, Any]:
    declared_cefr = normalize_cefr_level(profile.declared_cefr)
    return {
        "declaredCefr": declared_cefr,
        "workingLexicalI": round(
            parse_float(profile.working_lexical_i, default_lexical_value_for_level(declared_cefr)),
            3,
        ),
        "workingSyntacticI": round(
            parse_float(
                profile.working_syntactic_i, default_syntactic_value_for_level(declared_cefr)
            ),
            3,
        ),
        "xp": int(profile.xp or 0),
        "levelProgress": max(0, min(100, int(profile.xp or 0))),
        "confidence": round(parse_float(profile.confidence, 0.35), 3),
    }


def serialize_material(material: EnglishReadingMaterial) -> dict[str, Any]:
    latest_version = get_latest_version(material)
    return {
        "id": material.id,
        "title": material.title,
        "sourceType": material.source_type,
        "originalFilename": material.original_filename,
        "wordCount": int(material.word_count or 0),
        "latestVersionId": latest_version.id if latest_version else None,
        "createdAt": material.created_at.isoformat() if material.created_at else None,
        "updatedAt": material.updated_at.isoformat() if material.updated_at else None,
    }


def serialize_version(version: EnglishReadingVersion) -> dict[str, Any]:
    return {
        "id": version.id,
        "materialId": version.material_id,
        "declaredCefr": normalize_cefr_level(version.declared_cefr),
        "workingLexicalI": round(parse_float(version.working_lexical_i, 0.0), 3),
        "workingSyntacticI": round(parse_float(version.working_syntactic_i, 0.0), 3),
        "targetCefr": normalize_cefr_level(version.target_cefr),
        "targetLexicalI": round(parse_float(version.target_lexical_i, 0.0), 3),
        "targetSyntacticI": round(parse_float(version.target_syntactic_i, 0.0), 3),
        "renderBlocks": json.loads(version.render_blocks_json or "[]"),
        "spanAnnotations": json.loads(version.span_annotations_json or "[]"),
        "sentenceAnnotations": json.loads(version.sentence_annotations_json or "[]"),
        "summary": json.loads(version.summary_json or "{}"),
        "createdAt": version.created_at.isoformat() if version.created_at else None,
    }


def serialize_session(session_row: EnglishReadingSession) -> dict[str, Any]:
    return {
        "id": session_row.id,
        "materialId": session_row.material_id,
        "versionId": session_row.version_id,
        "feedback": session_row.feedback,
        "durationSeconds": int(session_row.duration_seconds or 0),
        "wordsPerMinute": int(session_row.words_per_minute or 0),
        "hoverCount": int(session_row.hover_count or 0),
        "expandCount": int(session_row.expand_count or 0),
        "xpAwarded": int(session_row.xp_awarded or 0),
        "calibration": json.loads(session_row.calibration_json or "{}"),
        "completedAt": session_row.completed_at.isoformat() if session_row.completed_at else None,
    }


def normalize_cefr_level(value: str) -> str:
    candidate = str(value or "").strip().upper()
    if candidate not in LEVEL_TO_INDEX:
        raise EnglishReadingError("CEFR 等级无效。")
    return candidate


def numeric_to_target_cefr(value: float) -> str:
    safe_value = clamp_numeric(value)
    return CEFR_LEVELS[min(len(CEFR_LEVELS) - 1, max(0, math.ceil(safe_value)))]


def default_lexical_value_for_level(level: str) -> float:
    return float(LEVEL_TO_INDEX[normalize_cefr_level(level)]) + 0.4


def default_syntactic_value_for_level(level: str) -> float:
    return float(LEVEL_TO_INDEX[normalize_cefr_level(level)]) + 0.25


def clamp_numeric(value: float) -> float:
    return min(float(len(CEFR_LEVELS) - 1), max(0.0, float(value)))


def normalize_dictionary_query_word(value: str) -> str:
    normalized = normalize_lookup_key(value)
    if not normalized:
        return ""
    if re.fullmatch(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", normalized) is None:
        return ""
    return normalized


def normalize_sentence_translation_text(value: str) -> str:
    return WHITESPACE_RE.sub(" ", str(value or "").strip())


def normalize_lookup_key(value: str) -> str:
    normalized = TOKEN_CONNECTOR_RE.sub("-", str(value or "").strip().lower())
    normalized = normalized.replace("’", "'").replace("–", "-").replace("—", "-")
    normalized = WHITESPACE_RE.sub(" ", normalized)
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
        "source": row.source or "xxapi",
        "cachedAt": row.updated_at.isoformat() if row.updated_at else None,
    }
