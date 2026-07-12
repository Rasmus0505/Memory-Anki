"""Sentence rendering / annotation orchestration.

Extracted from service.py (P1.3b). Cross-module and shared symbols
are resolved at runtime via the ``_svc`` handle so that route tests which
patch ``reading_service.X`` keep working.
"""

from __future__ import annotations

import json
import re
from typing import (
    Any,
)

from sqlalchemy.orm import Session

from memory_anki.infrastructure.llm.openai_compatible import (
    OpenAICompatibleChatConfig,
)
from memory_anki.platform.application import AiRuntimeOptions

from . import service as _svc
from .ai_dependencies import EnglishReadingAiDependencies


def plan_yellow_allocations(
    sentence_states: list[_svc.SentenceState],
    *,
    total_word_count: int,
    working_lexical_i: float,
    target_lexical_i: float,
) -> tuple[int, dict[int, list[_svc.SentenceSpan]]]:
    natural_green_count = 0
    yellow_candidates: list[tuple[int, _svc.SentenceSpan]] = []
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
                and _svc.should_upgrade_span(span)
            ):
                yellow_candidates.append((sentence_index, span))
                seen_yellow_surfaces.add(span.normalized_surface)
    target_growth_count = max(3, min(24, round(total_word_count * 0.12)))
    yellow_budget = max(0, min(12, target_growth_count - natural_green_count))
    yellow_allocations: dict[int, list[_svc.SentenceSpan]] = {}
    for sentence_index, span in yellow_candidates[:yellow_budget]:
        yellow_allocations.setdefault(sentence_index, []).append(span)
    return natural_green_count, yellow_allocations


def build_ai_sentence_tasks(
    sentence_states: list[_svc.SentenceState],
    *,
    ai_indices: set[int],
    yellow_allocations: dict[int, list[_svc.SentenceSpan]],
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
        candidate_spans: dict[str, _svc.SentenceSpan] = {}
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


def build_sentence_state(text: str, lexicon_state: _svc.LexiconState) -> _svc.SentenceState:
    word_matches = list(_svc.WORD_RE.finditer(text))
    spans: list[_svc.SentenceSpan] = []
    token_index = 0
    while token_index < len(word_matches):
        matched_phrase = _svc.match_phrase_span(text, word_matches, token_index, lexicon_state)
        if matched_phrase is not None:
            spans.append(matched_phrase["span"])
            token_index += matched_phrase["consumed"]
            continue
        match = word_matches[token_index]
        surface = match.group(0)
        local_resolution = _svc.resolve_surface_locally(surface, lexicon_state)
        if local_resolution is None:
            spans.append(
                _svc.SentenceSpan(
                    surface=surface,
                    normalized_surface=_svc.normalize_lookup_key(surface),
                    start=match.start(),
                    end=match.end(),
                    token_count=1,
                )
            )
        else:
            spans.append(
                _svc.SentenceSpan(
                    surface=surface,
                    normalized_surface=local_resolution.normalized_surface,
                    start=match.start(),
                    end=match.end(),
                    token_count=1,
                    cefr=local_resolution.cefr,
                    cefr_value=float(_svc.LEVEL_TO_INDEX[local_resolution.cefr]),
                    source=local_resolution.source,
                    lemma=local_resolution.lemma,
                    base_phrase=local_resolution.base_phrase,
                    explain_zh=local_resolution.explain_zh,
                )
            )
        token_index += 1
    return _svc.SentenceState(
        text=text,
        spans=spans,
        estimated_syntax_value=_svc.estimate_sentence_syntax_value(text),
    )


def match_phrase_span(
    text: str,
    word_matches: list[re.Match[str]],
    token_index: int,
    lexicon_state: _svc.LexiconState,
) -> dict[str, Any] | None:
    max_size = min(lexicon_state.max_phrase_words, len(word_matches) - token_index)
    for phrase_size in range(max_size, 1, -1):
        raw_phrase = " ".join(
            word_matches[token_index + offset].group(0) for offset in range(phrase_size)
        )
        normalized_phrase = _svc.normalize_lookup_key(raw_phrase)
        cefr = lexicon_state.exact_map.get(normalized_phrase)
        if not cefr:
            continue
        start = word_matches[token_index].start()
        end = word_matches[token_index + phrase_size - 1].end()
        return {
            "consumed": phrase_size,
            "span": _svc.SentenceSpan(
                surface=text[start:end],
                normalized_surface=normalized_phrase,
                start=start,
                end=end,
                token_count=phrase_size,
                cefr=cefr,
                cefr_value=float(_svc.LEVEL_TO_INDEX[cefr]),
                source="phrase_exact",
                base_phrase=normalized_phrase,
                explain_zh="Recognized locally as a fixed expression.",
            ),
        }
    return None


def render_sentence_locally(
    sentence_text: str,
    *,
    lexicon_state: _svc.LexiconState,
    all_spans: list[_svc.SentenceSpan],
    green_spans: list[_svc.SentenceSpan],
    yellow_spans: list[_svc.SentenceSpan],
    red_spans: list[_svc.SentenceSpan],
    working_lexical_i: float,
    target_lexical_i: float,
    sentence_kind: str,
) -> dict[str, Any]:
    del lexicon_state
    yellow_surfaces = {span.normalized_surface for span in yellow_spans}
    red_surfaces = {span.normalized_surface for span in red_spans}
    annotations: list[dict[str, Any]] = []
    seen_spans: set[tuple[int, int, str]] = set()
    for span in sorted(all_spans, key=lambda item: (item.start, item.end, item.surface)):
        span_key = (span.start, span.end, span.normalized_surface)
        if span_key in seen_spans or span.cefr is None:
            continue
        seen_spans.add(span_key)
        kind, rewrite_needed, rewrite_decision = _svc.classify_original_span_render(
            span,
            working_lexical_i=working_lexical_i,
            target_lexical_i=target_lexical_i,
            yellow_surfaces=yellow_surfaces,
            red_surfaces=red_surfaces,
        )
        annotations.append(
            {
                "start": span.start,
                "end": span.end,
                "kind": kind,
                "originalText": span.surface,
                "displayText": span.surface,
                "cefr": span.cefr or "",
                "originalCefr": span.cefr or "",
                "finalCefr": span.cefr or "",
                "rewriteNeeded": rewrite_needed,
                "rewriteDecision": rewrite_decision,
                "resolvedLemma": _svc.resolve_span_lemma(span),
                "resolutionSource": _svc.normalize_resolution_source(span.source),
            }
        )
    parts = _svc.build_parts_from_annotations(sentence_text, annotations)
    return {
        "parts": parts,
        "sentenceAnnotation": {
            "kind": sentence_kind,
            "originalText": sentence_text,
            "displayText": sentence_text,
            "skeletonHints": [],
        },
    }


def resolve_span_lemma(span: _svc.SentenceSpan) -> str:
    return str(span.lemma or span.base_phrase or "").strip()


def materialize_ai_rendered_parts(
    parts: list[dict[str, Any]],
    candidate_spans: dict[str, _svc.SentenceSpan],
    *,
    lexicon_state: _svc.LexiconState,
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
        text_matches_original = _svc.texts_match_for_annotation(text, candidate_span.surface)
        final_resolution = _svc.resolve_surface_locally(text, lexicon_state)
        final_cefr = final_resolution.cefr if final_resolution is not None else (candidate_span.cefr or "")
        final_lemma = (
            final_resolution.lemma
            if final_resolution is not None and final_resolution.lemma
            else _svc.resolve_span_lemma(candidate_span)
        )
        resolved_kind = kind
        rewrite_needed = kind in {"yellow", "red"}
        if kind == "green" and not text_matches_original:
            resolved_kind = "black"
            rewrite_needed = False
            rewrite_decision = "unexpected_green_rewrite"
        elif kind == "green":
            rewrite_decision = "kept_original_i_plus_1"
        elif kind == "yellow" and text_matches_original:
            resolved_kind = "black"
            rewrite_decision = "kept_original_below_i_plus_1"
        elif kind == "yellow":
            rewrite_decision = "upgraded_to_i_plus_1"
        elif kind == "red" and text_matches_original:
            resolved_kind = "black"
            rewrite_decision = "kept_original_above_i_plus_1"
        else:
            rewrite_decision = "downgraded_to_i_plus_1"
        materialized.append(
            {
                "text": text,
                "kind": resolved_kind,
                "originalText": candidate_span.surface,
                "displayText": text,
                "cefr": candidate_span.cefr or "",
                "originalCefr": candidate_span.cefr or "",
                "finalCefr": final_cefr,
                "rewriteNeeded": rewrite_needed,
                "rewriteDecision": rewrite_decision,
                "resolvedLemma": final_lemma,
                "resolutionSource": _svc.normalize_resolution_source(candidate_span.source),
            }
        )
    return materialized


def classify_original_span_render(
    span: _svc.SentenceSpan,
    *,
    working_lexical_i: float,
    target_lexical_i: float,
    yellow_surfaces: set[str],
    red_surfaces: set[str],
) -> tuple[str, bool, str]:
    if span.cefr_value is None:
        return ("black", False, "unresolved")
    if working_lexical_i < span.cefr_value <= target_lexical_i:
        return ("green", False, "kept_original_i_plus_1")
    if span.normalized_surface in red_surfaces:
        return ("black", True, "kept_original_above_i_plus_1")
    if span.normalized_surface in yellow_surfaces:
        return ("black", True, "kept_original_below_i_plus_1")
    return ("black", False, "kept_original_black")


def chunk_sentence_tasks(sentence_tasks: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    batches: list[list[dict[str, Any]]] = []
    current_batch: list[dict[str, Any]] = []
    current_chars = 0
    for task in sentence_tasks:
        task_chars = len(str(task.get("sentence") or "")) + sum(
            len(str(item.get("text") or "")) for item in task.get("candidates") or []
        )
        if current_batch and (
            len(current_batch) >= _svc.MAX_SENTENCE_AI_BATCH_ITEMS
            or current_chars + task_chars > _svc.MAX_SENTENCE_AI_BATCH_CHARS
        ):
            batches.append(current_batch)
            current_batch = []
            current_chars = 0
        current_batch.append(task)
        current_chars += task_chars
    if current_batch:
        batches.append(current_batch)
    return batches


def generate_sentence_renders_with_ai(
    session: Session,
    *,
    ai_dependencies: EnglishReadingAiDependencies,
    sentence_tasks: list[dict[str, Any]],
    declared_cefr: str,
    target_cefr: str,
    material_id: int,
    generation_job_id: str,
    ai_options: AiRuntimeOptions | None = None,
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    runtime = _svc._resolve_legacy_dashscope_runtime(
        session,
        ai_dependencies=ai_dependencies,
        scenario_key="english_reading",
        ai_options=ai_options,
        legacy_default_model=_svc.DASHSCOPE_TEXT_MODEL,
    )
    if not runtime.api_key or not sentence_tasks:
        return ({}, [])
    config = OpenAICompatibleChatConfig(
        api_key=runtime.api_key,
        base_url=runtime.base_url,
        model=runtime.model,
        temperature=0.1 if runtime.supports_temperature else None,
        timeout_seconds=90,
    )
    batches = _svc.chunk_sentence_tasks(sentence_tasks)
    sentence_renders: dict[str, dict[str, Any]] = {}
    ai_log_ids: list[str] = []
    for batch_index, batch in enumerate(batches, start=1):
        prompt_payload = {
            "declared_cefr": declared_cefr,
            "target_cefr": target_cefr,
            "unknown_surfaces": [],
            "sentence_tasks": [
                {
                    "sentenceId": task["sentenceId"],
                    "sentence": task["sentence"],
                    "needsSyntaxSimplification": bool(task["needsSyntaxSimplification"]),
                    "candidates": task["candidates"],
                }
                for task in batch
            ],
        }
        base_prompt = ai_dependencies.prompts.render("ai_prompt_english_reading_adapt_sentence")
        prompt = f"{base_prompt}\n\n输入数据：{json.dumps(prompt_payload, ensure_ascii=False)}"
        try:
            payload, log_id = _svc.call_json_completion_with_log(
                config=config,
                prompt=prompt,
                extra_payload=runtime.extra_payload,
                log_context={
                    "feature": "英语阅读",
                    "operation": "sentence_rewrite",
                    "job_id": generation_job_id,
                    "request_payload": {
                        "material_id": material_id,
                        "batch_index": batch_index,
                        "batch_size": len(batch),
                        "sentence_ids": [task["sentenceId"] for task in batch],
                    },
                },
            )
        except Exception:
            continue
        if log_id:
            ai_log_ids.append(log_id)
        requested_sentence_ids = {str(task["sentenceId"]) for task in batch}
        raw_sentence_items = payload.get("sentenceItems")
        if not isinstance(raw_sentence_items, list):
            continue
        for item in raw_sentence_items:
            rendered = _svc.validate_ai_sentence_item(item)
            if rendered is None:
                continue
            sentence_id = str(rendered.get("sentenceId") or "")
            if sentence_id not in requested_sentence_ids:
                continue
            sentence_renders[sentence_id] = rendered
    return (sentence_renders, ai_log_ids)


def should_skip_ai_surface_resolution(surfaces: set[str]) -> bool:
    return len(surfaces) > _svc.MAX_UNKNOWN_SURFACES_FOR_AI_CLASSIFICATION


def choose_sentence_ai_adaptations(
    sentence_states: list[_svc.SentenceState],
    *,
    yellow_allocations: dict[int, list[_svc.SentenceSpan]],
    target_lexical_i: float,
    target_syntactic_i: float,
) -> set[int]:
    candidate_indices: set[int] = set()
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
        candidate_indices.add(sentence_index)
    return candidate_indices


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
                "originalCefr": annotation.get("originalCefr", annotation["cefr"]),
                "finalCefr": annotation.get("finalCefr", annotation["cefr"]),
                "rewriteNeeded": bool(annotation.get("rewriteNeeded")),
                "rewriteDecision": annotation.get("rewriteDecision", ""),
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
    words = [match.group(0).lower() for match in _svc.WORD_RE.finditer(text)]
    if not words:
        return 0.0
    score = 0.0
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
    subordinate_hits = sum(1 for word in words if word in _svc.SUBORDINATE_MARKERS)
    score += min(1.5, subordinate_hits * 0.45)
    nominalization_hits = sum(
        1
        for word in words
        if any(
            word.endswith(suffix) and len(word) >= len(suffix) + 3
            for suffix in _svc.NOMINALIZATION_SUFFIXES
        )
    )
    score += min(1.0, nominalization_hits * 0.25)
    passive_hits = len(
        re.findall(r"\b(?:is|are|was|were|be|been|being)\s+[a-z]+ed\b", text.lower())
    )
    score += min(0.8, passive_hits * 0.4)
    return _svc.clamp_numeric(score)


def should_upgrade_span(span: _svc.SentenceSpan) -> bool:
    return (
        len(span.surface) >= 5
        and span.surface.isascii()
        and span.surface.lower() not in _svc.STOPWORDS
        and re.fullmatch(r"[A-Za-z]+(?:[-'][A-Za-z]+)*", span.surface) is not None
    )
