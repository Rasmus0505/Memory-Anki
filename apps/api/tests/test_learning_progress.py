"""Progress reads use hermetic databases and never repair or flush state."""
import json
from datetime import date, timedelta

from sqlalchemy import event

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import (
    FreestyleQuizAttempt,
    Palace,
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
    QuizAttemptEvent,
)
from memory_anki.infrastructure.db._tables.quiz_practice import (
    QuizPracticeProgress,
    QuizPracticeProgressClear,
)
from memory_anki.infrastructure.db._tables.unit_reviews import (
    ReviewUnitRatingOperation,
    ReviewUnitState,
)
from memory_anki.modules.dashboard.application.learning_progress import build_learning_progress
from memory_anki.modules.dashboard.presentation import router
from memory_anki.modules.memory.api import reconcile_palace_units


def document():
    return json.dumps({"root": {"data": {"uid": "root", "text": "Root", "permanentSplitMark": True},
        "children": [{"data": {"uid": "chapter", "text": "Chapter"}, "children": [
            {"data": {"uid": "a", "text": "A"}}, {"data": {"uid": "b", "text": "B"}}]}]}})


def test_duplicate_uid_reports_integrity_warning_without_repairing_document(session_factory):
    malformed = json.dumps({"root": {"data": {"uid": "root", "text": "Root"}, "children": [
        {"data": {"uid": "chapter", "text": "Chapter"}, "children": [
            {"data": {"uid": "same", "text": "First"}},
            {"data": {"uid": "same", "text": "Second"}},
        ]},
    ]}})
    with session_factory() as session:
        palace = Palace(title="Malformed", editor_doc=malformed)
        session.add(palace)
        session.commit()
        result = build_learning_progress(session)
        assert any("结构完整性问题" in note for note in result["notes"])
        assert session.get(Palace, palace.id).editor_doc == malformed


def test_valid_missing_uid_name_has_no_integrity_warning(session_factory):
    valid = json.dumps({"root": {"data": {"uid": "root", "text": "Root"}, "children": [
        {"data": {"uid": "chapter", "text": "Chapter"}, "children": [
            {"data": {"uid": "missing", "text": "Named node"}},
        ]},
    ]}})
    with session_factory() as session:
        session.add(Palace(title="Valid", editor_doc=valid))
        session.commit()
        result = build_learning_progress(session)
        assert not any("结构完整性问题" in note for note in result["notes"])


def test_empty_read_and_typed_route(make_client):
    response = make_client(router).get("/api/v1/dashboard/learning-progress")
    assert response.status_code == 200
    body = response.json()
    assert body["roots"] == []
    assert body["metrics"] == dict(memory_total=0, memory_reviewed=0, memory_due=0, quiz_total=0, quiz_answered=0)
    assert body["generated_at"]


def test_real_hierarchy_dedup_evidence_and_clear(session_factory):
    with session_factory() as session:
        one, two = Subject(name="One"), Subject(name="Two")
        empty_subject = Subject(name="Empty")
        chapter = Chapter(name="Catalog chapter", subject=one)
        palace = Palace(title="P", editor_doc=document(), subjects=[one, two], chapters=[chapter])
        empty = Palace(title="Empty palace", editor_doc="{}")
        archived = Palace(title="Archived", editor_doc=document(), archived=True)
        session.add_all([palace, empty, archived, empty_subject])
        session.flush()
        pid = palace.id
        question = PalaceQuizQuestion(palace_id=pid, stem="Q")
        cleared = PalaceQuizQuestion(palace_id=pid, stem="Cleared", attempt_count=10)
        unresolved = PalaceQuizQuestion(palace_id=pid, stem="Draft")
        session.add_all([question, cleared, unresolved])
        session.flush()
        for uid in ["a", "b", "chapter"]:
            session.add(PalaceQuizQuestionNodeBinding(palace_id=pid, question_id=question.id, node_uid=uid))
        for q, state in [(question, {"resolved": True}), (cleared, {"rating": 3}), (unresolved, {"resolved": False})]:
            session.add(QuizPracticeProgress(question_id=q.id, palace_id=pid, state_json=json.dumps(state), updated_at="2026-01-01T00:00:00Z"))
        session.add(QuizPracticeProgressClear(scope_key=f"question:{cleared.id}", cleared_at="2026-01-02T00:00:00Z"))
        session.commit()
        reconcile_palace_units(session, pid)
        for state in session.query(ReviewUnitState).all():
            state.has_passed = True
            state.due_date = date.today() - timedelta(days=1)
        session.commit()
        result = build_learning_progress(session)
        # Cleared round state still counts because the question retains attempt history.
        assert result["metrics"] == dict(memory_total=2, memory_reviewed=2, memory_due=2, quiz_total=3, quiz_answered=2)
        stack = list(result["roots"])
        identities = []
        while stack:
            item = stack.pop()
            identities.append(item["id"])
            stack.extend(item["children"])
        assert len(identities) == len(set(identities))
        roots = {root["name"]: root for root in result["roots"]}
        assert len(roots["One"]["children"]) == 1  # direct + chapter bindings dedup
        assert roots["Empty"]["children"] == []
        assert roots["未分类"]["children"][0]["metrics"]["memory_total"] == 0
        branch = roots["One"]["children"][0]["children"][0]
        assert branch["name"] == "Chapter" and branch["kind"] == "chapter"
        assert branch["metrics"]["quiz_total"] == 1
        assert [leaf["kind"] for leaf in branch["children"]] == ["memory_point", "memory_point"]
        # Changed content invalidates persisted review evidence without repairing it.
        palace.editor_doc = document().replace('"A"', '"Changed A"')
        session.commit()
        result = build_learning_progress(session)
        assert result["metrics"]["memory_reviewed"] == 0
        assert result["metrics"]["memory_due"] == 0


def test_reviewed_includes_failed_effective_ratings_but_not_undo_or_old_revision(session_factory):
    with session_factory() as session:
        palace = Palace(title="P", editor_doc=document())
        session.add(palace)
        session.commit()
        reconcile_palace_units(session, palace.id)
        state = session.query(ReviewUnitState).first()
        operation = ReviewUnitRatingOperation(
            id="rating", encounter_id="encounter", study_session_id="session",
            unit_id=state.id, palace_id=palace.id, unit_revision=state.revision,
            rating=1, passed=False, before_state_json="{}", after_state_json="{}",
        )
        session.add(operation)
        session.commit()
        assert build_learning_progress(session)["metrics"]["memory_reviewed"] == 2
        operation.undone_at = utc_now_naive()
        session.commit()
        assert build_learning_progress(session)["metrics"]["memory_reviewed"] == 0
        operation.undone_at = None
        operation.replaced_at = utc_now_naive()
        session.commit()
        assert build_learning_progress(session)["metrics"]["memory_reviewed"] == 0
        operation.replaced_at = None
        operation.unit_revision = state.revision - 1
        session.commit()
        assert build_learning_progress(session)["metrics"]["memory_reviewed"] == 0


def test_any_answer_record_counts_once_even_after_round_clear(session_factory):
    with session_factory() as session:
        palace = Palace(title="P", editor_doc=document())
        session.add(palace)
        session.flush()
        counted = PalaceQuizQuestion(palace_id=palace.id, stem="Counter", attempt_count=3)
        event_only = PalaceQuizQuestion(palace_id=palace.id, stem="Event")
        freestyle_only = PalaceQuizQuestion(palace_id=palace.id, stem="Freestyle")
        repeated = PalaceQuizQuestion(palace_id=palace.id, stem="Repeated", attempt_count=1)
        untouched = PalaceQuizQuestion(palace_id=palace.id, stem="Untouched")
        deleted = PalaceQuizQuestion(palace_id=palace.id, stem="Deleted", attempt_count=4, deleted_at=utc_now_naive())
        session.add_all([counted, event_only, freestyle_only, repeated, untouched, deleted])
        session.flush()
        session.add_all([
            QuizAttemptEvent(question_id=event_only.id, palace_id=palace.id, is_correct=False),
            QuizAttemptEvent(question_id=repeated.id, palace_id=palace.id, is_correct=False),
            QuizAttemptEvent(question_id=repeated.id, palace_id=palace.id, is_correct=True),
            FreestyleQuizAttempt(question_id=freestyle_only.id, palace_id=palace.id, is_correct=False),
            QuizPracticeProgress(
                question_id=event_only.id, palace_id=palace.id,
                state_json=json.dumps({"resolved": True}), updated_at="2026-01-01T00:00:00Z",
            ),
            QuizPracticeProgressClear(scope_key=f"question:{event_only.id}", cleared_at="2026-01-02T00:00:00Z"),
        ])
        session.commit()
        metrics = build_learning_progress(session)["metrics"]
        assert metrics["quiz_total"] == 5
        assert metrics["quiz_answered"] == 4


def test_read_has_constant_queries_and_no_flush(session_factory, test_engine):
    with session_factory() as session:
        session.add(Palace(title="One", editor_doc=document()))
        session.commit()
        statements = []
        def track(_conn, _cursor, statement, _parameters, _context, _many):
            statements.append(statement)
        event.listen(test_engine, "before_cursor_execute", track)
        try:
            build_learning_progress(session)
            first = len(statements)
            session.add_all(Palace(title=f"P{i}", editor_doc=document()) for i in range(30))
            session.commit()
            statements.clear()
            dirty = session.query(Palace).first()
            dirty.title = "Unflushed"
            pending = Palace(title="Pending", editor_doc=document())
            session.add(pending)
            statements.clear()
            result = build_learning_progress(session)
            assert len(statements) == first
            assert all(sql.lstrip().upper().startswith("SELECT") for sql in statements)
            assert pending.id is None and pending in session.new and dirty in session.dirty
            assert result["metrics"]["memory_total"] == 62
        finally:
            event.remove(test_engine, "before_cursor_execute", track)
