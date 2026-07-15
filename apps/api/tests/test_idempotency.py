"""Route-level mutation replay tests."""
import json
from datetime import date, timedelta

import pytest

from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    ReviewLog,
    ReviewSchedule,
)
from memory_anki.modules.reviews.presentation import router as review_router
from memory_anki.platform.application import MUTATION_ID_HEADER


def _seed_schedule(session_factory) -> int:
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
                        "children": [],
                    }
                }
            ),
        )
        session.add(palace)
        session.flush()
        schedule = ReviewSchedule(
            palace_id=palace.id,
            scheduled_date=date.today() - timedelta(days=1),
            interval_days=1,
            algorithm_used="ebbinghaus",
            completed=False,
            review_number=0,
            review_type="standard",
        )
        session.add(schedule)
        session.commit()
        return schedule.id


class TestSubmitRouteIdempotency:
    @pytest.fixture()
    def client(self, make_client):
        return make_client(review_router)

    def test_duplicate_mutation_id_returns_cached_response_without_second_log(
        self,
        client,
        session_factory,
    ):
        schedule_id = _seed_schedule(session_factory)
        headers = {MUTATION_ID_HEADER: "dup-1"}
        body = {"duration_seconds": 10, "completion_mode": "manual_complete"}

        first = client.post(
            f"/api/v1/review/session/{schedule_id}/submit",
            json=body,
            headers=headers,
        )
        assert first.status_code == 200
        second = client.post(
            f"/api/v1/review/session/{schedule_id}/submit",
            json=body,
            headers=headers,
        )
        assert second.status_code == 200
        assert second.json() == first.json()

        with session_factory() as session:
            assert session.query(ReviewLog).count() == 1

    def test_different_mutation_ids_do_not_reuse_cached_response(
        self,
        client,
        session_factory,
    ):
        schedule_id = _seed_schedule(session_factory)
        body = {"duration_seconds": 10, "completion_mode": "manual_complete"}
        first = client.post(
            f"/api/v1/review/session/{schedule_id}/submit",
            json=body,
            headers={MUTATION_ID_HEADER: "id-a"},
        )
        assert first.status_code == 200

        second = client.post(
            f"/api/v1/review/session/{schedule_id}/submit",
            json=body,
            headers={MUTATION_ID_HEADER: "id-b"},
        )
        assert second.status_code == 409
        assert second.json() == {
            "detail": {
                "code": "review_submit_conflict",
                "message": "该复习阶段已经完成，请刷新复习队列。",
            }
        }

    def test_no_header_executes_normally(self, client, session_factory):
        schedule_id = _seed_schedule(session_factory)
        response = client.post(
            f"/api/v1/review/session/{schedule_id}/submit",
            json={"duration_seconds": 5, "completion_mode": "manual_complete"},
        )
        assert response.status_code == 200
        assert response.json()["ok"] is True
