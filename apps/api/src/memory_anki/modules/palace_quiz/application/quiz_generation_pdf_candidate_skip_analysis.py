"""Skip-reason analysis for PDF question and answer candidates."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .quiz_generation_pdf_candidate_markers import normalize_pdf_marker_text
from .quiz_generation_pdf_candidate_support import candidate_supports_known_final_type


@dataclass(frozen=True, slots=True)
class PdfCandidateSkipAnalysis:
    missing_answer_indexes: list[int]
    unsupported_indexes: list[int]
    insufficient_indexes: list[int]
    unmatched_chapter_candidate_indexes: list[int]


def _build_answer_candidate_index(
    answer_candidates: list[dict[str, Any]],
) -> dict[tuple[str, str], dict[str, Any]]:
    answer_index: dict[tuple[str, str], dict[str, Any]] = {}
    for item in answer_candidates:
        section = str(item.get("section") or "").strip()
        number = str(item.get("number") or "").strip()
        if section and number:
            answer_index[(section, number)] = item
    return answer_index


def _build_draft_stem_keys(drafts: list[dict[str, Any]] | None) -> set[str]:
    return {
        normalize_pdf_marker_text(question.get("stem"))
        for question in (drafts or [])
        if isinstance(question, dict) and normalize_pdf_marker_text(question.get("stem"))
    }


def analyze_pdf_candidate_skips(
    question_candidates: list[dict[str, Any]],
    answer_candidates: list[dict[str, Any]],
    *,
    drafts: list[dict[str, Any]] | None = None,
    unmatched_chapter_candidate_indexes: list[int] | None = None,
) -> PdfCandidateSkipAnalysis:
    answer_index = _build_answer_candidate_index(answer_candidates)
    draft_stem_keys = _build_draft_stem_keys(drafts)
    missing_answer_indexes: list[int] = []
    unsupported_indexes: list[int] = []
    insufficient_indexes: list[int] = []

    for index, item in enumerate(question_candidates):
        section = str(item.get("section") or "").strip()
        number = str(item.get("number") or "").strip()
        answer_candidate = answer_index.get((section, number))
        if not answer_candidate:
            missing_answer_indexes.append(index)
            continue
        if not draft_stem_keys:
            continue
        stem_key = normalize_pdf_marker_text(item.get("stem"))
        if stem_key and stem_key in draft_stem_keys:
            continue
        if candidate_supports_known_final_type(item, answer_candidate):
            unsupported_indexes.append(index)
        else:
            insufficient_indexes.append(index)

    return PdfCandidateSkipAnalysis(
        missing_answer_indexes=missing_answer_indexes,
        unsupported_indexes=unsupported_indexes,
        insufficient_indexes=insufficient_indexes,
        unmatched_chapter_candidate_indexes=list(unmatched_chapter_candidate_indexes or []),
    )


__all__ = [
    "analyze_pdf_candidate_skips",
    "PdfCandidateSkipAnalysis",
]
