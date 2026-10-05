"""Regression: retained round history must not widen the current 做题 scope."""

import pytest

from memory_anki.infrastructure.db._tables.knowledge import Subject
from memory_anki.infrastructure.db._tables.palaces import Palace, PalaceQuizQuestion
from memory_anki.modules.practice.application.overlay_quiz_service import (
    build_overlay_question_pack,
)
from memory_anki.modules.practice.application.round_overlay_service import (
    ensure_overlay_quiz,
    progress_overlay_quiz,
)
from memory_anki.modules.practice.application.round_state_service import (
    get_or_create_active_round,
)


def _config(ids=None, subject_ids=None, subject_scope="all"):
    return {
        "training_mode": "memory_palace",
        "streams": {
            "memory_palace": {
                "specific_palace_ids": ids or [],
                "subject_ids": subject_ids or [],
                "subject_scope": subject_scope,
            },
        },
    }


@pytest.mark.parametrize("selection", ["palaces", "subjects", "legacy_subject", "subset"])
def test_overlay_intersects_retained_round_with_current_review_scope(db_session, selection):
    subject = Subject(name="外国教育史")
    english = Subject(name="英语")
    kept = Palace(title="夸美纽斯", subjects=[subject])
    removed = Palace(title="福禄培尔", subjects=[english])
    unscheduled = Palace(title="未入本轮", subjects=[subject])
    db_session.add_all([kept, removed, unscheduled])
    db_session.flush()
    questions = [PalaceQuizQuestion(palace_id=p.id, stem=p.title) for p in [kept, removed, unscheduled]]
    db_session.add_all(questions)
    db_session.commit()
    configs = {
        "palaces": _config([kept.id, unscheduled.id]),
        "subjects": _config(subject_ids=[subject.id]),
        "legacy_subject": _config(subject_scope="non_english"),
        "subset": _config([kept.id], subject_ids=[subject.id, english.id]),
    }
    pack = build_overlay_question_pack(db_session, configs[selection], palace_ids=[kept.id, removed.id])
    assert pack["question_ids"] == [questions[0].id]
    assert set(pack["question_palace_ids"].values()) == {kept.id}
    empty = build_overlay_question_pack(db_session, configs[selection], palace_ids=[])
    assert empty["question_ids"] == []


def test_secondary_round_remove_and_restore_palace_parks_overlay_progress(db_session):
    kept = Palace(title="夸美纽斯")
    removed = Palace(title="福禄培尔")
    db_session.add_all([kept, removed])
    db_session.flush()
    q_kept = PalaceQuizQuestion(palace_id=kept.id, stem="夸美纽斯题")
    q_removed = PalaceQuizQuestion(palace_id=removed.id, stem="福禄培尔题")
    db_session.add_all([q_kept, q_removed])
    db_session.commit()
    config = _config([kept.id, removed.id])
    cards = [
        {"id": f"card-{p.id}", "type": "mindmap_branch", "palace_id": p.id, "unit_id": f"unit-{p.id}"}
        for p in [kept, removed]
    ]
    round_state = get_or_create_active_round(
        db_session, workspace="secondary", scope_key="both", config=config,
        cards=cards, operation_id="create", round_id="secondary-scope-regression",
    )
    ensured = ensure_overlay_quiz(
        db_session, round_id=round_state["round_id"], operation_id="ensure-both",
        expected_version=round_state["version"], config=config,
    )
    progressed = progress_overlay_quiz(
        db_session, round_id=ensured["round_id"], operation_id="answered",
        expected_version=ensured["version"], completed_ids=[q_kept.id, q_removed.id],
        states={str(q_kept.id): {"resolved": True}, str(q_removed.id): {"resolved": True}},
    )
    # Model the retained completed/retry history during a scope-save race: the
    # round still contains both palaces, while the persisted picker config is new.
    narrowed = ensure_overlay_quiz(
        db_session, round_id=progressed["round_id"], operation_id="ensure-kept",
        expected_version=progressed["version"], config=_config([kept.id]),
    )
    overlay = narrowed["plan"]["overlay_quiz"]
    assert overlay["question_ids"] == [q_kept.id]
    assert overlay["completed_ids"] == [q_kept.id]
    assert overlay["parked"]["completed_ids"] == [q_removed.id]
    assert len(narrowed["plan"]["original_cards"]) == 2
    restored = ensure_overlay_quiz(
        db_session, round_id=narrowed["round_id"], operation_id="restore-both",
        expected_version=narrowed["version"], config=config,
    )
    assert set(restored["plan"]["overlay_quiz"]["completed_ids"]) == {q_kept.id, q_removed.id}
    assert restored["round_id"] == round_state["round_id"]
