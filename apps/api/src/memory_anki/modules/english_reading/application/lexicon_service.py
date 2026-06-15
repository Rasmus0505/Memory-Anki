"""CEFR lexicon + surface resolution helpers.

Extracted from service.py (P1.3b). Cross-module and shared symbols
are resolved at runtime via the ``_svc`` handle so that route tests which
patch ``reading_service.X`` keep working.
"""

from __future__ import annotations

import json
from typing import (
    Any,
)

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import (
    EnglishReadingLexiconCache,
)
from memory_anki.infrastructure.llm.openai_compatible import (
    OpenAICompatibleChatConfig,
)
from memory_anki.modules.english_reading.domain.errors import EnglishReadingError
from memory_anki.modules.settings.application.ai_model_registry import (
    AiRuntimeOptions,
)
from memory_anki.modules.settings.application.ai_prompts import get_prompt_template

from . import service as _svc


def generate_surface_resolutions_with_ai(
    session: Session,
    *,
    lexicon_state: _svc.LexiconState,
    unresolved_surfaces: set[str],
    declared_cefr: str,
    target_cefr: str,
    material_id: int,
    generation_job_id: str,
    ai_options: AiRuntimeOptions | None = None,
) -> tuple[dict[str, _svc.SurfaceResolution], list[str]]:
    runtime = _svc._resolve_legacy_dashscope_runtime(
        session,
        scenario_key="english_reading",
        ai_options=ai_options,
        legacy_default_model=_svc.DASHSCOPE_TEXT_MODEL,
    )
    if not runtime.api_key:
        return ({}, [])
    requested_surfaces = sorted(surface for surface in unresolved_surfaces if surface)
    if _svc.should_skip_ai_surface_resolution(set(requested_surfaces)):
        requested_surfaces = []
    if not requested_surfaces:
        return ({}, [])
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
        "sentence_tasks": [],
    }
    base_prompt = get_prompt_template(session, "ai_prompt_english_reading_classify_words")
    prompt = f"{base_prompt}\n\n输入数据：{json.dumps(prompt_payload, ensure_ascii=False)}"
    try:
        payload, log_id = _svc.call_json_completion_with_log(
            config=config,
            prompt=prompt,
            extra_payload=runtime.extra_payload,
            log_context={
                "feature": "英语阅读",
                "operation": "lexical_resolution",
                "job_id": generation_job_id,
                "request_payload": {
                    "material_id": material_id,
                    "unknown_surfaces": requested_surfaces,
                },
            },
        )
    except Exception:
        return ({}, [])
    surface_resolutions = _svc.parse_ai_surface_items(
        payload.get("surfaceItems"),
        requested_surfaces=requested_surfaces,
        lexicon_state=lexicon_state,
    )
    if surface_resolutions:
        _svc.upsert_lexicon_cache(session, surface_resolutions)
    return (surface_resolutions, [log_id] if log_id else [])


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
    lexicon_state: _svc.LexiconState,
) -> dict[str, _svc.SurfaceResolution]:
    if not isinstance(raw_items, list) or not requested_surfaces:
        return {}
    requested_set = set(requested_surfaces)
    resolved: dict[str, _svc.SurfaceResolution] = {}
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        surface = _svc.normalize_lookup_key(str(item.get("surface") or ""))
        if surface not in requested_set or not surface:
            continue
        raw_candidates = item.get("candidates")
        candidates: list[str] = []
        if isinstance(raw_candidates, list):
            for candidate in raw_candidates:
                normalized_candidate = _svc.normalize_lookup_key(str(candidate or ""))
                if normalized_candidate and normalized_candidate not in candidates:
                    candidates.append(normalized_candidate)
                if len(candidates) >= 3:
                    break
        local_match = _svc.find_local_candidate_match(candidates, lexicon_state)
        confidence = max(0.0, min(1.0, _svc.parse_float(item.get("confidence"), 0.75)))
        note = str(item.get("note") or "").strip()
        if local_match is not None:
            resolved[surface] = _svc.SurfaceResolution(
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
            safe_cefr = _svc.normalize_cefr_level(raw_cefr)
        except EnglishReadingError:
            continue
        best_candidate = candidates[0] if candidates else surface
        resolved[surface] = _svc.SurfaceResolution(
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
    lexicon_state: _svc.LexiconState,
) -> dict[str, str] | None:
    for candidate in candidates:
        cefr = _svc.resolve_key_in_lexicon(candidate, lexicon_state)
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
    if kind not in {"green", "yellow", "red", "black"}:
        return None
    text = str(part.get("text") or "")
    original_text = str(part.get("originalText") or "")
    display_text = str(part.get("displayText") or text)
    cefr = str(part.get("cefr") or "")
    if not original_text or not display_text or not cefr:
        return None
    return {
        "kind": kind,
        "originalText": original_text,
        "displayText": display_text,
        "cefr": cefr,
        "originalCefr": str(part.get("originalCefr") or cefr),
        "finalCefr": str(part.get("finalCefr") or cefr),
        "rewriteNeeded": bool(part.get("rewriteNeeded")),
        "rewriteDecision": str(part.get("rewriteDecision") or ""),
        "resolvedLemma": str(part.get("resolvedLemma") or ""),
        "resolutionSource": _svc.normalize_resolution_source(str(part.get("resolutionSource") or "")),
    }


def texts_match_for_annotation(left: str, right: str) -> bool:
    return _svc.normalize_annotation_fragment(left) == _svc.normalize_annotation_fragment(right)


def normalize_annotation_fragment(value: str) -> str:
    return _svc.WHITESPACE_RE.sub(" ", str(value or "")).strip()


def upsert_lexicon_cache(
    session: Session,
    items: dict[str, _svc.SurfaceResolution],
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
        row.confidence = _svc.serialize_float(resolution.confidence)
        row.explain_zh = resolution.explain_zh
        row.source = resolution.source
        row.updated_at = utc_now_naive()
    session.commit()


def load_cached_surface_resolutions(
    session: Session,
    normalized_surfaces: set[str],
) -> dict[str, _svc.SurfaceResolution]:
    if not normalized_surfaces:
        return {}
    rows = (
        session.query(EnglishReadingLexiconCache)
        .filter(EnglishReadingLexiconCache.normalized_surface.in_(tuple(normalized_surfaces)))
        .all()
    )
    return {
        row.normalized_surface: _svc.SurfaceResolution(
            normalized_surface=row.normalized_surface,
            cefr=_svc.normalize_cefr_level(row.cefr),
            source=row.source or "cache",
            lemma=row.lemma or "",
            base_phrase=row.base_phrase or "",
            explain_zh=row.explain_zh or "",
            confidence=_svc.parse_float(row.confidence, 0.75),
        )
        for row in rows
    }


def apply_surface_resolution(spans: list[_svc.SentenceSpan], resolution: _svc.SurfaceResolution) -> None:
    for span in spans:
        span.cefr = resolution.cefr
        span.cefr_value = float(_svc.LEVEL_TO_INDEX[resolution.cefr])
        span.source = resolution.source
        span.lemma = resolution.lemma
        span.base_phrase = resolution.base_phrase
        span.explain_zh = resolution.explain_zh


def resolve_surface_locally(surface: str, lexicon_state: _svc.LexiconState) -> _svc.SurfaceResolution | None:
    normalized_surface = _svc.normalize_lookup_key(surface)
    direct_cefr = _svc.resolve_key_in_lexicon(normalized_surface, lexicon_state)
    if direct_cefr is not None:
        return _svc.SurfaceResolution(
            normalized_surface=normalized_surface,
            cefr=direct_cefr,
            source="dictionary",
            lemma=normalized_surface,
            base_phrase=normalized_surface,
            explain_zh="本地词典直接命中。",
            confidence=1.0,
        )
    for lemma in _svc.basic_lemma_candidates(surface):
        cefr = _svc.resolve_key_in_lexicon(lemma, lexicon_state)
        if cefr is None:
            continue
        return _svc.SurfaceResolution(
            normalized_surface=normalized_surface,
            cefr=cefr,
            source="dictionary",
            lemma=lemma,
            base_phrase=lemma,
            explain_zh="本地词典通过基础词形还原命中。",
            confidence=0.82,
        )
    return None


def resolve_key_in_lexicon(key: str, lexicon_state: _svc.LexiconState) -> str | None:
    return lexicon_state.exact_map.get(_svc.normalize_lookup_key(key))


def basic_lemma_candidates(surface: str) -> list[str]:
    normalized = _svc.normalize_lookup_key(surface)
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
