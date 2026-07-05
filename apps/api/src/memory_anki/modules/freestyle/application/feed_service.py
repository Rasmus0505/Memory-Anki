from __future__ import annotations

from collections import OrderedDict
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session, selectinload

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import (
    Chapter,
    Palace,
    PalaceQuizQuestion,
    ReviewSchedule,
)
from memory_anki.modules.english.application.course_service import (
    get_recent_unfinished_course_payload,
)
from memory_anki.modules.english_reading.application import service as english_reading_service
from memory_anki.modules.palaces.application.focus_service import parse_focus_node_uids
from memory_anki.modules.palaces.application.title_sync_service import resolve_palace_title
from memory_anki.modules.reviews.application.schedule_service import is_schedule_due

from .card_context import palace_context
from .quiz_cards import CONTENT_TYPE_QUIZ_QUESTION, build_quiz_cards

FREESTYLE_RANGE_ALL = "all"
FREESTYLE_RANGE_DUE = "due"
FREESTYLE_RANGE_NEEDS_PRACTICE = "needs_practice"
FREESTYLE_RANGE_SPECIFIC_PALACES = "specific_palaces"

FREESTYLE_RANGES = {
    FREESTYLE_RANGE_ALL,
    FREESTYLE_RANGE_DUE,
    FREESTYLE_RANGE_NEEDS_PRACTICE,
    FREESTYLE_RANGE_SPECIFIC_PALACES,
}

CONTENT_TYPE_REVIEW = "review"
CONTENT_TYPE_PRACTICE = "practice"
CONTENT_TYPE_ENGLISH = "english"
CONTENT_TYPE_ENGLISH_READING = "english_reading"

FREESTYLE_CONTENT_TYPES = {
    CONTENT_TYPE_QUIZ_QUESTION,
    CONTENT_TYPE_REVIEW,
    CONTENT_TYPE_PRACTICE,
    CONTENT_TYPE_ENGLISH,
    CONTENT_TYPE_ENGLISH_READING,
}

DEFAULT_FREESTYLE_CONTENT_TYPES = {
    CONTENT_TYPE_QUIZ_QUESTION,
    CONTENT_TYPE_REVIEW,
    CONTENT_TYPE_PRACTICE,
    CONTENT_TYPE_ENGLISH,
    CONTENT_TYPE_ENGLISH_READING,
}


def parse_csv_values(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def parse_palace_ids(value: str | None) -> list[int]:
    result: list[int] = []
    seen: set[int] = set()
    for item in parse_csv_values(value):
        try:
            palace_id = int(item)
        except ValueError as exc:
            raise ValueError(f"invalid palace_id: {item}") from exc
        if palace_id <= 0 or palace_id in seen:
            continue
        seen.add(palace_id)
        result.append(palace_id)
    return result


def normalize_content_types(value: str | None) -> set[str]:
    items = parse_csv_values(value)
    if not items:
        return set(DEFAULT_FREESTYLE_CONTENT_TYPES)
    unknown = [item for item in items if item not in FREESTYLE_CONTENT_TYPES]
    if unknown:
        raise ValueError(f"invalid content_types: {', '.join(unknown)}")
    return set(items)


def normalize_range(value: str | None) -> str:
    normalized = str(value or FREESTYLE_RANGE_ALL).strip() or FREESTYLE_RANGE_ALL
    if normalized not in FREESTYLE_RANGES:
        raise ValueError(f"invalid range: {normalized}")
    return normalized


def _action_card(
    *,
    card_id: str,
    content_type: str,
    action_kind: str,
    title: str,
    subtitle: str,
    href: str,
    priority: int,
    reason: str,
    palace: Palace | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "id": card_id,
        "type": "action",
        "content_type": content_type,
        "action_kind": action_kind,
        "title": title,
        "subtitle": subtitle,
        "href": href,
        "priority": priority,
        "reason": reason,
    }
    if palace is not None:
        payload["palace_context"] = palace_context(palace)
    if extra:
        payload.update(extra)
    return payload


def _load_active_palaces(
    session: Session,
    *,
    specific_palace_ids: list[int],
    range_filter: str,
) -> list[Palace]:
    query = (
        session.query(Palace)
        .options(
            selectinload(Palace.chapters).selectinload(Chapter.subject),
            selectinload(Palace.quiz_questions).selectinload(PalaceQuizQuestion.mini_palace),
            selectinload(Palace.mini_palaces),
            selectinload(Palace.segments),
            selectinload(Palace.review_schedules),
        )
        .filter(Palace.archived == False)
        .order_by(Palace.group_sort_order.asc(), Palace.id.asc())
    )
    if range_filter == FREESTYLE_RANGE_SPECIFIC_PALACES:
        if not specific_palace_ids:
            return []
        query = query.filter(Palace.id.in_(specific_palace_ids))
    return query.all()


def _due_palace_ids(session: Session, candidate_ids: set[int] | None) -> set[int]:
    now = datetime.now()
    ids: set[int] = set()
    review_query = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
        )
    )
    if candidate_ids is not None:
        if not candidate_ids:
            return ids
        review_query = review_query.filter(ReviewSchedule.palace_id.in_(candidate_ids))
    schedules = review_query.order_by(ReviewSchedule.review_number.asc(), ReviewSchedule.id.asc()).all()
    for schedule in schedules:
        if schedule.palace and is_schedule_due(schedule, schedule.palace, session, now=now):
            ids.add(schedule.palace_id)

    return ids


def _practice_palace_ids(palaces: list[Palace]) -> set[int]:
    ids: set[int] = set()
    for palace in palaces:
        if bool(getattr(palace, "needs_practice", False)):
            ids.add(palace.id)
        if parse_focus_node_uids(palace):
            ids.add(palace.id)
        if any(bool(getattr(item, "needs_practice", False)) for item in palace.mini_palaces or []):
            ids.add(palace.id)
    return ids


def _build_review_cards(
    session: Session,
    *,
    candidate_ids: set[int] | None,
    range_filter: str,
) -> list[dict[str, Any]]:
    if range_filter == FREESTYLE_RANGE_NEEDS_PRACTICE:
        return []
    now = datetime.now()
    groups: OrderedDict[int, dict[str, Any]] = OrderedDict()
    query = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
        )
    )
    if candidate_ids is not None:
        if not candidate_ids:
            return []
        query = query.filter(ReviewSchedule.palace_id.in_(candidate_ids))
    schedules = query.order_by(ReviewSchedule.review_number.asc(), ReviewSchedule.id.asc()).all()
    for schedule in schedules:
        if not schedule.palace or not is_schedule_due(schedule, schedule.palace, session, now=now):
            continue
        group = groups.setdefault(
            schedule.palace_id,
            {"schedule": schedule, "count": 0, "overdue": 0},
        )
        group["count"] += 1
        due_at = schedule.scheduled_at or datetime.combine(schedule.scheduled_date, datetime.min.time())
        if due_at.date() < now.date():
            group["overdue"] += 1
        current = group["schedule"]
        if (schedule.review_number, schedule.id) < (current.review_number, current.id):
            group["schedule"] = schedule

    cards: list[dict[str, Any]] = []
    for group in groups.values():
        schedule = group["schedule"]
        palace = schedule.palace
        palace_title = resolve_palace_title(palace)
        overdue = int(group["overdue"])
        cards.append(
            _action_card(
                card_id=f"review:{schedule.id}",
                content_type=CONTENT_TYPE_REVIEW,
                action_kind="review",
                title=f"正式复习：{palace_title}",
                subtitle=f"第 {schedule.review_number + 1} 轮 · {int(group['count'])} 个待复习",
                href=f"/review/session/{schedule.id}",
                priority=110 if overdue else 100,
                reason=f"{overdue} 个逾期复习" if overdue else "今天待复习",
                palace=palace,
                extra={"schedule_id": schedule.id},
            )
        )
    return cards


def _build_practice_cards(
    palaces: list[Palace],
    *,
    candidate_ids: set[int] | None,
    range_filter: str,
) -> list[dict[str, Any]]:
    if range_filter == FREESTYLE_RANGE_DUE:
        return []
    cards: list[dict[str, Any]] = []
    for palace in palaces:
        if candidate_ids is not None and palace.id not in candidate_ids:
            continue
        palace_title = resolve_palace_title(palace)
        if bool(getattr(palace, "needs_practice", False)):
            cards.append(
                _action_card(
                    card_id=f"practice:palace:{palace.id}",
                    content_type=CONTENT_TYPE_PRACTICE,
                    action_kind="practice",
                    title=f"专项练习：{palace_title}",
                    subtitle="这个宫殿被标记为需要练习",
                    href=f"/palaces/{palace.id}/practice",
                    priority=72,
                    reason="需要练习",
                    palace=palace,
                )
            )
        focus_count = len(parse_focus_node_uids(palace))
        if focus_count > 0:
            cards.append(
                _action_card(
                    card_id=f"practice:focus:{palace.id}",
                    content_type=CONTENT_TYPE_PRACTICE,
                    action_kind="focus_practice",
                    title=f"重点练习：{palace_title}",
                    subtitle=f"{focus_count} 个重点节点",
                    href=f"/palaces/{palace.id}/focus-practice",
                    priority=70,
                    reason="重点节点",
                    palace=palace,
                )
            )
        for mini_palace in palace.mini_palaces or []:
            if not bool(getattr(mini_palace, "needs_practice", False)):
                continue
            name = mini_palace.name or f"小宫殿 {mini_palace.sort_order + 1}"
            cards.append(
                _action_card(
                    card_id=f"practice:mini:{mini_palace.id}",
                    content_type=CONTENT_TYPE_PRACTICE,
                    action_kind="mini_practice",
                    title=f"小宫殿练习：{name}",
                    subtitle=palace_title,
                    href=f"/mini-palaces/{mini_palace.id}/practice",
                    priority=68,
                    reason="小宫殿需要练习",
                    palace=palace,
                    extra={
                        "mini_palace_id": mini_palace.id,
                        "mini_palace_name": name,
                    },
                )
            )
    return cards


def _build_english_card_from_course(session: Session, range_filter: str) -> list[dict[str, Any]]:
    if range_filter != FREESTYLE_RANGE_ALL:
        return []
    course = get_recent_unfinished_course_payload(session)
    if not course:
        return []
    sentence_count = int(course.get("sentenceCount") or 0)
    current_index = int(course.get("currentSentenceIndex") or 0)
    return [
        _action_card(
            card_id=f"english:{course.get('id')}",
            content_type=CONTENT_TYPE_ENGLISH,
            action_kind="english",
            title=f"继续英语听力：{course.get('title') or '未命名课程'}",
            subtitle=f"{current_index}/{sentence_count} 句",
            href=f"/english/courses/{course.get('id')}",
            priority=56,
            reason="最近未完成课程",
            extra={"course": course},
        )
    ]


def _build_english_reading_cards(session: Session, range_filter: str) -> list[dict[str, Any]]:
    if range_filter != FREESTYLE_RANGE_ALL:
        return []
    materials = english_reading_service.list_recent_materials(session, limit=6)
    cards: list[dict[str, Any]] = []
    for material in materials:
        if material.get("latestVersionId") is None:
            continue
        cards.append(
            _action_card(
                card_id=f"english_reading:{material.get('id')}",
                content_type=CONTENT_TYPE_ENGLISH_READING,
                action_kind="english_reading",
                title=f"继续英语阅读：{material.get('title') or '未命名材料'}",
                subtitle=f"{int(material.get('wordCount') or 0)} 词",
                href=f"/english-reading?material={material.get('id')}",
                priority=48,
                reason="最近生成的阅读材料",
                extra={"material": material},
            )
        )
        if len(cards) >= 3:
            break
    return cards


def build_freestyle_feed(
    session: Session,
    *,
    range_value: str = FREESTYLE_RANGE_ALL,
    palace_ids_value: str | None = None,
    content_types_value: str | None = None,
) -> dict[str, Any]:
    range_filter = normalize_range(range_value)
    specific_palace_ids = parse_palace_ids(palace_ids_value)
    content_types = normalize_content_types(content_types_value)

    palaces = _load_active_palaces(
        session,
        specific_palace_ids=specific_palace_ids,
        range_filter=range_filter,
    )
    candidate_ids = {palace.id for palace in palaces}
    candidate_filter = candidate_ids if range_filter == FREESTYLE_RANGE_SPECIFIC_PALACES else None
    due_ids = _due_palace_ids(session, candidate_filter)
    practice_ids = _practice_palace_ids(palaces)

    cards: list[dict[str, Any]] = []
    if CONTENT_TYPE_QUIZ_QUESTION in content_types:
        cards.extend(
            build_quiz_cards(
                session,
                palaces,
                range_filter=range_filter,
                due_ids=due_ids,
                practice_ids=practice_ids,
                due_range=FREESTYLE_RANGE_DUE,
                needs_practice_range=FREESTYLE_RANGE_NEEDS_PRACTICE,
            )
        )
    if CONTENT_TYPE_REVIEW in content_types:
        cards.extend(
            _build_review_cards(
                session,
                candidate_ids=candidate_filter,
                range_filter=range_filter,
            )
        )
    if CONTENT_TYPE_PRACTICE in content_types:
        practice_candidate_ids = (
            candidate_filter
            if range_filter == FREESTYLE_RANGE_SPECIFIC_PALACES
            else practice_ids
            if range_filter == FREESTYLE_RANGE_NEEDS_PRACTICE
            else None
        )
        cards.extend(
            _build_practice_cards(
                palaces,
                candidate_ids=practice_candidate_ids,
                range_filter=range_filter,
            )
        )
    if CONTENT_TYPE_ENGLISH in content_types:
        cards.extend(_build_english_card_from_course(session, range_filter))
    if CONTENT_TYPE_ENGLISH_READING in content_types:
        cards.extend(_build_english_reading_cards(session, range_filter))

    counts = {content_type: 0 for content_type in FREESTYLE_CONTENT_TYPES}
    for card in cards:
        content_type = str(card.get("content_type") or "")
        if content_type in counts:
            counts[content_type] += 1

    return {
        "cards": cards,
        "counts": counts,
        "generated_at": utc_now_naive().isoformat(timespec="seconds"),
    }
