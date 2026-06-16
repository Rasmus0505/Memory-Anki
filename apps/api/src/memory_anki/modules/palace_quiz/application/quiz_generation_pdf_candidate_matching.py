"""PDF question-candidate matching and marker-based chapter lookup."""

from __future__ import annotations

from typing import Any

from .quiz_generation_shared import (
    extract_chapter_markers_from_text,
    normalize_pdf_marker_text,
)


def select_pdf_question_candidate(
    draft: dict[str, Any],
    question_candidates: list[dict[str, Any]],
    *,
    used_indexes: set[int],
) -> tuple[int | None, dict[str, Any] | None]:
    draft_stem = normalize_pdf_marker_text(draft.get("stem"))
    if not draft_stem:
        return None, None
    for index, item in enumerate(question_candidates):
        if index in used_indexes or not isinstance(item, dict):
            continue
        candidate_stem = normalize_pdf_marker_text(item.get("stem"))
        if candidate_stem and candidate_stem == draft_stem:
            return index, item
    fuzzy_matches: list[tuple[int, dict[str, Any]]] = []
    for index, item in enumerate(question_candidates):
        if index in used_indexes or not isinstance(item, dict):
            continue
        candidate_stem = normalize_pdf_marker_text(item.get("stem"))
        if candidate_stem and (candidate_stem in draft_stem or draft_stem in candidate_stem):
            fuzzy_matches.append((index, item))
    if len(fuzzy_matches) == 1:
        return fuzzy_matches[0]
    return None, None


def extract_pdf_candidate_markers(question_candidate: dict[str, Any]) -> list[str]:
    markers: list[str] = []
    seen: set[str] = set()
    for raw_value in (
        question_candidate.get("section"),
        question_candidate.get("raw_type_label"),
        question_candidate.get("source_snippet"),
        question_candidate.get("stem"),
    ):
        for marker in extract_chapter_markers_from_text(raw_value):
            normalized = normalize_pdf_marker_text(marker)
            if normalized and normalized not in seen:
                seen.add(normalized)
                markers.append(marker)
    return markers


def match_descendant_chapter_from_candidate_markers(
    question_candidate: dict[str, Any],
    descendant_contexts: list[dict[str, Any]],
) -> dict[str, Any] | None:
    markers = extract_pdf_candidate_markers(question_candidate)
    if not markers:
        return None
    best_match: dict[str, Any] | None = None
    best_score: tuple[int, int, int] | None = None
    for context in descendant_contexts:
        blob = normalize_pdf_marker_text(context.get("match_blob"))
        if not blob:
            continue
        marker_hits = 0
        longest_hit = 0
        for marker in markers:
            normalized_marker = normalize_pdf_marker_text(marker)
            if normalized_marker and normalized_marker in blob:
                marker_hits += 1
                longest_hit = max(longest_hit, len(normalized_marker))
        if marker_hits == 0:
            continue
        score = (marker_hits, int(context.get("depth") or 0), longest_hit)
        if best_score is None or score > best_score:
            best_score = score
            best_match = context
    return best_match


__all__ = [
    "extract_pdf_candidate_markers",
    "match_descendant_chapter_from_candidate_markers",
    "select_pdf_question_candidate",
]
