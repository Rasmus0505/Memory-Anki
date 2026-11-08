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
    monkeypatch.setattr(service, "list_unit_scheduling_nodes", lambda session, unit_ids: {
        "u2": {"palace_id": 1, "anchor_uid": "u2", "node_uids": ["node-2"]},
        "u3": {"palace_id": 1, "anchor_uid": "u3", "node_uids": ["node-3"]},
    })
    monkeypatch.setattr(service, "list_palace_node_paths", lambda session, palace_ids: {
        1: {"root_uid": "root-1", "parents": {}},
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
    monkeypatch.setattr(service, "list_unit_scheduling_nodes", lambda session, unit_ids: {
        "u2": {"palace_id": 1, "anchor_uid": "u2", "node_uids": ["node-2"]},
    })
    monkeypatch.setattr(service, "list_palace_node_paths", lambda session, palace_ids: {
        1: {"root_uid": "root-1", "parents": {}},
    })

    result = _progress(db_session, states={"11": {"resolved": True, "correct": False}})

    assert result["plan"]["wrong_unit_ids"] == ["u2"]
    assert result["plan"]["presented_ids"] == ["current", "done", "other"]
    assert result["wrong_priority"] == {"unit_count": 0, "palace_count": 0}


def test_root_only_wrong_question_marks_every_scheduled_unit_in_that_palace(db_session, monkeypatch):
    from memory_anki.modules.practice.application import round_overlay_service as service

    cards = [
        {"id": "current", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u1"},
        {"id": "other", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u2"},
        {"id": "different-palace", "type": "mindmap_branch", "palace_id": 2, "unit_id": "u3"},
    ]
    _seed(db_session, cards, {"question_ids": [11], "question_palace_ids": {"11": 1}})
    monkeypatch.setattr(service, "_serve", lambda session, row, **kw: _payload(row, **kw))
    monkeypatch.setattr(service, "list_node_bindings_for_palaces", lambda session, palace_ids: [
        {"question_id": 11, "node_uid": "root-1"},
    ])
    monkeypatch.setattr(service, "list_unit_scheduling_nodes", lambda session, unit_ids: {
        "u1": {"palace_id": 1, "anchor_uid": "u1", "node_uids": ["node-1"]},
        "u2": {"palace_id": 1, "anchor_uid": "u2", "node_uids": ["node-2"]},
        "u3": {"palace_id": 2, "anchor_uid": "u3", "node_uids": ["node-3"]},
    })
    monkeypatch.setattr(service, "list_palace_node_paths", lambda session, palace_ids: {
        1: {"root_uid": "root-1", "parents": {}},
        2: {"root_uid": "root-2", "parents": {}},
    })

    result = _progress(db_session, states={"11": {"resolved": True, "correct": False}})

    assert result["plan"]["wrong_unit_ids"] == ["u1", "u2"]


def test_wrong_question_marker_clears_after_correct_retry(db_session, monkeypatch):
    """当前答案改正确时题目红点消失，单元错题优先记录仍保留。"""
    from memory_anki.modules.practice.application import round_overlay_service as service

    cards = [{"id": "a", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u1"}]
    _seed(db_session, cards, {"question_ids": [11], "question_palace_ids": {"11": 1}})
    monkeypatch.setattr(service, "_serve", lambda session, row, **kw: _payload(row, **kw))
    monkeypatch.setattr(service, "list_node_bindings_for_palaces", lambda session, palace_ids: [
        {"question_id": 11, "node_uid": "node-1"},
    ])
    monkeypatch.setattr(service, "list_unit_scheduling_nodes", lambda session, unit_ids: {
        "u1": {"palace_id": 1, "anchor_uid": "u1", "node_uids": ["node-1"]},
    })
    monkeypatch.setattr(service, "list_palace_node_paths", lambda session, palace_ids: {
        1: {"root_uid": "root-1", "parents": {}},
    })

    wrong = _progress(db_session, states={"11": {"resolved": True, "correct": False}})
    assert wrong["plan"]["wrong_question_ids"] == ["11"]

    corrected = service.progress_overlay_quiz(
        db_session,
        round_id="unit-scope",
        operation_id="op-2",
        expected_version=2,
        states={"11": {"resolved": True, "correct": True}},
    )
    assert corrected["plan"]["wrong_question_ids"] == []


def test_correcting_one_question_preserves_other_wrong_questions(db_session, monkeypatch):
    from memory_anki.modules.practice.application import round_overlay_service as service

    cards = [{"id": "a", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u1"}]
    _seed(
        db_session,
        cards,
        {"question_ids": [11, 12], "question_palace_ids": {"11": 1, "12": 1}},
    )
    monkeypatch.setattr(service, "_serve", lambda session, row, **kw: _payload(row, **kw))

    wrong = _progress(
        db_session,
        states={
            "11": {"resolved": True, "correct": False},
            "12": {"resolved": True, "correct": False},
        },
    )
    corrected = service.progress_overlay_quiz(
        db_session,
        round_id="unit-scope",
        operation_id="op-2",
        expected_version=wrong["version"],
        states={
            "11": {"resolved": True, "correct": True},
            "12": {"resolved": True, "correct": False},
        },
    )

    assert corrected["plan"]["wrong_question_ids"] == ["12"]


def test_small_settlement_clears_wrong_markers_for_settled_units(db_session, monkeypatch):
    """小结算同时清掉节点角标与进度条的错误标记，未结算单元保持。"""
    import json

    from memory_anki.modules.practice.application import (
        round_settlement as settlement,
    )
    from memory_anki.modules.practice.application import round_state_service as service
    from memory_anki.modules.practice.domain.round_plan import plan_from_cards

    cards = [
        {"id": "a", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u1"},
        {"id": "b", "type": "mindmap_branch", "palace_id": 1, "unit_id": "u2"},
    ]
    plan = plan_from_cards(cards)
    plan["completed_ids"] = ["a"]
    plan["overlay_quiz"] = {
        "question_ids": [11, 12],
        "question_palace_ids": {"11": 1, "12": 1},
        "states": {
            "11": {"resolved": True, "correct": False},
            "12": {"resolved": True, "correct": False},
        },
    }
    plan["wrong_question_ids"] = ["11", "12"]
    plan["wrong_unit_ids"] = ["u1", "u2"]
    db_session.add(FreestyleRoundState(
        round_id="settle",
        scope_key="settle",
        version=1,
        plan_json=json.dumps(plan),
        config_json="{}",
        current_card_id="a",
    ))
    db_session.commit()
    # 小结算的错题清理已从 round_state_service 抽到 round_settlement；
    # 补丁要打在实际调用依赖的模块上。
    monkeypatch.setattr(settlement, "list_unit_node_members", lambda session, unit_ids: {"u1": ["node-1"]})
    monkeypatch.setattr(settlement, "list_node_bindings_for_palaces", lambda session, palace_ids: [
        {"question_id": 11, "node_uid": "node-1"},
    ])

    result = service.apply_round_action(
        db_session,
        round_id="settle",
        action="compress_completed",
        operation_id="settle-op",
        expected_version=1,
        partial_settlement={"id": "s1", "card_ids": ["a"]},
    )

    assert result["plan"]["wrong_question_ids"] == ["12"]
    assert result["plan"]["wrong_unit_ids"] == ["u2"]
    assert result["plan"]["overlay_quiz"]["states"] == {"12": {"resolved": True, "correct": False}}
    assert result["status"] == "active"
