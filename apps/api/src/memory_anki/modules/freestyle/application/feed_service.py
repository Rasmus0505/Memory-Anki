from __future__ import annotations

from collections import OrderedDict
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session, load_only, selectinload

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.knowledge import Chapter
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    ReviewSchedule,
)
from memory_anki.modules.english.api import get_recent_unfinished_course_payload
from memory_anki.modules.english_reading.api import list_recent_materials
from memory_anki.modules.palaces.api import resolve_palace_title
from memory_anki.modules.reviews.api import is_schedule_due

from .card_context import palace_context
from .quiz_cards import CONTENT_TYPE_QUIZ_QUESTION, build_quiz_cards

FREESTYLE_RANGE_ALL = "all"
FREESTYLE_RANGE_DUE = "due"
FREESTYLE_RANGE_NEEDS_PRACTICE = "needs_practice"
FREESTYLE_RANGE_SPECIFIC_PALACES = "specific_palaces"
FREESTYLE_RANGE_WRONG = "wrong"

FREESTYLE_RANGES = {
    FREESTYLE_RANGE_ALL,
    FREESTYLE_RANGE_DUE,
    FREESTYLE_RANGE_NEEDS_PRACTICE,
    FREESTYLE_RANGE_SPECIFIC_PALACES,
    FREESTYLE_RANGE_WRONG,
}

CONTENT_TYPE_REVIEW = "review"
CONTENT_TYPE_PRACTICE = "practice"
CONTENT_TYPE_ENGLISH = "english"
CONTENT_TYPE_ENGLISH_READING = "english_reading"

FEED_CONTENT_TYPE_WEIGHTS = {
    CONTENT_TYPE_REVIEW: 50,
    CONTENT_TYPE_QUIZ_QUESTION: 40,
    CONTENT_TYPE_PRACTICE: 30,
    CONTENT_TYPE_ENGLISH: 20,
    CONTENT_TYPE_ENGLISH_READING: 10,
}

QUIZ_DUE_PRIORITY = 96
QUIZ_PRACTICE_PRIORITY = 66
QUIZ_DEFAULT_PRIORITY = 60

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
        )
        .filter(
            Palace.archived == False,
            Palace.deleted_at.is_(None),
        )
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
        .options(
            load_only(
                ReviewSchedule.id,
                ReviewSchedule.palace_id,
                ReviewSchedule.scheduled_date,
                ReviewSchedule.scheduled_at,
                ReviewSchedule.completed,
                ReviewSchedule.review_number,
                ReviewSchedule.review_type,
                ReviewSchedule.anchor_date,
            )
        )
        .join(Palace)
        .filter(
            ReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
            Palace.deleted_at.is_(None),
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
        if any(bool(getattr(item, "needs_practice", False)) for item in palace.mini_palaces or []):
            ids.add(palace.id)
    return ids


def _build_review_cards(
    session: Session,
    *,
    candidate_ids: set[int] | None,
    range_filter: str,
) -> list[dict[str, Any]]:
    if range_filter in (FREESTYLE_RANGE_NEEDS_PRACTICE, FREESTYLE_RANGE_WRONG):
        return []
    now = datetime.now()
    groups: OrderedDict[int, dict[str, Any]] = OrderedDict()
    query = (
        session.query(ReviewSchedule)
        .options(
            load_only(
                ReviewSchedule.id,
                ReviewSchedule.palace_id,
                ReviewSchedule.scheduled_date,
                ReviewSchedule.scheduled_at,
                ReviewSchedule.completed,
                ReviewSchedule.review_number,
                ReviewSchedule.review_type,
                ReviewSchedule.anchor_date,
            )
        )
        .join(Palace)
        .filter(
            ReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
            Palace.deleted_at.is_(None),
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
    if range_filter in (FREESTYLE_RANGE_DUE, FREESTYLE_RANGE_WRONG):
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
                    title=f"加强练习：{palace_title}",
                    subtitle="这个宫殿被标记为需要练习",
                    href=f"/palaces/{palace.id}/practice",
                    priority=72,
                    reason="需要练习",
                    palace=palace,
                )
            )
        for mini_palace in palace.mini_palaces or []:
            if not bool(getattr(mini_palace, "needs_practice", False)):
                continue
            name = mini_palace.name or f"迷你宫殿训练 {mini_palace.sort_order + 1}"
            cards.append(
                _action_card(
                    card_id=f"practice:mini:{mini_palace.id}",
                    content_type=CONTENT_TYPE_PRACTICE,
                    action_kind="mini_practice",
                    title=f"迷你宫殿训练：{name}",
                    subtitle=palace_title,
                    href=f"/mini-palaces/{mini_palace.id}/practice",
                    priority=68,
                    reason="迷你宫殿训练需要练习",
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
    materials = list_recent_materials(session, limit=6)
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


def _card_palace_id(card: dict[str, Any]) -> int | None:
    context = card.get("palace_context")
    if not isinstance(context, dict):
        return None
    palace_id = context.get("id")
    if palace_id is None:
        return None
    try:
        return int(palace_id)
    except (TypeError, ValueError):
        return None


def _feed_card_identity(card: dict[str, Any]) -> str:
    if card.get("type") == "quiz_question":
        question = card.get("question")
        if isinstance(question, dict):
            question_id = question.get("id")
            if question_id is not None:
                return f"quiz_question:{question_id}"
    return str(card.get("id") or "")


def _feed_card_action_priority(
    card: dict[str, Any],
    *,
    due_ids: set[int],
    practice_ids: set[int],
) -> int:
    if card.get("type") == "action":
        try:
            return int(card.get("priority") or 0)
        except (TypeError, ValueError):
            return 0

    if card.get("type") != "quiz_question":
        return 0

    palace_id = _card_palace_id(card)
    if palace_id in due_ids:
        return QUIZ_DUE_PRIORITY
    if palace_id in practice_ids:
        return QUIZ_PRACTICE_PRIORITY
    return QUIZ_DEFAULT_PRIORITY


def _feed_due_rank(card: dict[str, Any], *, due_ids: set[int]) -> int:
    priority = _feed_card_action_priority(card, due_ids=due_ids, practice_ids=set())
    if card.get("content_type") == CONTENT_TYPE_REVIEW and priority >= 110:
        return 2
    if card.get("content_type") == CONTENT_TYPE_REVIEW and priority >= 100:
        return 1
    palace_id = _card_palace_id(card)
    return 1 if palace_id in due_ids else 0


def _feed_type_weight(card: dict[str, Any]) -> int:
    return FEED_CONTENT_TYPE_WEIGHTS.get(str(card.get("content_type") or ""), 0)


def _feed_rank(
    card: dict[str, Any],
    *,
    due_ids: set[int],
    practice_ids: set[int],
) -> tuple[int, int, int]:
    return (
        _feed_card_action_priority(card, due_ids=due_ids, practice_ids=practice_ids),
        _feed_due_rank(card, due_ids=due_ids),
        _feed_type_weight(card),
    )


def _dedupe_and_sort_feed_cards(
    cards: list[dict[str, Any]],
    *,
    due_ids: set[int],
    practice_ids: set[int],
) -> list[dict[str, Any]]:
    best_by_identity: dict[str, tuple[int, dict[str, Any]]] = {}
    anonymous_cards: list[tuple[int, dict[str, Any]]] = []

    for index, card in enumerate(cards):
        identity = _feed_card_identity(card)
        if not identity:
            anonymous_cards.append((index, card))
            continue
        existing = best_by_identity.get(identity)
        if existing is None:
            best_by_identity[identity] = (index, card)
            continue
        existing_index, existing_card = existing
        if _feed_rank(card, due_ids=due_ids, practice_ids=practice_ids) > _feed_rank(
            existing_card,
            due_ids=due_ids,
            practice_ids=practice_ids,
        ):
            best_by_identity[identity] = (existing_index, card)

    ranked_cards = [*best_by_identity.values(), *anonymous_cards]
    ranked_cards.sort(
        key=lambda item: (
            -_feed_card_action_priority(item[1], due_ids=due_ids, practice_ids=practice_ids),
            -_feed_due_rank(item[1], due_ids=due_ids),
            -_feed_type_weight(item[1]),
            item[0],
            str(item[1].get("id") or ""),
        )
    )
    return [card for _, card in ranked_cards]


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
                wrong_range=FREESTYLE_RANGE_WRONG,
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

    cards = _dedupe_and_sort_feed_cards(cards, due_ids=due_ids, practice_ids=practice_ids)

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
