from __future__ import annotations

import json
import math
import re
import shutil
from collections import Counter
from dataclasses import dataclass
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
)
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import (
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
from memory_anki.modules.time_records.application.time_records_service import get_threshold_seconds

CEFR_LEVELS = ("A1", "A2", "B1", "B2", "C1", "C2")
LEVEL_TO_INDEX = {level: index for index, level in enumerate(CEFR_LEVELS)}
WORD_RE = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*|\d+(?:\.\d+)?")
PAGE_NUMBER_RE = re.compile(r"^\s*(?:page\s+)?\d+\s*$", re.IGNORECASE)
TOKEN_CONNECTOR_RE = re.compile(r"\s*-\s*")
WHITESPACE_RE = re.compile(r"\s+")
JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)
CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
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
    generated_materials = (
        session.query(EnglishReadingVersion.material_id)
        .distinct()
        .count()
    )
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
) -> dict[str, Any]:
    material = get_material_row(session, material_id)
    profile = ensure_profile_row(session)
    reading_text = extract_visible_english_text(material.cleaned_text)
    if not reading_text.strip():
        raise EnglishReadingError("当前材料没有可生成阅读结果的英文正文。")
    declared_cefr = normalize_cefr_level(profile.declared_cefr)
    working_lexical_i = parse_float(profile.working_lexical_i, default_lexical_value_for_level(declared_cefr))
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
        sentence_annotations_json=json.dumps(render_payload["sentenceAnnotations"], ensure_ascii=False),
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
    working_lexical_i = parse_float(profile.working_lexical_i, default_lexical_value_for_level(declared_cefr))
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
) -> dict[str, Any]:
    lexicon_state = load_lexicon_state()
    paragraph_sentences = [
        [sentence for sentence in split_paragraph_into_sentences(paragraph) if sentence.strip()]
        for paragraph in split_into_paragraphs(text)
    ]
    sentence_states: list[SentenceState] = []
    unresolved_surfaces: set[str] = set()
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
            apply_surface_resolution(pending_spans_by_surface.get(normalized_surface, []), resolution)
            still_unresolved.discard(normalized_surface)
        if still_unresolved:
            if should_skip_ai_surface_resolution(still_unresolved):
                fallback_resolutions = build_default_surface_resolutions(
                    still_unresolved,
                    message="Default level used because this material has many unresolved surfaces.",
                )
                upsert_lexicon_cache(session, fallback_resolutions)
                for normalized_surface, resolution in fallback_resolutions.items():
                    apply_surface_resolution(pending_spans_by_surface.get(normalized_surface, []), resolution)
            else:
                ai_resolutions = classify_unknown_surfaces_with_ai(session, lexicon_state, still_unresolved)
                for normalized_surface, resolution in ai_resolutions.items():
                    apply_surface_resolution(pending_spans_by_surface.get(normalized_surface, []), resolution)

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
    ai_adaptation_indices = choose_sentence_ai_adaptations(
        sentence_states,
        yellow_allocations=yellow_allocations,
        working_lexical_i=working_lexical_i,
        target_lexical_i=target_lexical_i,
        target_syntactic_i=target_syntactic_i,
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
                span for span in state.spans if span.cefr_value is not None and working_lexical_i < span.cefr_value <= target_lexical_i
            ]
            red_spans = [
                span for span in state.spans if span.cefr_value is not None and span.cefr_value > target_lexical_i
            ]
            yellow_spans = yellow_allocations.get(sentence_cursor - 1, [])
            needs_syntax_simplification = state.estimated_syntax_value > target_syntactic_i + 0.2
            sentence_counter += 1
            sentence_id = f"sentence-{sentence_counter}"

            should_try_ai_adaptation = (sentence_cursor - 1) in ai_adaptation_indices
            if red_spans or yellow_spans or needs_syntax_simplification:
                rendered = None
                if should_try_ai_adaptation:
                    rendered = adapt_sentence_with_ai(
                        state.text,
                        green_spans=green_spans,
                        yellow_spans=yellow_spans,
                        red_spans=red_spans,
                        declared_cefr=declared_cefr,
                        target_cefr=version_target_cefr,
                        needs_syntax_simplification=needs_syntax_simplification,
                    )
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

            parts_payload: list[dict[str, Any]] = []
            for part in rendered["parts"]:
                annotation = build_annotation_from_rendered_part(part, default_target_cefr=version_target_cefr)
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
                summary[f"{annotation['kind']}Count"] += max(1, count_words(annotation["displayText"]))

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

    comfort_count = max(0, total_word_count - summary["greenCount"] - summary["yellowCount"] - summary["redCount"])
    summary["comfortCount"] = comfort_count
    summary["growthCount"] = summary["greenCount"] + summary["yellowCount"]
    return {
        "renderBlocks": render_blocks,
        "spanAnnotations": span_annotations,
        "sentenceAnnotations": sentence_annotations,
        "summary": summary,
    }


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
                "sourceCefr": span.cefr or "",
                "targetCefr": span.cefr or "",
                "explainZh": "Already sits naturally in your i+1 range.",
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


def adapt_sentence_with_ai(
    sentence_text: str,
    *,
    green_spans: list[SentenceSpan],
    yellow_spans: list[SentenceSpan],
    red_spans: list[SentenceSpan],
    declared_cefr: str,
    target_cefr: str,
    needs_syntax_simplification: bool,
) -> dict[str, Any] | None:
    if not str(DASHSCOPE_API_KEY or "").strip():
        return None
    config = OpenAICompatibleChatConfig(
        api_key=str(DASHSCOPE_API_KEY or "").strip(),
        base_url=str(DASHSCOPE_BASE_URL or "").strip(),
        model=str(DASHSCOPE_TEXT_MODEL or "").strip() or "qwen3.6-flash",
        temperature=0.1,
        timeout_seconds=90,
    )
    prompt_payload = {
        "declared_cefr": declared_cefr,
        "target_cefr": target_cefr,
        "sentence": sentence_text,
        "needs_syntax_simplification": needs_syntax_simplification,
        "green_candidates": [serialize_span_for_prompt(span) for span in green_spans],
        "yellow_candidates": [serialize_span_for_prompt(span) for span in yellow_spans],
        "red_candidates": [serialize_span_for_prompt(span) for span in red_spans],
    }
    prompt = (
        "你正在把一条英文句子改造成 i+1 阅读材料。"
        "输入中可以包含中文提示，但你的最终输出必须是英文结果。"
        "必须严格保持原意，不要额外扩写，不要输出中文，不要输出 Markdown。"
        "只输出一个 JSON 对象，结构必须是："
        '{"parts":[{"text":"..."},{"text":"...","kind":"yellow","originalText":"...","displayText":"...","sourceCefr":"A1","targetCefr":"B1","explainZh":"..."}],'
        '"sentenceAnnotation":{"kind":"unchanged|syntax_simplified","originalText":"...","displayText":"...","skeletonHints":["subject","verb"]}}。'
        "parts 需要按顺序拼接成最终展示句。"
        "green 表示原文天然 i+1 且尽量原样保留；yellow 表示把太简单的表达升级到更地道的 i+1；"
        "red 表示把太难的表达降到可顺读版本。"
        "explainZh 字段虽然沿用旧名字，但内容必须是英文简短说明，绝对不能出现中文。"
        "如果句法过难，请适度拆解结构，并把 sentenceAnnotation.kind 设为 syntax_simplified，"
        "同时提供 2 到 4 个英文骨架标签。"
        f"\n\n输入数据：{json.dumps(prompt_payload, ensure_ascii=False)}"
    )
    try:
        payload = call_json_completion(config=config, prompt=prompt)
        return validate_ai_sentence_payload(payload, sentence_text=sentence_text)
    except Exception:
        return None


def validate_ai_sentence_payload(payload: dict[str, Any], *, sentence_text: str) -> dict[str, Any]:
    raw_parts = payload.get("parts")
    if not isinstance(raw_parts, list) or not raw_parts:
        raise EnglishReadingError("模型返回的 parts 为空。")
    parts: list[dict[str, Any]] = []
    for item in raw_parts:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "")
        if not text:
            continue
        kind = str(item.get("kind") or "").strip()
        if kind not in {"green", "yellow", "red"}:
            parts.append({"text": text})
            continue
        parts.append(
            {
                "text": text,
                "kind": kind,
                "originalText": str(item.get("originalText") or ""),
                "displayText": text,
                "sourceCefr": str(item.get("sourceCefr") or ""),
                "targetCefr": str(item.get("targetCefr") or ""),
                "explainZh": str(item.get("explainZh") or ""),
            }
        )
    if not parts:
        raise EnglishReadingError("模型没有返回有效片段。")
    display_text = "".join(item["text"] for item in parts).strip()
    sentence_annotation = payload.get("sentenceAnnotation")
    if not isinstance(sentence_annotation, dict):
        sentence_annotation = {}
    kind = str(sentence_annotation.get("kind") or "unchanged").strip()
    if kind not in {"unchanged", "syntax_simplified"}:
        kind = "unchanged"
    raw_hints = sentence_annotation.get("skeletonHints")
    skeleton_hints = [
        str(item).strip()
        for item in raw_hints
        if str(item).strip()
    ][:4] if isinstance(raw_hints, list) else []
    return {
        "parts": parts,
        "sentenceAnnotation": {
            "kind": kind,
            "originalText": str(sentence_annotation.get("originalText") or sentence_text),
            "displayText": str(sentence_annotation.get("displayText") or display_text or sentence_text),
            "skeletonHints": skeleton_hints,
        },
    }


def build_annotation_from_rendered_part(
    part: dict[str, Any],
    *,
    default_target_cefr: str,
) -> dict[str, Any] | None:
    kind = str(part.get("kind") or "").strip()
    if kind not in {"green", "yellow", "red"}:
        return None
    text = str(part.get("text") or "")
    original_text = str(part.get("originalText") or "")
    display_text = text
    if kind == "green":
        if texts_match_for_annotation(display_text, original_text or display_text):
            safe_original = original_text or display_text
            return {
                "kind": "green",
                "originalText": safe_original,
                "displayText": display_text,
                "sourceCefr": str(part.get("sourceCefr") or ""),
                "targetCefr": str(part.get("targetCefr") or part.get("sourceCefr") or ""),
                "explainZh": str(part.get("explainZh") or "Already sits naturally in your i+1 range."),
            }
        return None
    if not original_text or texts_match_for_annotation(display_text, original_text):
        return None
    return {
        "kind": kind,
        "originalText": original_text,
        "displayText": display_text,
        "sourceCefr": str(part.get("sourceCefr") or ""),
        "targetCefr": str(part.get("targetCefr") or default_target_cefr),
        "explainZh": str(part.get("explainZh") or ""),
    }


def texts_match_for_annotation(left: str, right: str) -> bool:
    return normalize_annotation_fragment(left) == normalize_annotation_fragment(right)


def normalize_annotation_fragment(value: str) -> str:
    return WHITESPACE_RE.sub(" ", str(value or "")).strip()


def call_json_completion(
    *,
    config: OpenAICompatibleChatConfig,
    prompt: str,
) -> dict[str, Any]:
    response_text = call_chat_completion_text(
        config=config,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
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


def classify_unknown_surfaces_with_ai(
    session: Session,
    lexicon_state: LexiconState,
    surfaces: set[str],
) -> dict[str, SurfaceResolution]:
    if not surfaces:
        return {}
    if not str(DASHSCOPE_API_KEY or "").strip():
        fallback_level = "B2"
        fallback_payload = {
            surface: SurfaceResolution(
                normalized_surface=surface,
                cefr=fallback_level,
                source="fallback",
                base_phrase=surface,
                explain_zh="Default CEFR used because no model is configured.",
                confidence=0.4,
            )
            for surface in surfaces
        }
        upsert_lexicon_cache(session, fallback_payload)
        return fallback_payload
    config = OpenAICompatibleChatConfig(
        api_key=str(DASHSCOPE_API_KEY or "").strip(),
        base_url=str(DASHSCOPE_BASE_URL or "").strip(),
        model=str(DASHSCOPE_TEXT_MODEL or "").strip() or "qwen3.6-flash",
        temperature=0.0,
        timeout_seconds=90,
    )
    ordered_surfaces = sorted(surface for surface in surfaces if surface)
    resolved: dict[str, SurfaceResolution] = {}
    for batch_start in range(0, len(ordered_surfaces), 48):
        batch = ordered_surfaces[batch_start : batch_start + 48]
        prompt = (
            "请为英文学习网站补全词形信息。"
            "你会收到一组本地词典暂未识别的英文表面形式。"
            "输入里可以有中文说明，但输出字段内容必须用英文，不要输出中文。"
            "请输出 JSON："
            '{"items":[{"surface":"cheated","lemma":"cheat","basePhrase":"cheat","cefr":"A2","confidence":0.92,"explainZh":"Past tense form of cheat."}]}。'
            "cefr 只能是 A1/A2/B1/B2/C1/C2。confidence 取 0 到 1 之间。"
            "explainZh 字段虽然名字保留，但值必须是英文。"
            "如果是固定短语，请把 basePhrase 设为最自然的短语原型。"
            f"\n\n待处理词：{json.dumps(batch, ensure_ascii=False)}"
        )
        payload = call_json_completion(config=config, prompt=prompt)
        items = payload.get("items")
        if not isinstance(items, list):
            raise EnglishReadingError("模型没有返回 items 列表。")
        for item in items:
            if not isinstance(item, dict):
                continue
            surface = normalize_lookup_key(str(item.get("surface") or ""))
            if surface not in batch or not surface:
                continue
            lemma = normalize_lookup_key(str(item.get("lemma") or ""))
            base_phrase = normalize_lookup_key(str(item.get("basePhrase") or lemma or surface))
            local_match = (
                resolve_key_in_lexicon(base_phrase, lexicon_state)
                or resolve_key_in_lexicon(lemma, lexicon_state)
                or resolve_key_in_lexicon(surface, lexicon_state)
            )
            cefr = normalize_cefr_level(str(item.get("cefr") or local_match or "B2"))
            if local_match is not None:
                cefr = local_match
            resolved[surface] = SurfaceResolution(
                normalized_surface=surface,
                cefr=cefr,
                source="llm",
                lemma=lemma,
                base_phrase=base_phrase,
                explain_zh=str(item.get("explainZh") or "Model-supplied morphology note."),
                confidence=max(0.0, min(1.0, parse_float(item.get("confidence"), 0.75))),
            )
    for surface in ordered_surfaces:
        if surface in resolved:
            continue
        resolved[surface] = SurfaceResolution(
            normalized_surface=surface,
            cefr="B2",
            source="fallback",
            base_phrase=surface,
            explain_zh="Default level used because the model returned no result.",
            confidence=0.4,
        )
    upsert_lexicon_cache(session, resolved)
    return resolved


def should_skip_ai_surface_resolution(surfaces: set[str]) -> bool:
    return len(surfaces) > MAX_UNKNOWN_SURFACES_FOR_AI_CLASSIFICATION


def build_default_surface_resolutions(
    surfaces: set[str],
    *,
    message: str,
) -> dict[str, SurfaceResolution]:
    return {
        surface: SurfaceResolution(
            normalized_surface=surface,
            cefr="B2",
            source="fallback",
            base_phrase=surface,
            explain_zh=message,
            confidence=0.4,
        )
        for surface in surfaces
        if surface
    }


def choose_sentence_ai_adaptations(
    sentence_states: list[SentenceState],
    *,
    yellow_allocations: dict[int, list[SentenceSpan]],
    working_lexical_i: float,
    target_lexical_i: float,
    target_syntactic_i: float,
) -> set[int]:
    ranked_candidates: list[tuple[float, int]] = []
    for sentence_index, state in enumerate(sentence_states):
        red_spans = [
            span for span in state.spans if span.cefr_value is not None and span.cefr_value > target_lexical_i
        ]
        yellow_spans = yellow_allocations.get(sentence_index, [])
        needs_syntax_simplification = state.estimated_syntax_value > target_syntactic_i + 0.2
        if not red_spans and not yellow_spans and not needs_syntax_simplification:
            continue
        score = 0.0
        if needs_syntax_simplification:
            score += 100.0
        score += sum((span.cefr_value or target_lexical_i) - target_lexical_i for span in red_spans)
        score += len(red_spans) * 3.0
        score += len(yellow_spans) * 1.5
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
        if existing_level is None or LEVEL_TO_INDEX[selected_level] < LEVEL_TO_INDEX[existing_level]:
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
            source="exact",
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
            source="lemma",
            lemma=lemma,
            base_phrase=lemma,
            explain_zh="本地词典通过基础词形还原命中。",
            confidence=0.82,
        )
    return None


def resolve_key_in_lexicon(key: str, lexicon_state: LexiconState) -> str | None:
    return lexicon_state.exact_map.get(normalize_lookup_key(key))


def serialize_span_for_prompt(span: SentenceSpan) -> dict[str, Any]:
    return {
        "text": span.surface,
        "cefr": span.cefr,
        "start": span.start,
        "end": span.end,
    }


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
                "sourceCefr": annotation["sourceCefr"],
                "targetCefr": annotation["targetCefr"],
                "explainZh": annotation["explainZh"],
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
        1 for word in words if any(word.endswith(suffix) and len(word) >= len(suffix) + 3 for suffix in NOMINALIZATION_SUFFIXES)
    )
    score += min(1.0, nominalization_hits * 0.25)
    passive_hits = len(re.findall(r"\b(?:is|are|was|were|be|been|being)\s+[a-z]+ed\b", text.lower()))
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
    if normalized.endswith("ation") and len(normalized) > 8:
        candidates.add(normalized[:-5] + "e")
        candidates.add(normalized[:-5])
    if normalized.endswith("tion") and len(normalized) > 7:
        candidates.add(normalized[:-4] + "e")
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
        chunk for chunk in mixed_chunks
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
        "workingLexicalI": round(parse_float(profile.working_lexical_i, default_lexical_value_for_level(declared_cefr)), 3),
        "workingSyntacticI": round(parse_float(profile.working_syntactic_i, default_syntactic_value_for_level(declared_cefr)), 3),
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
