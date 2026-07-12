from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceQuizQuestion
from memory_anki.modules.palace_quiz.application.learning_loop import (
    build_mastery_profile,
    list_review_queue,
    record_attempt_event,
    review_question_quality,
    transition_question,
)
from memory_anki.modules.palace_quiz.application.question_contracts import json_dump


def _question(*, evidence=None, status="candidate"):
    return PalaceQuizQuestion(
        palace_id=1,
        question_type="short_answer",
        stem="请解释有丝分裂为何能够保持遗传信息稳定。",
        answer_payload_json=json_dump({"reference_answer": "复制后平均分配染色体。"}, default={}),
        analysis="考查因果解释与概念重建。",
        lifecycle_status=status,
        evidence_json=json_dump(evidence or [], default=[]),
        difficulty=3,
    )


def test_candidate_requires_evidence_before_publish(db_session):
    palace = Palace(title="生物", description="")
    db_session.add(palace)
    db_session.flush()
    question = _question()
    question.palace_id = palace.id
    db_session.add(question)
    db_session.commit()
    review = review_question_quality(question)
    assert review["passed"] is False
    assert "缺少可追溯来源证据" in review["issues"]
    question.evidence_json = json_dump(
        [{"source_name": "教材.pdf", "page_numbers": [12], "excerpt": "染色体平均分配"}], default=[]
    )
    db_session.commit()
    assert (
        transition_question(db_session, question.id, "published")["lifecycle_status"] == "published"
    )


def test_attempt_events_drive_explainable_mastery(db_session):
    palace = Palace(title="生物", description="")
    db_session.add(palace)
    db_session.flush()
    question = _question(
        evidence=[{"source_name": "教材.pdf", "page_numbers": [12]}], status="published"
    )
    question.palace_id = palace.id
    db_session.add(question)
    db_session.commit()
    record_attempt_event(
        db_session,
        {
            "question_id": question.id,
            "scene": "freestyle_today",
            "is_correct": True,
            "confidence": 5,
            "hint_count": 0,
            "retry_count": 0,
            "answer_payload": {"user_answer": "回答"},
        },
    )
    profile = build_mastery_profile(db_session, palace_id=palace.id)
    assert profile[0]["label"] == "stable"
    assert profile[0]["score"] >= 0.8


def test_review_queue_excludes_published_questions(db_session):
    palace = Palace(title="生物", description="")
    db_session.add(palace)
    db_session.flush()
    candidate = _question(evidence=[{"source_name": "a"}])
    published = _question(evidence=[{"source_name": "b"}], status="published")
    candidate.palace_id = palace.id
    published.palace_id = palace.id
    db_session.add_all([candidate, published])
    db_session.commit()
    assert [item["id"] for item in list_review_queue(db_session, palace_id=palace.id)] == [
        candidate.id
    ]
