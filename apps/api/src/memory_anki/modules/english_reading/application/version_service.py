"""Version generation + completion (the reading-generation flow).

Extracted from service.py (P1.3b). Cross-module and shared symbols
are resolved at runtime via the ``_svc`` handle so that route tests which
patch ``reading_service.X`` keep working.
"""

from __future__ import annotations

import json
import uuid
from typing import (
    Any,
)

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import (
    EnglishReadingMaterial,
    EnglishReadingSession,
    EnglishReadingVersion,
)
from memory_anki.modules.english_reading.domain.errors import EnglishReadingError
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
)

from . import service as _svc


def generate_material_version(
    session: Session,
    *,
    material_id: int,
    mode: str = "initial",
    difficulty_direction: str | None = None,
    difficulty_delta: float | None = None,
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    return _svc._consume_status_stream(
        _svc.generate_material_version_events(
            session,
            material_id=material_id,
            mode=mode,
            difficulty_direction=difficulty_direction,
            difficulty_delta=difficulty_delta,
            ai_options=ai_options,
        )
    )


def generate_material_version_events(
    session: Session,
    *,
    material_id: int,
    mode: str = "initial",
    difficulty_direction: str | None = None,
    difficulty_delta: float | None = None,
    ai_options: AiRuntimeOptions | None = None,
):
    material = _svc.get_material_row(session, material_id)
    profile = _svc.ensure_profile_row(session)
    reading_text = _svc.extract_visible_english_text(material.cleaned_text)
    if not reading_text.strip():
        raise EnglishReadingError("当前材料没有可生成阅读结果的英文正文。")
    generation_trace: list[dict[str, Any]] = []
    generation_job_id = f"english-reading:{material.id}:{uuid.uuid4().hex}"
    status = _svc._build_generation_status(
        "clean_text",
        1,
        "正在清理段落结构……",
        stats={"materialId": material.id},
    )
    generation_trace.append(status)
    yield ("status", status)
    declared_cefr = _svc.normalize_cefr_level(profile.declared_cefr)
    working_lexical_i = _svc.parse_float(
        profile.working_lexical_i, _svc.default_lexical_value_for_level(declared_cefr)
    )
    working_syntactic_i = _svc.parse_float(
        profile.working_syntactic_i,
        _svc.default_syntactic_value_for_level(declared_cefr),
    )
    working_lexical_i, working_syntactic_i = _svc.resolve_generation_working_values(
        working_lexical_i=working_lexical_i,
        working_syntactic_i=working_syntactic_i,
        mode=mode,
        difficulty_direction=difficulty_direction,
        difficulty_delta=difficulty_delta,
    )
    target_lexical_i = _svc.clamp_numeric(working_lexical_i + 0.75)
    target_syntactic_i = _svc.clamp_numeric(working_syntactic_i + 0.65)
    target_cefr = _svc.numeric_to_target_cefr(target_lexical_i)
    render_payload = yield from _svc.build_reading_version_payload_stream(
        session,
        text=reading_text,
        material_id=material.id,
        declared_cefr=declared_cefr,
        working_lexical_i=working_lexical_i,
        working_syntactic_i=working_syntactic_i,
        target_lexical_i=target_lexical_i,
        target_syntactic_i=target_syntactic_i,
        total_word_count=max(1, _svc.count_words(reading_text)),
        generation_job_id=generation_job_id,
        generation_trace=generation_trace,
        ai_options=ai_options,
    )
    summary_payload = {
        **render_payload["summary"],
        "_generationTrace": generation_trace,
        "_aiLogIds": render_payload.get("aiLogIds") or [],
    }
    status = _svc._build_generation_status(
        "save_version",
        8,
        "正在保存阅读版本……",
    )
    generation_trace.append(status)
    yield ("status", status)
    version = EnglishReadingVersion(
        material=material,
        declared_cefr=declared_cefr,
        working_lexical_i=_svc.serialize_float(working_lexical_i),
        working_syntactic_i=_svc.serialize_float(working_syntactic_i),
        target_cefr=target_cefr,
        target_lexical_i=_svc.serialize_float(target_lexical_i),
        target_syntactic_i=_svc.serialize_float(target_syntactic_i),
        render_blocks_json=json.dumps(render_payload["renderBlocks"], ensure_ascii=False),
        span_annotations_json=json.dumps(render_payload["spanAnnotations"], ensure_ascii=False),
        sentence_annotations_json=json.dumps(
            render_payload["sentenceAnnotations"], ensure_ascii=False
        ),
        summary_json=json.dumps(summary_payload, ensure_ascii=False),
    )
    material.updated_at = utc_now_naive()
    session.add(version)
    session.commit()
    session.refresh(version)
    return _svc.serialize_version(version)


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

    safe_direction = _svc.normalize_generation_direction(difficulty_direction)
    if safe_direction == "same":
        return working_lexical_i, working_syntactic_i

    safe_delta = _svc.normalize_generation_delta(difficulty_delta)
    multiplier = safe_delta / 0.5
    lexical_offset = _svc.READING_DIFFICULTY_BASE_DELTA["lexical"] * multiplier
    syntactic_offset = _svc.READING_DIFFICULTY_BASE_DELTA["syntactic"] * multiplier
    direction_sign = -1 if safe_direction == "easier" else 1
    return (
        _svc.clamp_numeric(working_lexical_i + direction_sign * lexical_offset),
        _svc.clamp_numeric(working_syntactic_i + direction_sign * syntactic_offset),
    )


def normalize_generation_direction(direction: str | None) -> str:
    if direction is None or not str(direction).strip():
        return "same"
    safe_direction = str(direction).strip().lower()
    if safe_direction not in _svc.READING_ALLOWED_DIFFICULTY_DIRECTIONS:
        raise EnglishReadingError("难度方向仅支持 easier、same 或 harder。")
    return safe_direction


def normalize_generation_delta(delta: float | None) -> float:
    if delta is None:
        raise EnglishReadingError("请提供有效的难度变化幅度。")
    safe_delta = round(float(delta), 2)
    if safe_delta not in _svc.READING_ALLOWED_DIFFICULTY_DELTAS:
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
    material = _svc.get_material_row(session, material_id)
    version = _svc.resolve_session_version(material, version_id)
    profile = _svc.ensure_profile_row(session)
    safe_feedback = _svc.normalize_feedback(feedback)
    safe_duration = max(1, int(duration_seconds))
    safe_hover_count = max(0, int(hover_count))
    safe_expand_count = max(0, int(expand_count))
    words_per_minute = max(1, round(material.word_count / max(safe_duration / 60, 1 / 60)))
    xp_awarded = min(40, round(material.word_count / 35))
    if safe_feedback == "just_right":
        xp_awarded += 5
    elif safe_feedback == "too_easy":
        xp_awarded += 3

    declared_cefr = _svc.normalize_cefr_level(profile.declared_cefr)
    working_lexical_i = _svc.parse_float(
        profile.working_lexical_i, _svc.default_lexical_value_for_level(declared_cefr)
    )
    working_syntactic_i = _svc.parse_float(
        profile.working_syntactic_i,
        _svc.default_syntactic_value_for_level(declared_cefr),
    )
    confidence = _svc.parse_float(profile.confidence, 0.35)

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

    next_working_lexical_i = _svc.clamp_numeric(working_lexical_i + lexical_delta)
    next_working_syntactic_i = _svc.clamp_numeric(working_syntactic_i + syntactic_delta)
    next_confidence = min(0.95, max(0.2, confidence + confidence_delta))

    profile.working_lexical_i = _svc.serialize_float(next_working_lexical_i)
    profile.working_syntactic_i = _svc.serialize_float(next_working_syntactic_i)
    profile.confidence = _svc.serialize_float(next_confidence)
    profile.xp = max(0, int(profile.xp) + xp_awarded)

    leveled_up = False
    if profile.xp >= 100 and next_confidence >= 0.55 and profile.easy_streak >= 2:
        current_index = _svc.LEVEL_TO_INDEX[declared_cefr]
        if current_index < len(_svc.CEFR_LEVELS) - 1:
            leveled_up = True
            profile.declared_cefr = _svc.CEFR_LEVELS[current_index + 1]
            profile.xp -= 100
            profile.confidence = _svc.serialize_float(max(0.35, next_confidence - 0.12))

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
        "material": _svc.serialize_material(material),
        "profile": _svc.serialize_profile(profile),
        "session": _svc.serialize_session(reading_session),
    }


def _build_generation_status(
    stage: str,
    step: int,
    message: str,
    *,
    stats: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "stage": stage,
        "step": step,
        "totalSteps": _svc.READING_GENERATION_TOTAL_STEPS,
        "message": message,
    }
    if stats:
        payload["stats"] = stats
    return payload


def _consume_status_stream(stream):
    while True:
        try:
            next(stream)
        except StopIteration as exc:
            return exc.value


def build_reading_version_payload(
    session: Session,
    *,
    text: str,
    material_id: int,
    declared_cefr: str,
    working_lexical_i: float,
    working_syntactic_i: float,
    target_lexical_i: float,
    target_syntactic_i: float,
    total_word_count: int,
    generation_job_id: str,
    generation_trace: list[dict[str, Any]],
    ai_options: AiRuntimeOptions | None = None,
) -> dict[str, Any]:
    return _svc._consume_status_stream(
        _svc.build_reading_version_payload_stream(
            session,
            text=text,
            material_id=material_id,
            declared_cefr=declared_cefr,
            working_lexical_i=working_lexical_i,
            working_syntactic_i=working_syntactic_i,
            target_lexical_i=target_lexical_i,
            target_syntactic_i=target_syntactic_i,
            total_word_count=total_word_count,
            generation_job_id=generation_job_id,
            generation_trace=generation_trace,
            ai_options=ai_options,
        )
    )


def build_reading_version_payload_stream(
    session: Session,
    *,
    text: str,
    material_id: int,
    declared_cefr: str,
    working_lexical_i: float,
    working_syntactic_i: float,
    target_lexical_i: float,
    target_syntactic_i: float,
    total_word_count: int,
    generation_job_id: str,
    generation_trace: list[dict[str, Any]],
    ai_options: AiRuntimeOptions | None = None,
):
    lexicon_state = _svc.load_lexicon_state()
    status = _svc._build_generation_status(
        "local_dictionary",
        2,
        "正在比对本地词典……",
    )
    generation_trace.append(status)
    yield ("status", status)
    paragraph_sentences = [
        [sentence for sentence in _svc.split_paragraph_into_sentences(paragraph) if sentence.strip()]
        for paragraph in _svc.split_into_paragraphs(text)
    ]
    sentence_states: list[_svc.SentenceState] = []
    unresolved_surfaces: set[str] = set()
    still_unresolved: set[str] = set()
    pending_spans_by_surface: dict[str, list[_svc.SentenceSpan]] = {}
    for paragraph in paragraph_sentences:
        for sentence in paragraph:
            state = _svc.build_sentence_state(sentence, lexicon_state)
            sentence_states.append(state)
            for span in state.spans:
                if span.cefr is not None:
                    continue
                unresolved_surfaces.add(span.normalized_surface)
                pending_spans_by_surface.setdefault(span.normalized_surface, []).append(span)

    if unresolved_surfaces:
        cached_resolutions = _svc.load_cached_surface_resolutions(session, unresolved_surfaces)
        still_unresolved = set(unresolved_surfaces)
        for normalized_surface, resolution in cached_resolutions.items():
            _svc.apply_surface_resolution(
                pending_spans_by_surface.get(normalized_surface, []), resolution
            )
            still_unresolved.discard(normalized_surface)
    if still_unresolved:
        status = _svc._build_generation_status(
            "ai_lexical_resolution",
            3,
            "正在补全未识别词形……",
            stats={"unknownSurfaceCount": len(still_unresolved)},
        )
        generation_trace.append(status)
        yield ("status", status)
        ai_surface_resolutions, ai_log_ids = _svc.generate_surface_resolutions_with_ai(
            session,
            lexicon_state=lexicon_state,
            unresolved_surfaces=still_unresolved,
            declared_cefr=declared_cefr,
            target_cefr=_svc.numeric_to_target_cefr(target_lexical_i),
            material_id=material_id,
            generation_job_id=generation_job_id,
            ai_options=ai_options,
        )
        if ai_surface_resolutions:
            for normalized_surface, resolution in ai_surface_resolutions.items():
                _svc.apply_surface_resolution(
                    pending_spans_by_surface.get(normalized_surface, []), resolution
                )
            still_unresolved.difference_update(ai_surface_resolutions.keys())
    else:
        ai_log_ids = []

    status = _svc._build_generation_status(
        "lexical_recheck",
        4,
        "正在重新匹配本地词典……",
        stats={"remainingUnknownCount": len(still_unresolved)},
    )
    generation_trace.append(status)
    yield ("status", status)

    status = _svc._build_generation_status(
        "difficulty_budget",
        5,
        "正在计算你的 i+1 预算……",
    )
    generation_trace.append(status)
    yield ("status", status)
    _, yellow_allocations = _svc.plan_yellow_allocations(
        sentence_states,
        total_word_count=total_word_count,
        working_lexical_i=working_lexical_i,
        target_lexical_i=target_lexical_i,
    )
    sentence_tasks = _svc.build_ai_sentence_tasks(
        sentence_states,
        ai_indices=_svc.choose_sentence_ai_adaptations(
            sentence_states,
            yellow_allocations=yellow_allocations,
            target_lexical_i=target_lexical_i,
            target_syntactic_i=target_syntactic_i,
        ),
        yellow_allocations=yellow_allocations,
        working_lexical_i=working_lexical_i,
        target_lexical_i=target_lexical_i,
        target_syntactic_i=target_syntactic_i,
    )
    sentence_task_map = {task["sentenceId"]: task for task in sentence_tasks}
    ai_sentence_renders: dict[str, dict[str, Any]] = {}
    if sentence_tasks:
        status = _svc._build_generation_status(
            "sentence_rewrite",
            6,
            "正在重构长难句……",
            stats={"sentenceTaskCount": len(sentence_tasks)},
        )
        generation_trace.append(status)
        yield ("status", status)
        ai_sentence_renders, sentence_log_ids = _svc.generate_sentence_renders_with_ai(
            session,
            sentence_tasks=sentence_tasks,
            declared_cefr=declared_cefr,
            target_cefr=_svc.numeric_to_target_cefr(target_lexical_i),
            material_id=material_id,
            generation_job_id=generation_job_id,
            ai_options=ai_options,
        )
        ai_log_ids.extend(sentence_log_ids)

    status = _svc._build_generation_status(
        "assemble_render",
        7,
        "正在编排沉浸式阅读稿……",
    )
    generation_trace.append(status)
    yield ("status", status)

    render_blocks: list[dict[str, Any]] = []
    span_annotations: list[dict[str, Any]] = []
    sentence_annotations: list[dict[str, Any]] = []
    span_counter = 0
    sentence_counter = 0
    version_target_cefr = _svc.numeric_to_target_cefr(target_lexical_i)
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
                    rendered = _svc.render_sentence_locally(
                        state.text,
                        lexicon_state=lexicon_state,
                        all_spans=state.spans,
                        green_spans=green_spans,
                        yellow_spans=yellow_spans,
                        red_spans=red_spans,
                        working_lexical_i=working_lexical_i,
                        target_lexical_i=target_lexical_i,
                        sentence_kind="unchanged",
                    )
            else:
                rendered = _svc.render_sentence_locally(
                    state.text,
                    lexicon_state=lexicon_state,
                    all_spans=state.spans,
                    green_spans=green_spans,
                    yellow_spans=[],
                    red_spans=[],
                    working_lexical_i=working_lexical_i,
                    target_lexical_i=target_lexical_i,
                    sentence_kind="unchanged",
                )

            candidate_spans = sentence_task_map.get(sentence_id, {}).get("candidateSpans", {})
            rendered_parts = rendered["parts"]
            if rendered.get("source") == "ai":
                rendered_parts = _svc.materialize_ai_rendered_parts(
                    rendered_parts,
                    candidate_spans,
                    lexicon_state=lexicon_state,
                )

            parts_payload: list[dict[str, Any]] = []
            for part in rendered_parts:
                annotation = _svc.build_annotation_from_rendered_part(part)
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
                if annotation["kind"] in {"green", "yellow", "red"}:
                    summary[f"{annotation['kind']}Count"] += max(
                        1, _svc.count_words(annotation["displayText"])
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
        "aiLogIds": ai_log_ids,
    }


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
    version = _svc.get_latest_version(material)
    if version is None:
        raise EnglishReadingError("当前材料还没有生成阅读版本。")
    return version


def serialize_version(version: EnglishReadingVersion) -> dict[str, Any]:
    raw_summary = json.loads(version.summary_json or "{}")
    generation_trace = raw_summary.pop("_generationTrace", [])
    ai_log_ids = raw_summary.pop("_aiLogIds", [])
    return {
        "id": version.id,
        "materialId": version.material_id,
        "declaredCefr": _svc.normalize_cefr_level(version.declared_cefr),
        "workingLexicalI": round(_svc.parse_float(version.working_lexical_i, 0.0), 3),
        "workingSyntacticI": round(_svc.parse_float(version.working_syntactic_i, 0.0), 3),
        "targetCefr": _svc.normalize_cefr_level(version.target_cefr),
        "targetLexicalI": round(_svc.parse_float(version.target_lexical_i, 0.0), 3),
        "targetSyntacticI": round(_svc.parse_float(version.target_syntactic_i, 0.0), 3),
        "renderBlocks": json.loads(version.render_blocks_json or "[]"),
        "spanAnnotations": json.loads(version.span_annotations_json or "[]"),
        "sentenceAnnotations": json.loads(version.sentence_annotations_json or "[]"),
        "summary": raw_summary,
        "generationTrace": generation_trace if isinstance(generation_trace, list) else [],
        "aiLogIds": ai_log_ids if isinstance(ai_log_ids, list) else [],
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
