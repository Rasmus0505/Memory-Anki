"""API tests for freestyle immersive queue build."""

from __future__ import annotations

import json
from datetime import date

from memory_anki.infrastructure.db._tables.knowledge import Subject
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.infrastructure.db._tables.unit_reviews import ReviewUnitState
from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.memory.application.unit_review_projection import reconcile_palace_units
from memory_anki.modules.memory.presentation import router as review_router
from memory_anki.modules.practice.domain.study_window import take_study_window
from memory_anki.modules.practice.presentation import router as freestyle_router


def test_queue_build_requires_operation_id(make_client):
    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    response = client.post("/api/v1/freestyle/queue/build", json={"config": {}})
    assert response.status_code == 422


def test_queue_build_echoes_operation_and_sanitized_config(make_client):
    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    response = client.post(
        "/api/v1/freestyle/queue/build",
        json={
            "operation_id": "op-test-1",
            "config": {
                "node_limit": 12,
                "progress_scopes": ["reinforcement"],
                "queue_length": 20,
                "seed": 7,
                "content": {"mindmap_branch": True, "quiz_question": True},
            },
            "completed_ids": [],
            "hidden_ids": [],
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["operation_id"] == "op-test-1"
    assert "node_limit" not in payload["config"]
    assert "progress_scopes" not in payload["config"]
    assert payload["config"]["queue_length"] == 20
    assert "cards" in payload
    assert "phase_stats" in payload
    assert payload["counts"]["total"] == len(payload["cards"])


def test_queue_build_accepts_empty_palace_filter(make_client):
    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    response = client.post(
        "/api/v1/freestyle/queue/build",
        json={
            "operation_id": "op-empty",
            "config": {
                "specific_palace_ids": [999999],
                "content": {"mindmap_branch": True, "quiz_question": True},
            },
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["cards"] == []
    assert payload["counts"]["total"] == 0


def test_queue_build_returns_due_units_for_selected_palace(session_factory, make_client):
    session = session_factory()
    palace = Palace(
        title="Selected palace",
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "Selected palace", "permanentSplitMark": True},
                    "children": [
                        {"data": {"uid": "branch", "text": "Due branch"}, "children": []},
                    ],
                }
            }
        ),
    )
    session.add(palace)
    session.commit()
    reconcile_palace_units(session, palace.id)
    session.commit()
    palace_id = palace.id
    session.close()
    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    response = client.post(
        "/api/v1/freestyle/queue/build",
        json={
            "operation_id": "op-selected-palace",
            "config": {
                "specific_palace_ids": [palace_id],
                "content": {
                    "mindmap_branch": True,
                    "anki_card": False,
                    "quiz_question": False,
                },
                "mix_mode": "mindmap_only",
                "due_policy": "due_only",
                "queue_length": 20,
            },
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["phase_stats"]["due_unit_count"] == 1
    assert payload["counts"]["mindmap_branch"] == 1
    assert {card["palace_id"] for card in payload["cards"]} == {palace_id}


def test_queue_build_unions_subject_scope_with_explicit_palace(session_factory, make_client):
    session = session_factory()
    english = Subject(name="英语")
    education = Subject(name="教育学")
    session.add_all([english, education])
    session.flush()

    def add_palace(title: str, subject: Subject, uid: str):
        palace = Palace(
            title=title,
            subjects=[subject],
            editor_doc=json.dumps(
                {
                    "root": {
                        "data": {"uid": f"{uid}-root", "text": title, "permanentSplitMark": True},
                        "children": [{"data": {"uid": uid, "text": "Due branch"}, "children": []}],
                    }
                }
            ),
        )
        session.add(palace)
        session.flush()
        reconcile_palace_units(session, palace.id)
        return palace

    english_palace = add_palace("English palace", english, "english-branch")
    education_palace = add_palace("卢梭的教育思想", education, "rousseau-branch")
    session.commit()
    english_id = english_palace.id
    education_id = education_palace.id
    session.close()

    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    response = client.post(
        "/api/v1/freestyle/queue/build",
        json={
            "operation_id": "op-subject-plus-explicit",
            "config": {
                "specific_palace_ids": [education_id],
                "subject_scope": "english",
                "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
                "mix_mode": "mindmap_only",
                "due_policy": "due_only",
                "queue_length": 20,
            },
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert {card["palace_id"] for card in payload["cards"]} == {english_id, education_id}


def test_queue_build_subject_ids_does_not_include_other_subjects(session_factory, make_client):
    session = session_factory()
    english = Subject(name="英语")
    education = Subject(name="教育学")
    session.add_all([english, education])
    session.flush()

    def add_palace(title: str, subject: Subject, uid: str):
        palace = Palace(
            title=title,
            subjects=[subject],
            editor_doc=json.dumps(
                {
                    "root": {
                        "data": {"uid": f"{uid}-root", "text": title, "permanentSplitMark": True},
                        "children": [{"data": {"uid": uid, "text": "Due branch"}, "children": []}],
                    }
                }
            ),
        )
        session.add(palace)
        session.flush()
        reconcile_palace_units(session, palace.id)
        return palace

    add_palace("English palace", english, "english-branch")
    education_palace = add_palace("卢梭的教育思想", education, "rousseau-branch")
    session.commit()
    education_subject_id = education.id
    education_palace_id = education_palace.id
    session.close()

    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    response = client.post(
        "/api/v1/freestyle/queue/build",
        json={
            "operation_id": "op-subject-ids-education",
            "config": {
                "training_mode": "memory_palace",
                "streams": {
                    "memory_palace": {
                        "subject_ids": [education_subject_id],
                        "subject_scope": "all",
                        "specific_palace_ids": [],
                        "due_policy": "due_only",
                    }
                },
                "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
                "mix_mode": "mindmap_only",
                "due_policy": "due_only",
                "queue_length": 20,
            },
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert {card["palace_id"] for card in payload["cards"]} == {education_palace_id}


def test_queue_build_legacy_english_training_mode_uses_english_palaces(session_factory, make_client):
    session = session_factory()
    english = Subject(name="英语")
    education = Subject(name="教育学")
    session.add_all([english, education])
    session.flush()

    def add_palace(title: str, subject: Subject, uid: str):
        palace = Palace(
            title=title,
            subjects=[subject],
            editor_doc=json.dumps(
                {
                    "root": {
                        "data": {"uid": f"{uid}-root", "text": title, "permanentSplitMark": True},
                        "children": [{"data": {"uid": uid, "text": "Due branch"}, "children": []}],
                    }
                }
            ),
        )
        session.add(palace)
        session.flush()
        reconcile_palace_units(session, palace.id)
        return palace

    english_palace = add_palace("English palace", english, "english-branch")
    add_palace("卢梭的教育思想", education, "rousseau-branch")
    session.commit()
    english_palace_id = english_palace.id
    session.close()

    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    response = client.post(
        "/api/v1/freestyle/queue/build",
        json={
            "operation_id": "op-legacy-english-mode",
            "config": {
                "training_mode": "english",
                "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
                "mix_mode": "mindmap_only",
                "due_policy": "due_only",
                "queue_length": 20,
            },
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["config"]["training_mode"] == "memory_palace"
    assert payload["config"]["streams"]["memory_palace"]["subject_scope"] == "english"
    assert {card["palace_id"] for card in payload["cards"]} == {english_palace_id}


def test_queue_revision_can_start_review_after_projection_reconciliation(
    session_factory,
    make_client,
):
    session = session_factory()
    palace = Palace(
        title="卢梭的教育思想",
        editor_doc=json.dumps(
            {
                "root": {
                    "data": {"uid": "root", "text": "卢梭的教育思想", "permanentSplitMark": True},
                    "children": [{"data": {"uid": "branch", "text": "旧内容"}, "children": []}],
                }
            },
            ensure_ascii=False,
        ),
    )
    session.add(palace)
    session.commit()
    reconcile_palace_units(session, palace.id)
    session.commit()

    palace.editor_doc = json.dumps(
        {
            "root": {
                "data": {"uid": "root", "text": "卢梭的教育思想", "permanentSplitMark": True},
                "children": [{"data": {"uid": "branch", "text": "新内容"}, "children": []}],
            }
        },
        ensure_ascii=False,
    )
    session.commit()
    palace_id = palace.id
    session.close()

    freestyle_router.session_dep = session_dep
    queue_client = make_client(freestyle_router)
    queued = queue_client.post(
        "/api/v1/freestyle/queue/build",
        json={
            "operation_id": "op-rousseau-reconciled",
            "config": {
                "specific_palace_ids": [palace_id],
                "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
                "mix_mode": "mindmap_only",
                "due_policy": "due_only",
                "queue_length": 20,
            },
        },
    )

    assert queued.status_code == 200, queued.text
    card = queued.json()["cards"][0]
    assert card["palace_id"] == palace_id
    with session_factory() as before_open:
        stored = before_open.get(ReviewUnitState, card["unit_id"])
        assert stored is not None
        # Queue build trusts the stored row and does not reconcile editor_doc.
        assert stored.revision == card["unit_revision"]
        trusted_revision = stored.revision

    review_router.session_dep = session_dep
    review_client = make_client(review_router)
    started = review_client.post(
        f"/api/v1/review/units/{card['unit_id']}/sessions",
        json={
            "unit_revision": card["unit_revision"],
            "round_id": "round-rousseau-reconciled",
            "encounter_id": "encounter-rousseau-reconciled",
        },
    )

    assert started.status_code == 200, started.text
    live_revision = started.json()["item"]["units"][0]["revision"]
    with session_factory() as check:
        state = check.get(ReviewUnitState, card["unit_id"])
        assert state is not None
        assert state.revision == live_revision
    # Opening the unit reconciles the edited document and adopts that revision.
    assert live_revision == trusted_revision + 1


def _window_card(card_id: str, palace_id: int) -> dict:
    return {"id": card_id, "palace_id": palace_id}


def test_take_study_window_stops_at_eight_or_the_first_palace_boundary():
    same_palace = [_window_card(f"c{index}", 1) for index in range(20)]
    assert [card["id"] for card in take_study_window(same_palace)] == [
        f"c{index}" for index in range(8)
    ]

    short_then_next = [_window_card(f"a{index}", 1) for index in range(3)] + [
        _window_card("b0", 2)
    ]
    assert [card["id"] for card in take_study_window(short_then_next)] == ["a0", "a1", "a2"]

    interleaved = [
        _window_card("a", 1),
        _window_card("b", 2),
        _window_card("a2", 1),
    ]
    assert [card["id"] for card in take_study_window(interleaved)] == ["a"]


def _due_row(palace_id: int, unit_id: str) -> ReviewUnitState:
    return ReviewUnitState(
        id=unit_id,
        palace_id=palace_id,
        anchor_uid=unit_id,
        unit_kind="mark",
        node_uids_json="[]",
        membership_hash=f"membership-{unit_id}",
        content_hash=f"content-{unit_id}",
        revision=1,
        stage_index=0,
        has_passed=False,
        due_date=date.today(),
        active=True,
    )


def test_same_day_due_units_follow_topology_order(session_factory):
    from memory_anki.modules.memory.api import list_trusted_due_units_for_queue

    session = session_factory()
    palace = Palace(title="顺序宫殿", editor_doc="{}", archived=False, group_sort_order=0)
    session.add(palace)
    session.flush()
    session.add(
        ReviewUnitState(
            id="unit-branch",
            palace_id=palace.id,
            anchor_uid="B1",
            unit_kind="mark",
            node_uids_json='["B1","C1"]',
            membership_hash="branch",
            content_hash="branch",
            revision=1,
            stage_index=2,
            has_passed=True,
            due_date=date.today(),
            topology_order=1,
            active=True,
        )
    )
    session.add(
        ReviewUnitState(
            id="unit-cohort",
            palace_id=palace.id,
            anchor_uid="A",
            unit_kind="cohort",
            node_uids_json='["B1","B2"]',
            membership_hash="cohort",
            content_hash="cohort",
            revision=1,
            stage_index=2,
            has_passed=True,
            due_date=date.today(),
            topology_order=0,
            active=True,
        )
    )
    session.commit()
    palace_id = palace.id
    rows = list_trusted_due_units_for_queue(session, [palace_id])
    session.close()
    assert [row["id"] for row in rows] == ["unit-cohort", "unit-branch"]
    assert rows[0]["unit_kind"] == "cohort"


def test_queue_study_window_is_a_prefix_of_the_full_order(session_factory, make_client):
    session = session_factory()
    first = Palace(
        title="Stored title",
        manual_title="Manual title",
        editor_doc="{}",
        archived=False,
        group_sort_order=0,
    )
    second = Palace(
        title="Second palace",
        editor_doc="{}",
        archived=False,
        group_sort_order=1,
    )
    session.add_all([first, second])
    session.flush()
    session.add(_due_row(first.id, "unit-first"))
    session.add(_due_row(second.id, "unit-second"))
    session.commit()
    first_id = first.id
    second_id = second.id
    session.close()

    freestyle_router.session_dep = session_dep
    client = make_client(freestyle_router)
    config = {
        "training_mode": "memory_palace",
        "specific_palace_ids": [first_id, second_id],
        "streams": {
            "memory_palace": {
                "palace_order": "finish_palace_then_next",
                "subject_scope": "all",
                "specific_palace_ids": [first_id, second_id],
            }
        },
        "content": {"mindmap_branch": True, "anki_card": False, "quiz_question": False},
        "mix_mode": "mindmap_only",
        "due_policy": "due_only",
        "queue_length": 20,
    }
    windowed = client.post(
        "/api/v1/freestyle/queue/build",
        json={"operation_id": "op-window", "study_window": True, "config": config},
    )
    assert windowed.status_code == 200, windowed.text
    window_payload = windowed.json()
    assert window_payload["round_meta"]["tail_pending"] is True
    assert len(window_payload["cards"]) == 1
    assert window_payload["cards"][0]["palace_id"] == first_id
    assert window_payload["cards"][0]["palace_title"] == "Manual title"
    assert window_payload["phase_stats"]["candidate_count"] == 2

    full = client.post(
        "/api/v1/freestyle/queue/build",
        json={"operation_id": "op-full", "study_window": False, "config": config},
    )
    assert full.status_code == 200, full.text
    full_payload = full.json()
    assert full_payload["round_meta"]["tail_pending"] is False
    assert [card["palace_id"] for card in full_payload["cards"]] == [first_id, second_id]
    assert full_payload["cards"][0]["id"] == window_payload["cards"][0]["id"]
