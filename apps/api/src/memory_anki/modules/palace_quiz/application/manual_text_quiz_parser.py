from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

OPTION_RE = re.compile(r"^\s*([A-Z])[\.\．、]\s*(.*)$")
OPTION_MARKER_RE = re.compile(r"(?<![A-Za-z])([A-Z])[\.\．、]\s*")
RESIDUAL_OPTION_MARKER_RE = re.compile(r"\s+[B-Z][\.\．、]\s*")
QUESTION_START_RE = re.compile(r"^\s*(\d+)[\.\．、]\s*(.*)$")
ANSWER_START_RE = re.compile(r"^\s*(\d+)[\.\．、]?\s*【答案】\s*([A-Z])?\s*(.*)$")
REFERENCE_ANSWER_RE = re.compile(r"^\s*(\d+)[\.\．、]?\s*【参考答案】\s*(.*)$")
CHAPTER_RE = re.compile(r"^\s*第[一二三四五六七八九十百千万0-9１２３４５６７８９０]+章\s*(.+?)\s*$")
SECTION_RE = re.compile(r"^\s*第[一二三四五六七八九十百千万0-9１２３４５６７８９０]+节\s*(.+?)\s*$")

QUESTION_TYPE_LABELS = {
    "单项选择题": "multiple_choice",
    "单选题": "multiple_choice",
    "论述题": "short_answer",
    "分析论述题": "short_answer",
    "材料分析题": "short_answer",
    "简答题": "short_answer",
    "辨析题": "short_answer",
}
SECTION_MARKERS = {"真题典例", "模拟练习"}
NOISE_PATTERNS = (
    re.compile(r"^\s*\d+\s*$"),
    re.compile(r"^\s*后续更新\s*qq\s*群.*$", re.IGNORECASE),
    re.compile(r"^\s*第[一二三四五六七八九十百千万0-9１２３４５６７８９０]+部分\s*.+$"),
)


@dataclass(frozen=True, slots=True)
class ParsedManualQuestion:
    question_type: str
    stem: str
    options: tuple[dict[str, str], ...] = ()
    answer: str = ""
    analysis: str = ""
    chapter_title: str = ""
    section_title: str = ""
    source_group: str = ""
    type_label: str = ""
    number: int = 0
    source_filename: str = ""

    def to_payload(self) -> dict[str, Any]:
        source_meta = {
            "source_kind": "manual_text_import",
            "page_numbers": None,
            "image_names": [self.source_filename] if self.source_filename else None,
            "extra_prompt": "",
            "ai_call_log_id": None,
            "generated_at": None,
            "generation_mode": "manual_text_pair",
            "manual_import": {
                "chapter_title": self.chapter_title,
                "section_title": self.section_title,
                "source_group": self.source_group,
                "type_label": self.type_label,
                "number": self.number,
            },
        }
        if self.question_type == "multiple_choice":
            return {
                "question_type": "multiple_choice",
                "stem": self.stem,
                "options": list(self.options),
                "answer_payload": {"correct_option_id": self.answer},
                "analysis": self.analysis,
                "source_meta": source_meta,
            }
        return {
            "question_type": "short_answer",
            "stem": self.stem,
            "options": [],
            "answer_payload": {"reference_answer": self.answer or self.analysis},
            "analysis": self.analysis,
            "source_meta": source_meta,
        }


@dataclass(frozen=True, slots=True)
class _QuestionCandidate:
    question_type: str
    stem: str
    options: tuple[dict[str, str], ...]
    chapter_title: str
    section_title: str
    source_group: str
    type_label: str
    number: int
    source_filename: str


@dataclass(frozen=True, slots=True)
class _AnswerCandidate:
    answer: str
    analysis: str
    chapter_title: str
    section_title: str
    source_group: str
    type_label: str
    number: int


def _clean_line(line: str) -> str:
    normalized = str(line or "").strip()
    return re.sub(r"\s+", " ", normalized)


def _is_noise_line(line: str) -> bool:
    normalized = _clean_line(line)
    return any(pattern.match(normalized) for pattern in NOISE_PATTERNS)


def _strip_question_prefix(text: str) -> str:
    return re.sub(r"^\s*\d+[\.\．、]\s*", "", str(text or "")).strip()


def _split_inline_options(line: str) -> list[dict[str, str]]:
    matches = list(OPTION_MARKER_RE.finditer(str(line or "")))
    if not matches or matches[0].start() != 0:
        return []
    options: list[dict[str, str]] = []
    for index, match in enumerate(matches):
        option_id = match.group(1)
        next_start = matches[index + 1].start() if index + 1 < len(matches) else len(line)
        option_text = line[match.end() : next_start].strip()
        if option_text:
            options.append({"id": option_id, "text": option_text})
    return options


def _has_residual_option_marker(options: list[dict[str, str]]) -> bool:
    return any(RESIDUAL_OPTION_MARKER_RE.search(option.get("text", "")) for option in options)


def _question_warning(
    *,
    chapter_title: str,
    section_title: str,
    type_label: str,
    number: int,
    reason: str,
) -> str:
    return (
        f"{section_title or chapter_title} {type_label}"
        f" 第 {number} 题{reason}，已跳过。"
    )


def _normalize_label_line(line: str) -> str:
    normalized = _clean_line(line)
    normalized = re.sub(r"^[一二三四五六七八九十]+[、\.．]\s*", "", normalized)
    normalized = normalized.replace(" ", "")
    return normalized


def _label_to_question_type(line: str) -> str | None:
    normalized = _normalize_label_line(line)
    for label, question_type in QUESTION_TYPE_LABELS.items():
        if label in normalized:
            return question_type
    return None


def _match_context_key(
    *,
    chapter_title: str,
    section_title: str,
    source_group: str,
    type_label: str,
    number: int,
) -> tuple[str, str, str, str, int]:
    return (
        _clean_line(chapter_title),
        _clean_line(section_title),
        _clean_line(source_group),
        _normalize_label_line(type_label),
        number,
    )


def _loose_context_key(
    *,
    section_title: str,
    source_group: str,
    type_label: str,
    number: int,
) -> tuple[str, str, str, int]:
    return (
        _clean_line(section_title),
        _clean_line(source_group),
        _normalize_label_line(type_label),
        number,
    )


def _type_family(type_label: str) -> str:
    question_type = _label_to_question_type(type_label)
    return question_type or _normalize_label_line(type_label)


def _append_unique_lookup(
    lookup: dict[tuple[Any, ...], _AnswerCandidate | None],
    key: tuple[Any, ...],
    answer: _AnswerCandidate,
) -> None:
    if key not in lookup:
        lookup[key] = answer
        return
    lookup[key] = None


def _consume_question_block(
    lines: list[str],
    start_index: int,
    *,
    chapter_title: str,
    section_title: str,
    source_group: str,
    type_label: str,
    question_type: str,
    source_filename: str,
) -> tuple[_QuestionCandidate | None, int, str | None]:
    start_match = QUESTION_START_RE.match(lines[start_index])
    if not start_match:
        return None, start_index + 1, None
    number = int(start_match.group(1))
    stem_parts = [_clean_line(start_match.group(2))]
    options: list[dict[str, str]] = []
    current_option: dict[str, str] | None = None
    index = start_index + 1
    while index < len(lines):
        line = _clean_line(lines[index])
        if not line or _is_noise_line(line):
            index += 1
            continue
        if (
            QUESTION_START_RE.match(line)
            or _label_to_question_type(line)
            or line in SECTION_MARKERS
            or CHAPTER_RE.match(line)
            or SECTION_RE.match(line)
        ):
            break
        inline_options = _split_inline_options(line) if question_type == "multiple_choice" else []
        if inline_options:
            options.extend(inline_options)
            current_option = options[-1]
        elif question_type == "multiple_choice" and OPTION_RE.match(line):
            option_match = OPTION_RE.match(line)
            assert option_match is not None
            current_option = {"id": option_match.group(1), "text": option_match.group(2).strip()}
            options.append(current_option)
        elif current_option is not None:
            current_option["text"] = f"{current_option['text']} {line}".strip()
        else:
            stem_parts.append(line)
        index += 1
    stem = " ".join(part for part in stem_parts if part).strip()
    if not stem:
        return None, index, _question_warning(
            chapter_title=chapter_title,
            section_title=section_title,
            type_label=type_label,
            number=number,
            reason="题干为空",
        )
    if question_type == "multiple_choice":
        if len(options) < 4:
            return None, index, _question_warning(
                chapter_title=chapter_title,
                section_title=section_title,
                type_label=type_label,
                number=number,
                reason="选择题选项少于 4 个",
            )
        if _has_residual_option_marker(options):
            return None, index, _question_warning(
                chapter_title=chapter_title,
                section_title=section_title,
                type_label=type_label,
                number=number,
                reason="选项中仍残留合并的选项标记",
            )
    return (
        _QuestionCandidate(
            question_type=question_type,
            stem=stem,
            options=tuple(options),
            chapter_title=chapter_title,
            section_title=section_title,
            source_group=source_group,
            type_label=type_label,
            number=number,
            source_filename=source_filename,
        ),
        index,
        None,
    )


def _parse_question_candidates(
    text: str,
    *,
    source_filename: str = "",
) -> tuple[list[_QuestionCandidate], list[str]]:
    lines = [_clean_line(line) for line in str(text or "").splitlines()]
    candidates: list[_QuestionCandidate] = []
    warnings: list[str] = []
    chapter_title = ""
    section_title = ""
    source_group = ""
    type_label = ""
    question_type: str | None = None
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line or _is_noise_line(line):
            index += 1
            continue
        if CHAPTER_RE.match(line):
            chapter_title = line
            section_title = ""
            source_group = ""
            type_label = ""
            question_type = None
            index += 1
            continue
        if SECTION_RE.match(line):
            section_title = line
            source_group = ""
            type_label = ""
            question_type = None
            index += 1
            continue
        if line in SECTION_MARKERS:
            source_group = line
            type_label = ""
            question_type = None
            index += 1
            continue
        label_question_type = _label_to_question_type(line)
        if label_question_type:
            type_label = line
            question_type = label_question_type
            index += 1
            continue
        if question_type and QUESTION_START_RE.match(line):
            candidate, index, warning = _consume_question_block(
                lines,
                index,
                chapter_title=chapter_title,
                section_title=section_title,
                source_group=source_group,
                type_label=type_label,
                question_type=question_type,
                source_filename=source_filename,
            )
            if warning:
                warnings.append(warning)
            if candidate is not None:
                candidates.append(candidate)
            continue
        index += 1
    return candidates, warnings


def _consume_answer_block(
    lines: list[str],
    start_index: int,
    *,
    chapter_title: str,
    section_title: str,
    source_group: str,
    type_label: str,
) -> tuple[_AnswerCandidate | None, int]:
    line = lines[start_index]
    answer_match = ANSWER_START_RE.match(line)
    reference_match = REFERENCE_ANSWER_RE.match(line)
    if not answer_match and not reference_match:
        return None, start_index + 1
    match = answer_match or reference_match
    assert match is not None
    number = int(match.group(1))
    answer = (match.group(2) or "").strip() if answer_match else ""
    first_text = (match.group(3) if answer_match else match.group(2)) or ""
    analysis_parts = [_strip_question_prefix(first_text)]
    index = start_index + 1
    while index < len(lines):
        next_line = _clean_line(lines[index])
        if not next_line or _is_noise_line(next_line):
            index += 1
            continue
        if (
            ANSWER_START_RE.match(next_line)
            or REFERENCE_ANSWER_RE.match(next_line)
            or _label_to_question_type(next_line)
            or next_line in SECTION_MARKERS
            or CHAPTER_RE.match(next_line)
            or SECTION_RE.match(next_line)
        ):
            break
        analysis_parts.append(next_line)
        index += 1
    analysis = " ".join(part for part in analysis_parts if part).strip()
    if not answer:
        answer = analysis
    return (
        _AnswerCandidate(
            answer=answer,
            analysis=analysis,
            chapter_title=chapter_title,
            section_title=section_title,
            source_group=source_group,
            type_label=type_label,
            number=number,
        ),
        index,
    )


def _parse_answer_candidates(text: str) -> list[_AnswerCandidate]:
    lines = [_clean_line(line) for line in str(text or "").splitlines()]
    candidates: list[_AnswerCandidate] = []
    chapter_title = ""
    section_title = ""
    source_group = ""
    type_label = ""
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line or _is_noise_line(line):
            index += 1
            continue
        if CHAPTER_RE.match(line):
            chapter_title = line
            section_title = ""
            source_group = ""
            type_label = ""
            index += 1
            continue
        if SECTION_RE.match(line):
            section_title = line
            source_group = ""
            type_label = ""
            index += 1
            continue
        if line in SECTION_MARKERS:
            source_group = line
            type_label = ""
            index += 1
            continue
        if _label_to_question_type(line):
            type_label = line
            index += 1
            continue
        if ANSWER_START_RE.match(line) or REFERENCE_ANSWER_RE.match(line):
            candidate, index = _consume_answer_block(
                lines,
                index,
                chapter_title=chapter_title,
                section_title=section_title,
                source_group=source_group,
                type_label=type_label,
            )
            if candidate is not None:
                candidates.append(candidate)
            continue
        index += 1
    return candidates


def parse_manual_text_quiz_pairs(
    *,
    question_text: str,
    answer_text: str,
    source_filename: str = "",
) -> tuple[list[ParsedManualQuestion], list[str]]:
    questions, question_warnings = _parse_question_candidates(
        question_text,
        source_filename=source_filename,
    )
    answers = _parse_answer_candidates(answer_text)
    answer_by_key: dict[tuple[str, str, str, str, int], _AnswerCandidate] = {}
    answer_by_loose_key: dict[tuple[str, str, str, int], _AnswerCandidate] = {}
    answer_by_section_type_number: dict[tuple[str, str, int], _AnswerCandidate | None] = {}
    answer_by_section_number: dict[tuple[str, int], _AnswerCandidate | None] = {}
    for answer in answers:
        answer_by_key[
            _match_context_key(
                chapter_title=answer.chapter_title,
                section_title=answer.section_title,
                source_group=answer.source_group,
                type_label=answer.type_label,
                number=answer.number,
            )
        ] = answer
        answer_by_loose_key[
            _loose_context_key(
                section_title=answer.section_title,
                source_group=answer.source_group,
                type_label=answer.type_label,
                number=answer.number,
            )
        ] = answer
        if answer.section_title:
            _append_unique_lookup(
                answer_by_section_type_number,
                (
                    _clean_line(answer.section_title),
                    _type_family(answer.type_label),
                    answer.number,
                ),
                answer,
            )
            _append_unique_lookup(
                answer_by_section_number,
                (_clean_line(answer.section_title), answer.number),
                answer,
            )

    parsed: list[ParsedManualQuestion] = []
    warnings: list[str] = list(question_warnings)
    for question in questions:
        strict_key = _match_context_key(
            chapter_title=question.chapter_title,
            section_title=question.section_title,
            source_group=question.source_group,
            type_label=question.type_label,
            number=question.number,
        )
        loose_key = _loose_context_key(
            section_title=question.section_title,
            source_group=question.source_group,
            type_label=question.type_label,
            number=question.number,
        )
        matched_answer: _AnswerCandidate | None = (
            answer_by_key.get(strict_key) or answer_by_loose_key.get(loose_key)
        )
        if matched_answer is None and question.section_title:
            matched_answer = answer_by_section_type_number.get(
                (
                    _clean_line(question.section_title),
                    _type_family(question.type_label),
                    question.number,
                )
            )
        if matched_answer is None and question.section_title:
            matched_answer = answer_by_section_number.get(
                (_clean_line(question.section_title), question.number)
            )
        if matched_answer is None:
            warnings.append(
                f"{question.section_title or question.chapter_title} {question.type_label}"
                f" 第 {question.number} 题没有匹配到答案，已跳过。"
            )
            continue
        if question.question_type == "multiple_choice" and matched_answer.answer not in {
            option["id"] for option in question.options
        }:
            warnings.append(
                f"{question.section_title or question.chapter_title} {question.type_label}"
                f" 第 {question.number} 题答案不在选项中，已跳过。"
            )
            continue
        parsed.append(
            ParsedManualQuestion(
                question_type=question.question_type,
                stem=question.stem,
                options=question.options,
                answer=matched_answer.answer,
                analysis=matched_answer.analysis,
                chapter_title=question.chapter_title,
                section_title=question.section_title,
                source_group=question.source_group,
                type_label=question.type_label,
                number=question.number,
                source_filename=question.source_filename,
            )
        )
    return parsed, warnings


__all__ = [
    "ParsedManualQuestion",
    "parse_manual_text_quiz_pairs",
]
