"""Serialization helpers for English topic patterns."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.english import (
    EnglishPatternPrompt,
    EnglishPatternSentence,
    EnglishTopicPattern,
)
from memory_anki.modules.english.application.pattern_fsrs import is_sentence_due
from memory_anki.modules.memory.public.queries import RATING_LABELS

WHITESPACE_RE = re.compile(r"\s+")
DEFAULT_PROMPT_COUNT = 6
DEFAULT_VIEWPOINTS_PER_PROMPT = 2
TARGET_SENTENCE_COUNT = DEFAULT_PROMPT_COUNT * DEFAULT_VIEWPOINTS_PER_PROMPT


def clean_text(value: str | None, *, limit: int) -> str:
    return WHITESPACE_RE.sub(" ", str(value or "")).strip()[:limit]


def dump_json_list(values: list[Any]) -> str:
    cleaned = [clean_text(str(v), limit=240) for v in values if str(v or "").strip()]
    return json.dumps(cleaned, ensure_ascii=False)


def load_json_list(raw: str | None) -> list[str]:
    try:
        data = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    return [str(item).strip() for item in data if str(item).strip()]


def serialize_pattern_sentence(
    row: EnglishPatternSentence,
    *,
    now: datetime,
    pattern_title: str = "",
) -> dict[str, Any]:
    due_at = row.due_at or row.next_due_at
    return {
        "id": row.id,
        "patternId": row.pattern_id,
        "promptId": row.prompt_id,
        "patternTitle": pattern_title,
        "sentenceIndex": int(row.sentence_index or 0),
        "textEn": row.text_en,
        "textZh": row.text_zh,
        "slots": load_json_list(row.slots_json),
        "collocations": load_json_list(row.collocations_json),
        "note": row.note,
        "source": row.source,
        "sourceCourseId": row.source_course_id,
        "sourceSentenceId": row.source_sentence_id,
        "sourceMaterialId": row.source_material_id,
        "sourceVersionId": row.source_version_id,
        "status": row.status,
        "reviewNumber": int(row.review_number or 0),
        "reviewCount": int(row.review_count or 0),
        "correctCount": int(row.correct_count or 0),
        "incorrectCount": int(row.incorrect_count or 0),
        "nextDueDate": (
            (due_at.date().isoformat() if due_at else None)
            or (row.next_due_date.isoformat() if row.next_due_date else None)
        ),
        "nextDueAt": due_at.isoformat() if due_at else None,
        "intervalDays": int(row.interval_days or 0),
        "reviewType": "fsrs",
        "algorithmUsed": "FSRS",
        "anchorDate": row.anchor_date.isoformat() if row.anchor_date else None,
        "lastReviewedAt": row.last_reviewed_at.isoformat() if row.last_reviewed_at else None,
        "stability": row.stability,
        "difficulty": row.difficulty,
        "state": int(row.fsrs_state or 1),
        "desiredRetention": float(row.desired_retention or 0.9),
        "ratingLabels": RATING_LABELS,
        "isDue": is_sentence_due(row, now),
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


def serialize_pattern_summary(
    session: Session,
    row: EnglishTopicPattern,
    *,
    now: datetime,
) -> dict[str, Any]:
    filled = (
        session.query(EnglishPatternSentence)
        .filter(
            EnglishPatternSentence.pattern_id == row.id,
            EnglishPatternSentence.status == "active",
            EnglishPatternSentence.text_en != "",
        )
        .count()
    )
    total_slots = (
        session.query(EnglishPatternSentence)
        .filter(
            EnglishPatternSentence.pattern_id == row.id,
            EnglishPatternSentence.status == "active",
        )
        .count()
    )
    due_count = (
        session.query(EnglishPatternSentence)
        .filter(
            EnglishPatternSentence.pattern_id == row.id,
            EnglishPatternSentence.status == "active",
            EnglishPatternSentence.text_en != "",
            _due_clause(now),
        )
        .count()
    )
    prompt_count = (
        session.query(EnglishPatternPrompt)
        .filter(EnglishPatternPrompt.pattern_id == row.id)
        .count()
    )
    return {
        "id": row.id,
        "title": row.title,
        "tags": load_json_list(row.tags_json),
        "notes": row.notes,
        "status": row.status,
        "promptCount": int(prompt_count),
        "sentenceCount": int(filled),
        "slotCount": int(total_slots),
        "targetSentenceCount": TARGET_SENTENCE_COUNT,
        "dueCount": int(due_count),
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


def serialize_pattern_detail(
    row: EnglishTopicPattern,
    *,
    now: datetime,
) -> dict[str, Any]:
    prompts_payload: list[dict[str, Any]] = []
    filled = 0
    due_count = 0
    for prompt in sorted(row.prompts, key=lambda p: (p.prompt_index, p.id)):
        sentences_payload = []
        for sentence in sorted(prompt.sentences, key=lambda s: (s.sentence_index, s.id)):
            item = serialize_pattern_sentence(sentence, now=now, pattern_title=row.title)
            item["promptTextEn"] = prompt.text_en
            item["promptTextZh"] = prompt.text_zh
            sentences_payload.append(item)
            if str(sentence.text_en or "").strip():
                filled += 1
            if is_sentence_due(sentence, now) and str(sentence.text_en or "").strip():
                due_count += 1
        prompts_payload.append(
            {
                "id": prompt.id,
                "patternId": prompt.pattern_id,
                "promptIndex": int(prompt.prompt_index or 0),
                "textEn": prompt.text_en,
                "textZh": prompt.text_zh,
                "sentences": sentences_payload,
                "createdAt": prompt.created_at.isoformat() if prompt.created_at else None,
                "updatedAt": prompt.updated_at.isoformat() if prompt.updated_at else None,
            }
        )
    return {
        "id": row.id,
        "title": row.title,
        "tags": load_json_list(row.tags_json),
        "notes": row.notes,
        "status": row.status,
        "promptCount": len(prompts_payload),
        "sentenceCount": filled,
        "slotCount": sum(len(p["sentences"]) for p in prompts_payload),
        "targetSentenceCount": TARGET_SENTENCE_COUNT,
        "dueCount": due_count,
        "prompts": prompts_payload,
        "createdAt": row.created_at.isoformat() if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() if row.updated_at else None,
    }


def _due_clause(now: datetime):
    from memory_anki.modules.english.application.pattern_fsrs import sentence_due_filter

    return sentence_due_filter(now)
