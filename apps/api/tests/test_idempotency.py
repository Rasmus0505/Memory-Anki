"""Route-level mutation replay tests."""

import json
from datetime import timedelta

import pytest

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewLog
from memory_anki.infrastructure.db._tables.reviews import ReviewNodeState
from memory_anki.modules.memory.application.formal_review_service import (
    start_or_resume_formal_review,
)
from memory_anki.modules.memory.presentation import router as review_router
from memory_anki.platform.application import MUTATION_ID_HEADER


def _seed_session(session_factory) -> str:
    with session_factory() as session:
        palace = Palace(
            title="Idempotency Palace",
            description="",
            difficulty=0,
            review_mode="review",
            editor_doc=json.dumps(
                {
                    "root": {
                        "data": {"text": "Idempotency Palace", "uid": "root"},
                        "children": [{"data": {"text": "Node", "uid": "node-1"}, "children": []}],
                    }
                }
            ),
        )
        session.add(palace)
        session.flush()
        past = utc_now_naive() - timedelta(days=1)
        session.add(
            ReviewNodeState(
                palace_id=palace.id,
                node_uid="node-1",
                state=2,
                stability=3.0,
                difficulty=5.0,
                due_at=past,
                raw_due_at=past,
                last_review_at=past - timedelta(days=3),
                schedule_source="manual",
                content_fingerprint="",
            )
        )
        session.commit()
        return start_or_resume_formal_review(session, palace.id).id


class TestSubmitRouteIdempotency:
    @pytest.fixture()
    def client(self, make_client):
        return make_client(review_router)

    def test_duplicate_mutation_id_returns_cached_response_without_second_log(
        self,
        client,
        session_factory,
    ):
        session_id = _seed_session(session_factory)
        # Wave rule: settle frozen nodes before complete.
        rate = client.post(
            f"/api/v1/review/session/{session_id}/rate-unrated",
            json={"rating": 3, "operation_id": "idempotency-settlement"},
        )
        assert rate.status_code == 200
        headers = {MUTATION_ID_HEADER: "dup-1"}
        body = {"duration_seconds": 10, "completion_mode": "manual_complete"}

        first = client.post(
            f"/api/v1/review/session/{session_id}/submit",
            json=body,
            headers=headers,
        )
        assert first.status_code == 200
        second = client.post(
            f"/api/v1/review/session/{session_id}/submit",
            json=body,
            headers=headers,
        )
        assert second.status_code == 200
        assert second.json() == first.json()

        with session_factory() as session:
            assert session.query(ReviewLog).count() == 1
