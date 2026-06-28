from __future__ import annotations

from collections import OrderedDict
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session, selectinload

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import (
    Chapter,
    Palace,
    PalaceMiniPalace,
    PalaceMiniPalaceReviewSchedule,
    PalaceQuizQuestion,
    PalaceSegment,
    PalaceSegmentReviewSchedule,
    ReviewSchedule,
)
from memory_anki.modules.english.application.course_service import (
    get_recent_unfinished_course_payload,
)
from memory_anki.modules.english_reading.application import service as english_reading_service
from memory_anki.modules.palace_quiz.application.question_schema import serialize_question
from memory_anki.modules.palaces.application.focus_service import parse_focus_node_uids
from memory_anki.modules.palaces.application.mini_palace_service import (
    is_mini_palace_schedule_due,
)
from memory_anki.modules.palaces.application.segment_review_service import (
    is_segment_schedule_due,
)
from memory_anki.modules.palaces.application.title_sync_service import (
    get_palace_explicit_chapter_ids,
    resolve_palace_subject,
    resolve_palace_title,
)
from memory_anki.modules.reviews.application.schedule_service import is_schedule_due

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

CONTENT_TYPE_QUIZ_QUESTION = "quiz_question"
CONTENT_TYPE_REVIEW = "review"
CONTENT_TYPE_SEGMENT_REVIEW = "segment_review"
CONTENT_TYPE_MINI_REVIEW = "mini_review"
CONTENT_TYPE_PRACTICE = "practice"
CONTENT_TYPE_ENGLISH = "english"
CONTENT_TYPE_ENGLISH_READING = "english_reading"

FREESTYLE_CONTENT_TYPES = {
    CONTENT_TYPE_QUIZ_QUESTION,
    CONTENT_TYPE_REVIEW,
    CONTENT_TYPE_SEGMENT_REVIEW,
    CONTENT_TYPE_MINI_REVIEW,
    CONTENT_TYPE_PRACTICE,
    CONTENT_TYPE_ENGLISH,
    CONTENT_TYPE_ENGLISH_READING,
}

DEFAULT_FREESTYLE_CONTENT_TYPES = {
    CONTENT_TYPE_QUIZ_QUESTION,
    CONTENT_TYPE_REVIEW,
    CONTENT_TYPE_SEGMENT_REVIEW,
    CONTENT_TYPE_MINI_REVIEW,
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


def _chapter_context(chapter: Chapter | None) -> dict[str, Any] | None:
    if chapter is None:
        return None
    return {
        "id": chapter.id,
        "name": chapter.name,
        "subject_id": chapter.subject_id,
        "parent_id": chapter.parent_id,
        "subject": (
            {
                "id": chapter.subject.id,
                "name": chapter.subject.name,
                "color": getattr(chapter.subject, "color", "#6366f1"),
            }
            if chapter.subject
            else None
        ),
    }


def _palace_context(palace: Palace) -> dict[str, Any]:
    primary_chapter = getattr(palace, "primary_chapter", None)
    parent_chapter = (
        primary_chapter.parent
        if primary_chapter is not None and getattr(primary_chapter, "parent", None)
        else None
    )
    subject = resolve_palace_subject(palace)
    return {
        "id": palace.id,
        "title": palace.title,
        "resolved_title": resolve_palace_title(palace),
        "subject": (
            {
                "id": subject.id,
                "name": subject.name,
                "color": getattr(subject, "color", "#6366f1"),
            }
            if subject
            else None
        ),
        "primary_chapter": _chapter_context(primary_chapter),
        "parent_chapter": _chapter_context(parent_chapter),
        "needs_practice": bool(getattr(palace, "needs_practice", False)),
        "focus_count": len(parse_focus_node_uids(palace)),
    }


def _mini_palace_context(mini_palace: PalaceMiniPalace | None) -> dict[str, Any] | None:
    if mini_palace is None:
        return None
    return {
        "id": mini_palace.id,
        "palace_id": mini_palace.palace_id,
        "name": mini_palace.name or f"小宫殿 {mini_palace.sort_order + 1}",
        "sort_order": mini_palace.sort_order,
        "needs_practice": bool(getattr(mini_palace, "needs_practice", False)),
    }


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
        payload["palace_context"] = _palace_context(palace)
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
    schedules = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
        )
        .order_by(ReviewSchedule.review_number.asc(), ReviewSchedule.id.asc())
        .all()
    )
    for schedule in schedules:
        if candidate_ids is not None and schedule.palace_id not in candidate_ids:
            continue
        if schedule.palace and is_schedule_due(schedule, schedule.palace, session, now=now):
            ids.add(schedule.palace_id)

    segment_schedules = (
        session.query(PalaceSegmentReviewSchedule)
        .join(PalaceSegment)
        .join(Palace)
        .filter(
            PalaceSegmentReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
        )
        .order_by(PalaceSegmentReviewSchedule.review_number.asc(), PalaceSegmentReviewSchedule.id.asc())
        .all()
    )
    for schedule in segment_schedules:
        palace_id = schedule.segment.palace_id if schedule.segment else None
        if palace_id is None or (candidate_ids is not None and palace_id not in candidate_ids):
            continue
        if schedule.segment and is_segment_schedule_due(session, schedule.segment, schedule, now=now):
            ids.add(palace_id)

    mini_schedules = (
        session.query(PalaceMiniPalaceReviewSchedule)
        .join(PalaceMiniPalace)
        .join(Palace)
        .filter(
            PalaceMiniPalaceReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
        )
        .order_by(PalaceMiniPalaceReviewSchedule.review_number.asc(), PalaceMiniPalaceReviewSchedule.id.asc())
        .all()
    )
    for schedule in mini_schedules:
        mini_palace = schedule.mini_palace
        palace_id = mini_palace.palace_id if mini_palace else None
        if palace_id is None or (candidate_ids is not None and palace_id not in candidate_ids):
            continue
        if mini_palace and is_mini_palace_schedule_due(session, mini_palace, schedule, now=now):
            ids.add(palace_id)
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


def _iter_palace_questions(session: Session, palace: Palace) -> list[PalaceQuizQuestion]:
    seen: set[int] = set()
    rows: list[PalaceQuizQuestion] = []
    for question in sorted(
        palace.quiz_questions or [],
        key=lambda item: (
            int(getattr(item, "mini_palace_id", 0) or 0),
            int(getattr(item, "sort_order", 0) or 0),
            int(getattr(item, "id", 0) or 0),
        ),
    ):
        if question.id in seen:
            continue
        seen.add(question.id)
        rows.append(question)

    chapter_ids = sorted(get_palace_explicit_chapter_ids(session, palace))
    if not chapter_ids:
        chapter_ids = sorted(chapter.id for chapter in palace.chapters or [])
    if chapter_ids:
        chapter_questions = (
            session.query(PalaceQuizQuestion)
            .options(
                selectinload(PalaceQuizQuestion.mini_palace),
                selectinload(PalaceQuizQuestion.source_chapter).selectinload(Chapter.subject),
                selectinload(PalaceQuizQuestion.classified_chapter).selectinload(Chapter.subject),
            )
            .filter(
                PalaceQuizQuestion.source_chapter_id.in_(chapter_ids),
            )
            .order_by(PalaceQuizQuestion.sort_order.asc(), PalaceQuizQuestion.id.asc())
            .all()
        )
        for question in chapter_questions:
            if question.id in seen:
                continue
            seen.add(question.id)
            rows.append(question)
    return rows


def _build_quiz_cards(
    session: Session,
    palaces: list[Palace],
    *,
    range_filter: str,
    due_ids: set[int],
    practice_ids: set[int],
) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    for palace in palaces:
        if range_filter == FREESTYLE_RANGE_DUE and palace.id not in due_ids:
            continue
        if range_filter == FREESTYLE_RANGE_NEEDS_PRACTICE and palace.id not in practice_ids:
            continue
        palace_context = _palace_context(palace)
        for question in _iter_palace_questions(session, palace):
            mini_palace = question.mini_palace
            group_key = (
                f"mini:{mini_palace.id}"
                if mini_palace is not None
                else f"palace:{palace.id}"
            )
            source_chapter = (
                question.classified_chapter
                if question.classified_chapter is not None
                else question.source_chapter
            )
            cards.append(
                {
                    "id": f"quiz_question:{palace.id}:{question.id}",
                    "type": "quiz_question",
                    "content_type": CONTENT_TYPE_QUIZ_QUESTION,
                    "question": serialize_question(question),
                    "palace_context": palace_context,
                    "mini_palace_context": _mini_palace_context(mini_palace),
                    "chapter_context": _chapter_context(source_chapter),
                    "group_key": group_key,
                }
            )
    return cards


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
    schedules = (
        session.query(ReviewSchedule)
        .join(Palace)
        .filter(
            ReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
        )
        .order_by(ReviewSchedule.review_number.asc(), ReviewSchedule.id.asc())
        .all()
    )
    for schedule in schedules:
        if candidate_ids is not None and schedule.palace_id not in candidate_ids:
            continue
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


def _build_segment_review_cards(
    session: Session,
    *,
    candidate_ids: set[int] | None,
    range_filter: str,
) -> list[dict[str, Any]]:
    if range_filter == FREESTYLE_RANGE_NEEDS_PRACTICE:
        return []
    now = datetime.now()
    groups: OrderedDict[int, dict[str, Any]] = OrderedDict()
    schedules = (
        session.query(PalaceSegmentReviewSchedule)
        .join(PalaceSegment)
        .join(Palace)
        .filter(
            PalaceSegmentReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
        )
        .order_by(PalaceSegmentReviewSchedule.review_number.asc(), PalaceSegmentReviewSchedule.id.asc())
        .all()
    )
    for schedule in schedules:
        segment = schedule.segment
        palace = segment.palace if segment else None
        if not segment or not palace:
            continue
        if candidate_ids is not None and palace.id not in candidate_ids:
            continue
        if not is_segment_schedule_due(session, segment, schedule, now=now):
            continue
        group = groups.setdefault(
            segment.id,
            {"schedule": schedule, "count": 0},
        )
        group["count"] += 1
        current = group["schedule"]
        if (schedule.review_number, schedule.id) < (current.review_number, current.id):
            group["schedule"] = schedule

    cards: list[dict[str, Any]] = []
    for group in groups.values():
        schedule = group["schedule"]
        segment = schedule.segment
        palace = segment.palace
        segment_name = segment.name or f"第 {segment.sort_order + 1} 部分"
        cards.append(
            _action_card(
                card_id=f"segment_review:{schedule.id}",
                content_type=CONTENT_TYPE_SEGMENT_REVIEW,
                action_kind="segment_review",
                title=f"分块复习：{segment_name}",
                subtitle=f"{resolve_palace_title(palace)} · 第 {schedule.review_number + 1} 轮",
                href=f"/segment-review/session/{schedule.id}",
                priority=92,
                reason=f"{int(group['count'])} 个分块待复习",
                palace=palace,
                extra={
                    "schedule_id": schedule.id,
                    "segment_id": segment.id,
                    "segment_name": segment_name,
                },
            )
        )
    return cards


def _build_mini_review_cards(
    session: Session,
    *,
    candidate_ids: set[int] | None,
    range_filter: str,
) -> list[dict[str, Any]]:
    if range_filter == FREESTYLE_RANGE_NEEDS_PRACTICE:
        return []
    now = datetime.now()
    groups: OrderedDict[int, dict[str, Any]] = OrderedDict()
    schedules = (
        session.query(PalaceMiniPalaceReviewSchedule)
        .join(PalaceMiniPalace)
        .join(Palace)
        .filter(
            PalaceMiniPalaceReviewSchedule.completed == False,
            Palace.archived == False,
            Palace.mastered == False,
        )
        .order_by(
            PalaceMiniPalaceReviewSchedule.review_number.asc(),
            PalaceMiniPalaceReviewSchedule.id.asc(),
        )
        .all()
    )
    for schedule in schedules:
        mini_palace = schedule.mini_palace
        palace = mini_palace.palace if mini_palace else None
        if not mini_palace or not palace:
            continue
        if candidate_ids is not None and palace.id not in candidate_ids:
            continue
        if not is_mini_palace_schedule_due(session, mini_palace, schedule, now=now):
            continue
        group = groups.setdefault(
            mini_palace.id,
            {"schedule": schedule, "count": 0},
        )
        group["count"] += 1
        current = group["schedule"]
        if (schedule.review_number, schedule.id) < (current.review_number, current.id):
            group["schedule"] = schedule

    cards: list[dict[str, Any]] = []
    for group in groups.values():
        schedule = group["schedule"]
        mini_palace = schedule.mini_palace
        palace = mini_palace.palace
        name = mini_palace.name or f"小宫殿 {mini_palace.sort_order + 1}"
        cards.append(
            _action_card(
                card_id=f"mini_review:{schedule.id}",
                content_type=CONTENT_TYPE_MINI_REVIEW,
                action_kind="mini_review",
                title=f"小宫殿复习：{name}",
                subtitle=f"{resolve_palace_title(palace)} · 第 {schedule.review_number + 1} 轮",
                href=f"/mini-review/session/{schedule.id}",
                priority=88,
                reason=f"{int(group['count'])} 个小宫殿待复习",
                palace=palace,
                extra={
                    "schedule_id": schedule.id,
                    "mini_palace_id": mini_palace.id,
                    "mini_palace_name": name,
                },
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
            _build_quiz_cards(
                session,
                palaces,
                range_filter=range_filter,
                due_ids=due_ids,
                practice_ids=practice_ids,
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
    if CONTENT_TYPE_SEGMENT_REVIEW in content_types:
        cards.extend(
            _build_segment_review_cards(
                session,
                candidate_ids=candidate_filter,
                range_filter=range_filter,
            )
        )
    if CONTENT_TYPE_MINI_REVIEW in content_types:
        cards.extend(
            _build_mini_review_cards(
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
