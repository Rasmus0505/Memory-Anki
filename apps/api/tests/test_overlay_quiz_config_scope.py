"""做题 scope is the round's own review set. The saved config must not narrow it.

Product rule, stated by the owner: *if the 随心 config selects 20 palaces but this
round actually scheduled only 10, 做题 may only draw from those 10.* An earlier
version applied the config a second time as a filter and produced the worst
outcome: the header counted the round's 8 palaces while the pool held 0
questions, because the config had since been narrowed. See
docs/incidents/0002-quiz-scope-two-owners.md.
"""

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


def test_config_never_narrows_the_round_palace_set(db_session):
    """A round palace stays in scope however the config is narrowed afterwards."""
    subject = Subject(name="外国教育史")
    english = Subject(name="英语")
    kept = Palace(title="夸美纽斯", subjects=[subject])
    also_scheduled = Palace(title="福禄培尔", subjects=[english])
    not_scheduled = Palace(title="未入本轮", subjects=[subject])
    db_session.add_all([kept, also_scheduled, not_scheduled])
    db_session.flush()
    q_kept = PalaceQuizQuestion(palace_id=kept.id, stem="夸美纽斯题")
    q_also = PalaceQuizQuestion(palace_id=also_scheduled.id, stem="福禄培尔题")
    q_out = PalaceQuizQuestion(palace_id=not_scheduled.id, stem="未入本轮题")
    db_session.add_all([q_kept, q_also, q_out])
    db_session.commit()

    # Every shape of config narrowing, including one that excludes a scheduled
    # palace outright. None of them may drop that palace's questions.
    configs = [
        _config([kept.id, not_scheduled.id]),
        _config(subject_ids=[subject.id]),
        _config(subject_scope="non_english"),
        _config([kept.id], subject_ids=[subject.id, english.id]),
        _config([not_scheduled.id]),
    ]
    for config in configs:
        pack = build_overlay_question_pack(
            db_session, config, palace_ids=[kept.id, also_scheduled.id]
        )
        assert set(pack["question_palace_ids"].values()) == {kept.id, also_scheduled.id}
        assert set(pack["question_ids"]) == {q_kept.id, q_also.id}
        # A palace the round never scheduled is still out, even when the config
        # names it explicitly.
        assert q_out.id not in pack["question_ids"]
    # An empty round is an empty scope, not a widened one.
    empty = build_overlay_question_pack(db_session, configs[0], palace_ids=[])
    assert empty["question_ids"] == []


def test_scope_report_has_no_config_exclusion_reason(db_session):
    """The report explains the round, so `not_in_config` no longer exists."""
    subject = Subject(name="外国教育史")
    english = Subject(name="英语")
    scheduled = Palace(title="夸美纽斯", subjects=[subject])
    config_excluded = Palace(title="福禄培尔", subjects=[english])
    db_session.add_all([scheduled, config_excluded])
    db_session.flush()
    db_session.add_all(
        [
            PalaceQuizQuestion(palace_id=scheduled.id, stem="题"),
            PalaceQuizQuestion(palace_id=config_excluded.id, stem="题"),
        ]
    )
    db_session.commit()
    pack = build_overlay_question_pack(
        db_session,
        _config([scheduled.id]),
        palace_ids=[scheduled.id, config_excluded.id],
    )
    scope = pack["scope_palaces"]
    assert scope["scheduled_count"] == 2
    assert scope["in_pool_count"] == 2
    reasons = {row["palace_id"]: row["reason"] for row in scope["palaces"]}
    assert set(reasons.values()) == {""}


def test_round_losing_a_palace_parks_its_overlay_progress(db_session):
    """When the *round* drops a palace, its answered progress parks and returns.

    Parking is about the round's review set changing, not about the config: the
    realistic shape is a learner answering 做题 questions for a palace whose
    review card they have not rated yet, then replanning the round without it.
    """
    kept = Palace(title="夸美纽斯")
    dropped = Palace(title="福禄培尔")
    db_session.add_all([kept, dropped])
    db_session.flush()
    q_kept = PalaceQuizQuestion(palace_id=kept.id, stem="夸美纽斯题")
    q_dropped = PalaceQuizQuestion(palace_id=dropped.id, stem="福禄培尔题")
    db_session.add_all([q_kept, q_dropped])
    db_session.commit()
    config = _config()

    def card(palace):
        return {
            "id": f"card-{palace.id}",
            "type": "mindmap_branch",
            "palace_id": palace.id,
            "unit_id": f"unit-{palace.id}",
        }

    round_state = get_or_create_active_round(
        db_session, workspace="secondary", scope_key="both", config=config,
        cards=[card(kept), card(dropped)], operation_id="create",
        round_id="secondary-scope-regression",
    )
    ensured = ensure_overlay_quiz(
        db_session, round_id=round_state["round_id"], operation_id="ensure-both",
        expected_version=round_state["version"], config=config,
    )
    assert set(ensured["plan"]["overlay_quiz"]["question_ids"]) == {q_kept.id, q_dropped.id}
    # The learner answered 做题 for both palaces before rating the review cards.
    progress_overlay_quiz(
        db_session, round_id=ensured["round_id"], operation_id="answered",
        expected_version=ensured["version"], completed_ids=[q_kept.id, q_dropped.id],
        states={str(q_kept.id): {"resolved": True}, str(q_dropped.id): {"resolved": True}},
    )
    # Replan the round down to one palace. Its unstarted card for 福禄培尔 is
    # dropped, so that palace leaves this round's review set.
    replanned = get_or_create_active_round(
        db_session, workspace="secondary", scope_key="both", config=config,
        cards=[card(kept)], operation_id="replan", replan=True,
    )
    narrowed = ensure_overlay_quiz(
        db_session, round_id=replanned["round_id"], operation_id="ensure-kept",
        expected_version=replanned["version"], config=config,
    )
    overlay = narrowed["plan"]["overlay_quiz"]
    assert overlay["question_ids"] == [q_kept.id]
    assert overlay["completed_ids"] == [q_kept.id]
    assert overlay["parked"]["completed_ids"] == [q_dropped.id]
    # A palace the round still schedules is never parked.
    assert q_kept.id not in overlay["parked"]["question_ids"]
    assert narrowed["round_id"] == round_state["round_id"]
