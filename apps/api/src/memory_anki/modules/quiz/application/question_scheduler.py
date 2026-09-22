"""Question due-date helpers and the legacy quiz-mark rule. Framework-free.

Quiz practice no longer writes 忘记/困难/记得/轻松 or a review schedule. Historical
`schedule_due_on` rows stay so the freestyle overlay "due" range can still read
them. A new mark does not change those columns or palace review units.

Only the latest schedule was stored. 忘记/困难 left the question unpassed with a
due date; 记得/轻松 set `schedule_passed`; a never-rated question has no due date.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

DUE_KIND_DUE = "due"
DUE_KIND_OTHER = "other"
OVERLAY_QUESTION_RANGE_DUE = "due"
OVERLAY_QUESTION_RANGE_ALL = "all"
OVERLAY_QUESTION_RANGES = {OVERLAY_QUESTION_RANGE_DUE, OVERLAY_QUESTION_RANGE_ALL}


def legacy_unpassed_due_counts_as_marked(
    *,
    schedule_passed: bool,
    schedule_due_on: Any,
) -> bool:
    """True when the last stored quiz rating was 忘记 or 困难."""
    if schedule_due_on is None:
        return False
    if isinstance(schedule_due_on, str) and not schedule_due_on.strip():
        return False
    return not bool(schedule_passed)


def parse_due_on(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    text = str(value).strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def schedule_due_kind(due_on: date | None, *, today: date | None = None) -> str:
    current = today or date.today()
    if due_on is not None and due_on <= current:
        return DUE_KIND_DUE
    return DUE_KIND_OTHER


def question_is_due(payload: Any, *, today: date | None = None) -> bool:
    if not isinstance(payload, dict):
        return False
    return schedule_due_kind(parse_due_on(payload.get("schedule_due_on")), today=today) == DUE_KIND_DUE


def normalize_overlay_question_range(value: Any) -> str:
    key = str(value or "").strip()
    if key in OVERLAY_QUESTION_RANGES:
        return key
    return OVERLAY_QUESTION_RANGE_ALL
