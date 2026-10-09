"""Pure construction and normalization rules for freestyle round plans."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .learning_time import empty_learning_time, normalize_learning_time
from .overlay_quiz import normalize_overlay_quiz
from .round_plan_values import (
    _day,
    _find_occurrence,
    _int,
    _palace_id,
    _text,
    _unique,
)

RETRY_GAP = 3
OCCURRENCE_PENDING = "pending"
OCCURRENCE_INSERTED = "inserted"
OCCURRENCE_COMPLETED = "completed"
OCCURRENCE_CANCELLED = "cancelled"

Plan = dict[str, Any]


def _partial_settlements(raw: Any) -> list[dict[str, Any]]:
    """Keep confirmed 小结算 snapshots for the closing 大结算."""
    if not isinstance(raw, Sequence) or isinstance(raw, str | bytes):
        return []
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, Mapping) or len(result) >= 40:
            continue
        settlement_id = _text(item.get("id"))
        card_ids = _unique(item.get("card_ids") or [])
        if not settlement_id or not card_ids or settlement_id in seen:
            continue
        seen.add(settlement_id)
        subjects: list[dict[str, Any]] = []
        raw_subjects = item.get("by_subject")
        if isinstance(raw_subjects, Sequence) and not isinstance(raw_subjects, str | bytes):
            for subject in list(raw_subjects)[:40]:
                if not isinstance(subject, Mapping):
                    continue
                palaces: list[dict[str, Any]] = []
                raw_palaces = subject.get("palaces")
                if isinstance(raw_palaces, Sequence) and not isinstance(raw_palaces, str | bytes):
                    for palace in list(raw_palaces)[:40]:
                        if not isinstance(palace, Mapping):
                            continue
                        palace_id = _palace_id(palace.get("palace_id")) or 0
                        palaces.append(
                            {
                                "palace_id": palace_id,
                                "palace_title": _text(palace.get("palace_title"))[:80]
                                or (f"宫殿 {palace_id}" if palace_id else "未分类"),
                                "card_count": max(0, _int(palace.get("card_count"))),
                                "effective_seconds": max(0, _int(palace.get("effective_seconds"))),
                            }
                        )
                subjects.append(
                    {
                        "subject_id": _palace_id(subject.get("subject_id")),
                        "subject_name": _text(subject.get("subject_name"))[:80] or "未分类",
                        "palace_count": max(0, _int(subject.get("palace_count"))) or len(palaces),
                        "card_count": max(0, _int(subject.get("card_count"))),
                        "effective_seconds": max(0, _int(subject.get("effective_seconds"))),
                        "palaces": palaces,
                    }
                )
        result.append(
            {
                "id": settlement_id[:80],
                "card_ids": card_ids,
                "card_count": max(len(card_ids), _int(item.get("card_count"))),
                "rated_count": max(0, _int(item.get("rated_count"))),
                "passed_count": max(0, _int(item.get("passed_count"))),
                "retry_count": max(0, _int(item.get("retry_count"))),
                "quiz_count": max(0, _int(item.get("quiz_count"))),
                "total_effective_seconds": max(0, _int(item.get("total_effective_seconds"))),
                "quiz_seconds": max(0, _int(item.get("quiz_seconds"))),
                "by_subject": subjects,
            }
        )
    return result


def empty_plan() -> Plan:
    return {
        "original_cards": [],
        "presented_ids": [],
        "current_card_id": None,
        "current_index": 0,
        "completed_ids": [],
        "excluded_ids": [],
        "compressed_ids": [],
        "partial_settlements": [],
        "occurrences": [],
        "encounters": {},
        "today": "",
        "learning_time": empty_learning_time(),
    }


def snapshot_cards(cards: Sequence[Mapping[str, Any]] | None, *, today: str = "") -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    stamp = _day(today)
    for card in cards or ():
        card_id = _text(card.get("card_id") or card.get("id"))
        if not card_id or card_id in seen or card_id.startswith("retry:") or _text(card.get("occurrence_kind")) == "retry":
            continue
        seen.add(card_id)
        path = card.get("context_path")
        label = _text(card.get("label"))
        if not label and isinstance(path, list) and path:
            last = path[-1]
            if isinstance(last, dict):
                label = _text(last.get("text"))
        result.append(
            {
                "card_id": card_id,
                "unit_id": _text(card.get("unit_id")),
                "unit_revision": _int(card.get("unit_revision")),
                "kind": _text(card.get("kind") or card.get("type")) or "card",
                "palace_id": _palace_id(card.get("palace_id")),
                "palace_title": _text(card.get("palace_title")),
                "label": label or card_id,
                "entered_on": _day(card.get("entered_on")) or stamp,
            }
        )
    return result


def plan_from_cards(cards: Sequence[Mapping[str, Any]] | None, *, today: str = "") -> Plan:
    plan = empty_plan()
    original = snapshot_cards(cards, today=today)
    presented = [item["card_id"] for item in original]
    plan["original_cards"] = original
    plan["presented_ids"] = presented
    plan["current_card_id"] = presented[0] if presented else None
    plan["current_index"] = 0
    plan["today"] = _day(today)
    return plan


def normalize_plan(plan: Mapping[str, Any] | None) -> Plan:
    raw = dict(plan or {})
    original = []
    for item in raw.get("original_cards") or []:
        if not isinstance(item, Mapping):
            continue
        card_id = _text(item.get("card_id"))
        if not card_id:
            continue
        original.append(
            {
                "card_id": card_id,
                "unit_id": _text(item.get("unit_id")),
                "unit_revision": _int(item.get("unit_revision")),
                "kind": _text(item.get("kind")) or "card",
                "palace_id": _palace_id(item.get("palace_id")),
                "palace_title": _text(item.get("palace_title")),
                "label": _text(item.get("label")) or card_id,
                "entered_on": _day(item.get("entered_on")),
            }
        )
    occurrences = []
    for item in raw.get("occurrences") or []:
        if not isinstance(item, Mapping):
            continue
        occurrence_id = _text(item.get("occurrence_id"))
        if not occurrence_id:
            continue
        status = _text(item.get("status")) or OCCURRENCE_PENDING
        if status not in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED, OCCURRENCE_CANCELLED}:
            status = OCCURRENCE_PENDING
        rating = item.get("rating")
        occurrences.append(
            {
                "occurrence_id": occurrence_id,
                "source_card_id": _text(item.get("source_card_id")),
                "source_unit_id": _text(item.get("source_unit_id")),
                "retry_attempt": max(0, _int(item.get("retry_attempt"))),
                "rating": _int(rating) if rating not in (None, "") else None,
                "insert_target_index": max(0, _int(item.get("insert_target_index"))),
                "status": status,
                "encounter_id": _text(item.get("encounter_id")),
                "entered_on": _day(item.get("entered_on")),
            }
        )
    encounters: dict[str, dict[str, Any]] = {}
    raw_encounters = raw.get("encounters") or {}
    if isinstance(raw_encounters, Mapping):
        for key, value in raw_encounters.items():
            card_id = _text(key)
            if not card_id or not isinstance(value, Mapping):
                continue
            encounter = {
                "encounter_id": _text(value.get("encounter_id")),
                "status": _text(value.get("status")) or "open",
                "unit_revision": _int(value.get("unit_revision")),
            }
            rating = _int(value.get("rating"))
            if rating in {1, 2, 3, 4}:
                encounter["rating"] = rating
            encounters[card_id] = encounter
    normalized: Plan = {
        "original_cards": original,
        "presented_ids": _unique(raw.get("presented_ids") or [item["card_id"] for item in original]),
        "current_card_id": _text(raw.get("current_card_id")) if raw.get("current_card_id") not in (None, "") else None,
        "current_index": max(0, _int(raw.get("current_index"))),
        "completed_ids": _unique(raw.get("completed_ids") or []),
        "excluded_ids": _unique(raw.get("excluded_ids") or []),
        "compressed_ids": _unique(raw.get("compressed_ids") or []),
        "partial_settlements": _partial_settlements(raw.get("partial_settlements")),
        "occurrences": occurrences,
        "encounters": encounters,
        "today": _day(raw.get("today")),
        "overlay_quiz": normalize_overlay_quiz(raw.get("overlay_quiz") if isinstance(raw.get("overlay_quiz"), Mapping) else None),
        "learning_time": normalize_learning_time(raw.get("learning_time") if isinstance(raw.get("learning_time"), Mapping) else None),
    }
    held = set(normalized["completed_ids"]) | set(normalized["excluded_ids"]) | set(normalized["compressed_ids"])
    restored = [item for item in _unique(raw.get("restored_ids") or []) if item not in held]
    if restored:
        normalized["restored_ids"] = restored
    _collapse_retries(normalized)
    _strip_compressed(normalized)
    return normalized


def _is_unfinished_for_normalization(plan: Plan, card_id: str) -> bool:
    if not card_id or card_id in plan["completed_ids"] or card_id in plan["excluded_ids"] or card_id in plan["compressed_ids"]:
        return False
    occurrence = _find_occurrence(plan, card_id)
    if occurrence is not None:
        return occurrence["status"] == OCCURRENCE_INSERTED
    live = {OCCURRENCE_INSERTED, OCCURRENCE_COMPLETED}
    return not any(item["source_card_id"] == card_id and item["status"] in live for item in plan["occurrences"])


def _collapse_retries(plan: Plan) -> None:
    by_source: dict[str, list[dict[str, Any]]] = {}
    for item in plan["occurrences"]:
        source = _text(item.get("source_card_id"))
        if source and item["status"] != OCCURRENCE_CANCELLED:
            by_source.setdefault(source, []).append(item)
    drop_ids: set[str] = set()
    current = _text(plan.get("current_card_id"))
    kept_by_dropped: dict[str, str] = {}
    for items in by_source.values():
        if len(items) <= 1:
            continue
        live = [item for item in items if item["status"] in {OCCURRENCE_PENDING, OCCURRENCE_INSERTED}]
        pool = live or items
        keep = next((item for item in pool if item["occurrence_id"] == current), None) or max(
            pool, key=lambda item: (1 if item["status"] == OCCURRENCE_INSERTED else 0, int(item.get("retry_attempt") or 0))
        )
        keep_id = _text(keep.get("occurrence_id"))
        for extra in items:
            extra_id = _text(extra.get("occurrence_id"))
            if extra is keep or not extra_id:
                continue
            extra["status"] = OCCURRENCE_CANCELLED
            drop_ids.add(extra_id)
            kept_by_dropped[extra_id] = keep_id
    if not drop_ids:
        return
    plan["presented_ids"] = [item for item in plan["presented_ids"] if item not in drop_ids]
    plan["completed_ids"] = [item for item in plan["completed_ids"] if item not in drop_ids]
    if current in drop_ids:
        plan["current_card_id"] = kept_by_dropped.get(current) or current


def _strip_compressed(plan: Plan) -> None:
    compressed = set(plan.get("compressed_ids") or [])
    plan["presented_ids"] = [item for item in plan["presented_ids"] if item not in compressed]
    current = _text(plan.get("current_card_id"))
    if current and current not in plan["presented_ids"]:
        plan["current_card_id"] = next((card_id for card_id in plan["presented_ids"] if _is_unfinished_for_normalization(plan, card_id)), None)
    _sync_index(plan)


def _sync_index(plan: Plan) -> None:
    current = _text(plan.get("current_card_id")) if plan.get("current_card_id") else None
    presented = plan["presented_ids"]
    if current and current in presented:
        plan["current_index"] = presented.index(current)
        plan["current_card_id"] = current
        return
    plan["current_card_id"] = current or None
    plan["current_index"] = 0
