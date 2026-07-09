"""persistence idempotency unit and route-level tests."""
import json
from datetime import date, timedelta

import pytest

from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.infrastructure.db._tables.palaces import (
    Palace,
    ReviewLog,
    ReviewSchedule,
)
from memory_anki.modules.persistence.application.idempotency import (
    MUTATION_ID_HEADER,
    get_idempotent_response,
    read_mutation_id,
    save_idempotent_response,
)
from memory_anki.modules.reviews.presentation import router as review_router


class FakeRequest:
    """Minimal Request stand-in; idempotency only reads headers."""

    def __init__(self, headers: dict[str, str]):
        self.headers = headers


class TestReadMutationId:
    def test_none_request_returns_none(self):
        assert read_mutation_id(None) is None

    def test_missing_header_returns_none(self):
        assert read_mutation_id(FakeRequest({})) is None

    def test_blank_header_returns_none(self):
        assert read_mutation_id(FakeRequest({MUTATION_ID_HEADER: "   "})) is None

    def test_overlong_header_returns_none(self):
        assert read_mutation_id(FakeRequest({MUTATION_ID_HEADER: "x" * 81})) is None

    def test_valid_header_is_stripped(self):
        assert read_mutation_id(FakeRequest({MUTATION_ID_HEADER: " abc "})) == "abc"


class TestSaveAndGet:
    def test_roundtrip(self, db_session):
        request = FakeRequest({MUTATION_ID_HEADER: "mut-1"})
        save_idempotent_response(db_session, request, {"ok": True, "score": 3})
        assert get_idempotent_response(db_session, request) == {"ok": True, "score": 3}

    def test_no_header_saves_nothing(self, db_session):
        save_idempotent_response(db_session, FakeRequest({}), {"ok": True})
        assert db_session.query(Config).count() == 0

    def test_get_without_saved_row_returns_none(self, db_session):
        assert get_idempotent_response(
            db_session,
            FakeRequest({MUTATION_ID_HEADER: "unknown"}),
        ) is None

    def test_corrupt_stored_json_returns_none(self, db_session):
        db_session.add(Config(key="api_mutation.bad", value="{not json"))
        db_session.commit()
        assert get_idempotent_response(
            db_session,
            FakeRequest({MUTATION_ID_HEADER: "bad"}),
        ) is None

    def test_save_overwrites_existing_row(self, db_session):
        request = FakeRequest({MUTATION_ID_HEADER: "mut-2"})
        save_idempotent_response(db_session, request, {"v": 1})
        save_idempotent_response(db_session, request, {"v": 2})
        assert get_idempotent_response(db_session, request) == {"v": 2}
        assert db_session.query(Config).filter(Config.key.like("api_mutation.%")).count() == 1


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
        assert second.status_code == 404
        assert second.json() == {"detail": "not found"}

    def test_no_header_executes_normally(self, client, session_factory):
        schedule_id = _seed_schedule(session_factory)
        response = client.post(
            f"/api/v1/review/session/{schedule_id}/submit",
            json={"duration_seconds": 5, "completion_mode": "manual_complete"},
        )
        assert response.status_code == 200
        assert response.json()["ok"] is True
