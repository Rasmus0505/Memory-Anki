"""Heuristics for deciding whether PDF candidates support a final question type."""

from __future__ import annotations

from typing import Any


def _count_valid_question_candidate_options(question_candidate: dict[str, Any]) -> int:
    options = question_candidate.get("options")
    valid_option_count = 0
    if isinstance(options, list):
        for option in options:
            if not isinstance(option, dict):
                continue
            option_id = str(option.get("id") or "").strip()
            option_text = str(option.get("text") or "").strip()
            if option_id and option_text:
                valid_option_count += 1
    return valid_option_count


def _build_candidate_raw_type_text(
    question_candidate: dict[str, Any],
    answer_candidate: dict[str, Any],
) -> str:
    return " ".join(
        str(value or "").strip()
        for value in (
            question_candidate.get("raw_type_label"),
            answer_candidate.get("raw_type_label"),
        )
        if str(value or "").strip()
    )


def candidate_supports_known_final_type(
    question_candidate: dict[str, Any],
    answer_candidate: dict[str, Any],
) -> bool:
    if (
        _count_valid_question_candidate_options(question_candidate) >= 2
        and str(answer_candidate.get("correct_option_id") or "").strip()
    ):
        return True
    if str(answer_candidate.get("reference_answer") or "").strip():
        return True
    raw_type_text = _build_candidate_raw_type_text(question_candidate, answer_candidate)
    if any(token in raw_type_text for token in ("简答", "论述", "问答", "主观")):
        return True
    if (
        str(answer_candidate.get("raw_answer_text") or "").strip()
        and not question_candidate.get("options")
    ):
        return True
    return False


__all__ = ["candidate_supports_known_final_type"]
