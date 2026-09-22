"""Bookshelf cards reuse the mind-map objective/subjective corner badge counts."""

from __future__ import annotations

from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
)
from memory_anki.modules.content.presentation import router as palace_router
from memory_anki.modules.quiz.application.palace_count_badges import (
    project_palace_quiz_count_badges,
)


def _palace(session, title: str) -> Palace:
    palace = Palace(title=title, editor_doc="{}", editor_config="{}")
    session.add(palace)
    session.flush()
    return palace


def _question(session, *, palace_id: int, question_type: str, marked: bool = False, deleted: bool = False):
    from memory_anki.core.time import utc_now_naive

    row = PalaceQuizQuestion(
        palace_id=palace_id,
        question_type=question_type,
        stem=f"{question_type}-{marked}",
        options_json="[]",
        answer_payload_json="{}",
        marked=marked,
        deleted_at=utc_now_naive() if deleted else None,
    )
    session.add(row)
    session.flush()
    return row


def _bind(session, *, palace_id: int, question_id: int, node_uid: str) -> None:
    session.add(
        PalaceQuizQuestionNodeBinding(
            palace_id=palace_id,
            question_id=question_id,
            node_uid=node_uid,
            reason="test",
            source="manual",
        )
    )
    session.flush()


def test_project_palace_quiz_count_badges_splits_marked_and_ignores_deleted(db_session) -> None:
    palace = _palace(db_session, "中国教育史")
    other = _palace(db_session, "其他")
    palace_id = int(palace.id)
    objective = _question(db_session, palace_id=palace_id, question_type="multiple_choice", marked=True)
    again = _question(db_session, palace_id=palace_id, question_type="true_false")
    subjective = _question(db_session, palace_id=palace_id, question_type="short_answer")
    removed = _question(db_session, palace_id=palace_id, question_type="multiple_choice", deleted=True)
    foreign = _question(db_session, palace_id=int(other.id), question_type="short_answer", marked=True)
    _bind(db_session, palace_id=palace_id, question_id=int(objective.id), node_uid="a")
    _bind(db_session, palace_id=palace_id, question_id=int(objective.id), node_uid="b")
    _bind(db_session, palace_id=palace_id, question_id=int(again.id), node_uid="a")
    _bind(db_session, palace_id=palace_id, question_id=int(subjective.id), node_uid="c")
    _bind(db_session, palace_id=palace_id, question_id=int(removed.id), node_uid="a")
    _bind(db_session, palace_id=palace_id, question_id=int(foreign.id), node_uid="c")
    db_session.commit()

    badges = project_palace_quiz_count_badges(db_session, [palace_id, int(other.id)])

    assert badges[palace_id] == [
        {"text": "2", "tone": "rose", "title": "主观 2 道，含标记题", "kind": "subjective"},
        {"text": "2", "tone": "rose", "title": "客观 2 道，含标记题", "kind": "objective"},
    ]
    assert int(other.id) not in badges
    assert project_palace_quiz_count_badges(db_session, []) == {}


def _find_palace(payload: dict, palace_id: int) -> dict | None:
    for item in payload.get("ungrouped") or []:
        if item.get("id") == palace_id:
            return item
    for subject in payload.get("subjects") or []:
        for item in subject.get("ungrouped_palaces") or []:
            if item.get("id") == palace_id:
                return item
    return None


def test_grouped_catalog_stamps_quiz_count_badges(make_client, db_session, monkeypatch) -> None:
    monkeypatch.setattr(palace_router, "maybe_create_rolling_backup", lambda *args, **kwargs: None)
    client = make_client(palace_router)
    created = client.post("/api/v1/palaces", json={"title": "书架宫殿", "description": "", "pegs": []})
    assert created.status_code == 200
    palace_id = created.json()["id"]
    question = _question(db_session, palace_id=palace_id, question_type="multiple_choice")
    _bind(db_session, palace_id=palace_id, question_id=int(question.id), node_uid="root")
    db_session.commit()

    payload = client.get("/api/v1/palaces/grouped").json()
    card = _find_palace(payload, palace_id)
    assert card is not None
    assert card["quiz_count_badges"] == [
        {"text": "1", "tone": "success", "title": "客观 1 道", "kind": "objective"},
    ]
