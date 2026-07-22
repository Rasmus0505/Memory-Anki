"""Topic sentence patterns (句模) with FSRS scheduling on viewpoint sentences."""

from __future__ import annotations

from typing import Any

from fsrs import State
from sqlalchemy.orm import Session, object_session, selectinload

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.english import (
    EnglishCourse,
    EnglishPatternPrompt,
    EnglishPatternSentence,
    EnglishSentence,
    EnglishTopicPattern,
)
from memory_anki.modules.english.application.pattern_fsrs import (
    apply_fsrs_rating,
    init_fsrs_card,
    sentence_due_filter,
)
from memory_anki.modules.english.application.pattern_serialize import (
    DEFAULT_PROMPT_COUNT,
    DEFAULT_VIEWPOINTS_PER_PROMPT,
    TARGET_SENTENCE_COUNT,
    clean_text,
    dump_json_list,
    serialize_pattern_detail,
    serialize_pattern_sentence,
    serialize_pattern_summary,
)
from memory_anki.modules.english.domain.errors import EnglishCourseError
from memory_anki.modules.memory.public.queries import VALID_RATINGS, normalize_rating

PATTERN_STATUSES = {"draft", "learning", "speakable", "mature", "archived"}
SENTENCE_SOURCES = {"manual", "from_listening", "from_reading", "ai"}
PATTERN_REVIEW_RESULTS = {"forgot", "hard", "good", "easy", *{str(i) for i in VALID_RATINGS}}


def create_topic_pattern(
    session: Session,
    *,
    title: str,
    tags: list[str] | None = None,
    notes: str = "",
    seed_template: bool = True,
) -> dict[str, Any]:
    safe_title = clean_text(title, limit=240)
    if not safe_title:
        raise EnglishCourseError("请填写句模话题标题。")
    row = EnglishTopicPattern(
        title=safe_title,
        tags_json=dump_json_list(tags or []),
        notes=clean_text(notes, limit=2000),
        status="draft",
    )
    session.add(row)
    session.flush()
    if seed_template:
        _seed_empty_template(session, row)
    _touch_pattern(row)
    session.commit()
    return get_topic_pattern(session, pattern_id=row.id)


def list_topic_patterns(
    session: Session,
    *,
    include_archived: bool = False,
    limit: int = 100,
) -> dict[str, Any]:
    now = utc_now_naive()
    safe_limit = max(1, min(200, int(limit)))
    query = session.query(EnglishTopicPattern)
    if not include_archived:
        query = query.filter(EnglishTopicPattern.status != "archived")
    rows = (
        query.order_by(
            EnglishTopicPattern.updated_at.desc(),
            EnglishTopicPattern.id.desc(),
        )
        .limit(safe_limit)
        .all()
    )
    items = [serialize_pattern_summary(session, row, now=now) for row in rows]
    due_sentence_count = (
        session.query(EnglishPatternSentence)
        .filter(
            EnglishPatternSentence.status == "active",
            EnglishPatternSentence.text_en != "",
            sentence_due_filter(now),
        )
        .count()
    )
    total = (
        session.query(EnglishTopicPattern)
        .filter(EnglishTopicPattern.status != "archived")
        .count()
        if not include_archived
        else session.query(EnglishTopicPattern).count()
    )
    return {
        "items": items,
        "total": int(total),
        "dueSentenceCount": int(due_sentence_count),
    }


def get_topic_pattern(session: Session, *, pattern_id: int) -> dict[str, Any]:
    row = _load_pattern(session, pattern_id)
    return serialize_pattern_detail(row, now=utc_now_naive())


def update_topic_pattern(
    session: Session,
    *,
    pattern_id: int,
    title: str | None = None,
    tags: list[str] | None = None,
    notes: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    row = _load_pattern(session, pattern_id)
    if title is not None:
        safe_title = clean_text(title, limit=240)
        if not safe_title:
            raise EnglishCourseError("句模标题不能为空。")
        row.title = safe_title
    if tags is not None:
        row.tags_json = dump_json_list(tags)
    if notes is not None:
        row.notes = clean_text(notes, limit=2000)
    if status is not None:
        safe_status = str(status).strip().lower()
        if safe_status not in PATTERN_STATUSES:
            raise EnglishCourseError("句模状态无效。")
        row.status = safe_status
    _touch_pattern(row)
    _refresh_pattern_status(row)
    session.commit()
    return get_topic_pattern(session, pattern_id=row.id)


def delete_topic_pattern(session: Session, *, pattern_id: int) -> dict[str, Any]:
    row = session.get(EnglishTopicPattern, int(pattern_id))
    if row is None:
        raise EnglishCourseError("句模不存在。")
    session.delete(row)
    session.commit()
    return {"ok": True, "id": int(pattern_id)}


def upsert_prompt(
    session: Session,
    *,
    pattern_id: int,
    prompt_id: int | None = None,
    text_en: str = "",
    text_zh: str = "",
    prompt_index: int | None = None,
) -> dict[str, Any]:
    pattern = _load_pattern(session, pattern_id)
    if prompt_id is not None:
        prompt = session.get(EnglishPatternPrompt, int(prompt_id))
        if prompt is None or prompt.pattern_id != pattern.id:
            raise EnglishCourseError("问题不存在。")
    else:
        next_index = max((p.prompt_index for p in pattern.prompts), default=-1) + 1
        prompt = EnglishPatternPrompt(
            pattern_id=pattern.id,
            prompt_index=next_index if prompt_index is None else int(prompt_index),
        )
        session.add(prompt)
        session.flush()
    prompt.text_en = clean_text(text_en, limit=1000)
    prompt.text_zh = clean_text(text_zh, limit=1000)
    if prompt_index is not None:
        prompt.prompt_index = max(0, int(prompt_index))
    prompt.updated_at = utc_now_naive()
    _touch_pattern(pattern)
    session.commit()
    return get_topic_pattern(session, pattern_id=pattern.id)


def delete_prompt(session: Session, *, prompt_id: int) -> dict[str, Any]:
    prompt = session.get(EnglishPatternPrompt, int(prompt_id))
    if prompt is None:
        raise EnglishCourseError("问题不存在。")
    pattern_id = int(prompt.pattern_id)
    session.delete(prompt)
    pattern = session.get(EnglishTopicPattern, pattern_id)
    if pattern is not None:
        _touch_pattern(pattern)
        _refresh_pattern_status(pattern)
    session.commit()
    return {"ok": True, "id": int(prompt_id), "patternId": pattern_id}


def upsert_sentence(
    session: Session,
    *,
    prompt_id: int,
    sentence_id: int | None = None,
    text_en: str = "",
    text_zh: str = "",
    note: str = "",
    slots: list[str] | None = None,
    collocations: list[str] | None = None,
    sentence_index: int | None = None,
    source: str = "manual",
) -> dict[str, Any]:
    prompt = session.get(EnglishPatternPrompt, int(prompt_id))
    if prompt is None:
        raise EnglishCourseError("问题不存在。")
    pattern = session.get(EnglishTopicPattern, prompt.pattern_id)
    if pattern is None:
        raise EnglishCourseError("句模不存在。")

    safe_source = str(source or "manual").strip().lower()
    if safe_source not in SENTENCE_SOURCES:
        raise EnglishCourseError("句子来源无效。")

    safe_en = clean_text(text_en, limit=4000)
    if sentence_id is not None:
        row = session.get(EnglishPatternSentence, int(sentence_id))
        if row is None or row.prompt_id != prompt.id:
            raise EnglishCourseError("观点长句不存在。")
    else:
        next_index = max((s.sentence_index for s in prompt.sentences), default=-1) + 1
        row = EnglishPatternSentence(
            pattern_id=pattern.id,
            prompt_id=prompt.id,
            sentence_index=next_index if sentence_index is None else max(0, int(sentence_index)),
            source=safe_source,
            status="active",
        )
        session.add(row)
        session.flush()

    had_text = bool(str(row.text_en or "").strip())
    row.text_en = safe_en
    row.text_zh = clean_text(text_zh, limit=2000)
    row.note = clean_text(note, limit=1200)
    if slots is not None:
        row.slots_json = dump_json_list(slots)
    if collocations is not None:
        row.collocations_json = dump_json_list(collocations)
    if sentence_index is not None:
        row.sentence_index = max(0, int(sentence_index))
    row.source = safe_source
    row.updated_at = utc_now_naive()

    if safe_en and (not had_text or row.due_at is None):
        init_fsrs_card(session, row)
    elif not safe_en:
        row.due_at = None
        row.next_due_at = None
        row.next_due_date = None

    _touch_pattern(pattern)
    _refresh_pattern_status(pattern)
    session.commit()
    session.refresh(row)
    return serialize_pattern_sentence(row, now=utc_now_naive(), pattern_title=pattern.title)


def delete_sentence(session: Session, *, sentence_id: int) -> dict[str, Any]:
    row = session.get(EnglishPatternSentence, int(sentence_id))
    if row is None:
        raise EnglishCourseError("观点长句不存在。")
    pattern_id = int(row.pattern_id)
    session.delete(row)
    pattern = session.get(EnglishTopicPattern, pattern_id)
    if pattern is not None:
        _touch_pattern(pattern)
        _refresh_pattern_status(pattern)
    session.commit()
    return {"ok": True, "id": int(sentence_id), "patternId": pattern_id}


def list_due_sentences(
    session: Session,
    *,
    pattern_id: int | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    now = utc_now_naive()
    safe_limit = max(1, min(100, int(limit)))
    query = session.query(EnglishPatternSentence).filter(
        EnglishPatternSentence.status == "active",
        EnglishPatternSentence.text_en != "",
        sentence_due_filter(now),
    )
    if pattern_id is not None:
        query = query.filter(EnglishPatternSentence.pattern_id == int(pattern_id))
    rows = (
        query.order_by(
            EnglishPatternSentence.due_at.asc(),
            EnglishPatternSentence.next_due_at.asc(),
            EnglishPatternSentence.id.asc(),
        )
        .limit(safe_limit)
        .all()
    )
    pattern_titles = _pattern_title_map(session, {int(r.pattern_id) for r in rows})
    prompt_map = _prompt_map(session, {int(r.prompt_id) for r in rows})
    due_filters = [
        EnglishPatternSentence.status == "active",
        EnglishPatternSentence.text_en != "",
        sentence_due_filter(now),
    ]
    if pattern_id is not None:
        due_filters.append(EnglishPatternSentence.pattern_id == int(pattern_id))
    due_count = session.query(EnglishPatternSentence).filter(*due_filters).count()
    items = []
    for row in rows:
        item = serialize_pattern_sentence(
            row,
            now=now,
            pattern_title=pattern_titles.get(int(row.pattern_id), ""),
        )
        prompt = prompt_map.get(int(row.prompt_id))
        if prompt is not None:
            item["promptTextEn"] = prompt.text_en
            item["promptTextZh"] = prompt.text_zh
        items.append(item)
    return {"items": items, "dueCount": int(due_count)}


def review_pattern_sentence(
    session: Session,
    *,
    sentence_id: int,
    result: str | int | None = None,
    rating: int | str | None = None,
) -> dict[str, Any]:
    row = session.get(EnglishPatternSentence, int(sentence_id))
    if row is None or row.status != "active":
        raise EnglishCourseError("观点长句不存在。")
    if not str(row.text_en or "").strip():
        raise EnglishCourseError("空句子不能复习，请先填写英文长句。")
    raw = rating if rating is not None else result
    try:
        grade = normalize_rating(raw if raw is not None else 3)
    except ValueError as exc:
        raise EnglishCourseError("复习评分仅支持 1-4 或 forgot/hard/good/easy。") from exc

    now = utc_now_naive()
    row.review_count = int(row.review_count or 0) + 1
    if grade == 1:
        row.incorrect_count = int(row.incorrect_count or 0) + 1
    else:
        row.correct_count = int(row.correct_count or 0) + 1
    row.last_reviewed_at = now
    row.updated_at = now
    apply_fsrs_rating(session, row, grade, now=now)

    pattern = session.get(EnglishTopicPattern, row.pattern_id)
    if pattern is not None:
        _touch_pattern(pattern)
        _refresh_pattern_status(pattern)
    session.commit()
    session.refresh(row)
    title = pattern.title if pattern is not None else ""
    return serialize_pattern_sentence(row, now=now, pattern_title=title)


def collect_sentence_into_pattern(
    session: Session,
    *,
    pattern_id: int | None = None,
    pattern_title: str = "",
    prompt_id: int | None = None,
    prompt_text_en: str = "",
    prompt_text_zh: str = "",
    text_en: str,
    text_zh: str = "",
    note: str = "",
    source: str = "manual",
    source_course_id: int | None = None,
    source_sentence_id: int | None = None,
    source_material_id: int | None = None,
    source_version_id: int | None = None,
) -> dict[str, Any]:
    safe_en = clean_text(text_en, limit=4000)
    if not safe_en:
        raise EnglishCourseError("请提供要收藏的英文长句。")

    safe_source = str(source or "manual").strip().lower()
    if safe_source not in SENTENCE_SOURCES:
        raise EnglishCourseError("句子来源无效。")

    if source_sentence_id is not None and safe_source == "from_listening":
        source_row = session.get(EnglishSentence, int(source_sentence_id))
        if source_row is None:
            raise EnglishCourseError("听力句子不存在。")
        if not text_zh:
            text_zh = source_row.text_zh
        source_course_id = source_course_id or source_row.course_id
        if source_course_id is not None:
            course = session.get(EnglishCourse, int(source_course_id))
            if course is None:
                raise EnglishCourseError("听力课程不存在。")

    if pattern_id is not None:
        pattern = _load_pattern(session, pattern_id)
    else:
        title = clean_text(pattern_title, limit=240) or "未命名话题"
        pattern = EnglishTopicPattern(
            title=title,
            tags_json="[]",
            notes="",
            status="draft",
        )
        session.add(pattern)
        session.flush()

    if prompt_id is not None:
        prompt = session.get(EnglishPatternPrompt, int(prompt_id))
        if prompt is None or prompt.pattern_id != pattern.id:
            raise EnglishCourseError("问题不存在或不属于该句模。")
    else:
        next_index = max((p.prompt_index for p in pattern.prompts), default=-1) + 1
        prompt = EnglishPatternPrompt(
            pattern_id=pattern.id,
            prompt_index=next_index,
            text_en=clean_text(prompt_text_en, limit=1000),
            text_zh=clean_text(prompt_text_zh, limit=1000),
        )
        session.add(prompt)
        session.flush()

    next_sentence_index = max((s.sentence_index for s in prompt.sentences), default=-1) + 1
    row = EnglishPatternSentence(
        pattern_id=pattern.id,
        prompt_id=prompt.id,
        sentence_index=next_sentence_index,
        text_en=safe_en,
        text_zh=clean_text(text_zh, limit=2000),
        note=clean_text(note, limit=1200),
        source=safe_source,
        source_course_id=source_course_id,
        source_sentence_id=source_sentence_id,
        source_material_id=source_material_id,
        source_version_id=source_version_id,
        status="active",
    )
    session.add(row)
    session.flush()
    init_fsrs_card(session, row)
    _touch_pattern(pattern)
    _refresh_pattern_status(pattern)
    session.commit()
    session.refresh(row)
    return {
        "pattern": serialize_pattern_summary(session, pattern, now=utc_now_naive()),
        "sentence": serialize_pattern_sentence(
            row,
            now=utc_now_naive(),
            pattern_title=pattern.title,
        ),
    }


def get_due_pattern_feed_summary(session: Session) -> dict[str, Any] | None:
    """Narrow public payload for freestyle / dashboard consumers."""
    now = utc_now_naive()
    due_count = (
        session.query(EnglishPatternSentence)
        .filter(
            EnglishPatternSentence.status == "active",
            EnglishPatternSentence.text_en != "",
            sentence_due_filter(now),
        )
        .count()
    )
    if due_count <= 0:
        return None
    first = (
        session.query(EnglishPatternSentence)
        .filter(
            EnglishPatternSentence.status == "active",
            EnglishPatternSentence.text_en != "",
            sentence_due_filter(now),
        )
        .order_by(
            EnglishPatternSentence.due_at.asc(),
            EnglishPatternSentence.id.asc(),
        )
        .first()
    )
    pattern_title = ""
    if first is not None:
        pattern = session.get(EnglishTopicPattern, first.pattern_id)
        pattern_title = pattern.title if pattern is not None else ""
    return {
        "dueSentenceCount": int(due_count),
        "firstSentenceId": first.id if first is not None else None,
        "firstPatternId": first.pattern_id if first is not None else None,
        "firstPatternTitle": pattern_title,
        "href": "/english?tab=patterns",
    }


def _seed_empty_template(session: Session, pattern: EnglishTopicPattern) -> None:
    for prompt_index in range(DEFAULT_PROMPT_COUNT):
        prompt = EnglishPatternPrompt(
            pattern_id=pattern.id,
            prompt_index=prompt_index,
            text_en="",
            text_zh="",
        )
        session.add(prompt)
        session.flush()
        for sentence_index in range(DEFAULT_VIEWPOINTS_PER_PROMPT):
            session.add(
                EnglishPatternSentence(
                    pattern_id=pattern.id,
                    prompt_id=prompt.id,
                    sentence_index=sentence_index,
                    text_en="",
                    text_zh="",
                    source="manual",
                    status="active",
                )
            )


def _load_pattern(session: Session, pattern_id: int) -> EnglishTopicPattern:
    row = (
        session.query(EnglishTopicPattern)
        .options(
            selectinload(EnglishTopicPattern.prompts).selectinload(
                EnglishPatternPrompt.sentences
            ),
        )
        .filter(EnglishTopicPattern.id == int(pattern_id))
        .first()
    )
    if row is None:
        raise EnglishCourseError("句模不存在。")
    return row


def _refresh_pattern_status(pattern: EnglishTopicPattern) -> None:
    if pattern.status in {"archived", "mature"}:
        return
    session = object_session(pattern)
    if session is not None:
        filled = (
            session.query(EnglishPatternSentence)
            .filter(
                EnglishPatternSentence.pattern_id == pattern.id,
                EnglishPatternSentence.status == "active",
                EnglishPatternSentence.text_en != "",
            )
            .all()
        )
    else:
        filled = [
            s
            for s in pattern.sentences
            if s.status == "active" and str(s.text_en or "").strip()
        ]
    if not filled:
        pattern.status = "draft"
        return
    if len(filled) < TARGET_SENTENCE_COUNT // 2:
        pattern.status = "learning"
        return
    review_ready = [
        s
        for s in filled
        if int(s.fsrs_state or 1) >= int(State.Review) and int(s.review_count or 0) > 0
    ]
    if len(review_ready) >= max(1, int(len(filled) * 0.8)):
        pattern.status = "speakable"
    else:
        pattern.status = "learning"


def _touch_pattern(pattern: EnglishTopicPattern) -> None:
    pattern.updated_at = utc_now_naive()


def _pattern_title_map(session: Session, pattern_ids: set[int]) -> dict[int, str]:
    if not pattern_ids:
        return {}
    rows = (
        session.query(EnglishTopicPattern)
        .filter(EnglishTopicPattern.id.in_(list(pattern_ids)))
        .all()
    )
    return {int(r.id): r.title for r in rows}


def _prompt_map(session: Session, prompt_ids: set[int]) -> dict[int, EnglishPatternPrompt]:
    if not prompt_ids:
        return {}
    rows = (
        session.query(EnglishPatternPrompt)
        .filter(EnglishPatternPrompt.id.in_(list(prompt_ids)))
        .all()
    )
    return {int(r.id): r for r in rows}
