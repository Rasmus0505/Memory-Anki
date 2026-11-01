"""错题优先 hoists only the review units a wrong question is bound to.

The previous rule resolved each wrong unit to its palace and hoisted **every**
card of that palace, so one mistake reordered the palace's whole remaining
queue. The switch now moves the bound units only, and reports how many units
and palaces it actually moved so the 做题 window can confirm it took effect.
"""

import json

from memory_anki.infrastructure.db._tables.misc import FreestyleRoundState
from memory_anki.modules.practice.application.round_state_payload import _payload
from memory_anki.modules.practice.domain.round_plan import plan_from_cards


def _seed(db_session, cards, overlay_quiz, *, completed_ids=()):
    plan = plan_from_cards(cards)
    plan["completed_ids"] = list(completed_ids)
    plan["overlay_quiz"] = overlay_quiz
    db_session.add(FreestyleRoundState(
        round_id="unit-scope",
        scope_key="unit-scope",
        version=1,
        plan_json=json.dumps(plan),
        config_json="{}",
        current_card_id=cards[0]["id"],
    ))
    db_session.commit()


def _progress(db_session, **kwargs):
    from memory_anki.modules.practice.application import round_overlay_service as service
    return service.progress_overlay_quiz(
        db_session,
        round_id="unit-scope",
        operation_id="op-1",
        expected_version=1,
        auto_prioritize_wrong_palaces=True,
        **kwargs,
    )


def test_prioritize_hoists_bound_unit_and_not_its_palace_siblings(db_session, monkeypatch):
    from memory_anki.modules.practice.application import round_overlay_service as service

    cards = [
        {"id": "current", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u1"},
        {"id": "sibling", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u2"},
        {"id": "target", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u3"},
        {"id": "elsewhere", "type": "mindmap_branch", "palace_id": 2, "unit_id": "u4"},
    ]
    _seed(db_session, cards, {"question_ids": [11], "question_palace_ids": {"11": 1}})
    monkeypatch.setattr(service, "_serve", lambda session, row, **kw: _payload(row, **kw))
    monkeypatch.setattr(service, "list_node_bindings_for_palaces", lambda session, palace_ids: [
        {"question_id": 11, "node_uid": "node-3"},
    ])
    monkeypatch.setattr(service, "list_unit_node_members", lambda session, unit_ids: {
        "u2": ["node-2"],
        "u3": ["node-3"],
    })

    result = _progress(db_session, states={"11": {"resolved": True, "correct": False}})

    assert result["plan"]["wrong_unit_ids"] == ["u3"]
    # u2 shares the palace but is bound to no wrong question, so it stays put.
    assert result["plan"]["presented_ids"] == ["current", "target", "sibling", "elsewhere"]
    assert result["wrong_priority"] == {"unit_count": 1, "palace_count": 1}
    db_session.expire_all()
    saved = json.loads(db_session.get(FreestyleRoundState, "unit-scope").plan_json)
    assert saved["presented_ids"] == ["current", "target", "sibling", "elsewhere"]


def test_prioritize_reports_nothing_when_the_bound_unit_is_already_done(db_session, monkeypatch):
    from memory_anki.modules.practice.application import round_overlay_service as service

    cards = [
        {"id": "current", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u1"},
        {"id": "done", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u2"},
        {"id": "other", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u3"},
    ]
    _seed(
        db_session,
        cards,
        {"question_ids": [11], "question_palace_ids": {"11": 1}},
        completed_ids=["done"],
    )
    monkeypatch.setattr(service, "_serve", lambda session, row, **kw: _payload(row, **kw))
    monkeypatch.setattr(service, "list_node_bindings_for_palaces", lambda session, palace_ids: [
        {"question_id": 11, "node_uid": "node-2"},
    ])
    monkeypatch.setattr(service, "list_unit_node_members", lambda session, unit_ids: {
        "u2": ["node-2"],
    })

    result = _progress(db_session, states={"11": {"resolved": True, "correct": False}})

    assert result["plan"]["wrong_unit_ids"] == ["u2"]
    assert result["plan"]["presented_ids"] == ["current", "done", "other"]
    assert result["wrong_priority"] == {"unit_count": 0, "palace_count": 0}
