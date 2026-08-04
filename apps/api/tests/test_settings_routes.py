"""settings routes direct coverage for config, preferences, and AI registry."""
import pytest

from memory_anki.core.config import DEFAULTS
from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.modules.settings.presentation import router as settings_router


@pytest.fixture()
def client(make_client):
    return make_client(settings_router)


class TestSettings:
    def test_get_returns_defaults(self, client):
        response = client.get("/api/v1/settings")

        assert response.status_code == 200
        body = response.json()
        for key, value in DEFAULTS.items():
            assert body[key] == value

    def test_put_persists_known_key(self, client):
        response = client.put(
            "/api/v1/settings",
            json={"daily_new_limit": "35"},
        )

        assert response.status_code == 200
        assert response.json()["daily_new_limit"] == "35"
        assert client.get("/api/v1/settings").json()["daily_new_limit"] == "35"

    def test_review_quota_key_is_gone(self, client):
        """每日复习额度已删除，不应再出现在设置里。"""
        assert "daily_review_limit" not in client.get("/api/v1/settings").json()

    def test_put_ignores_unknown_key(self, client):
        response = client.put("/api/v1/settings", json={"not_a_real_key": "1"})

        assert response.status_code == 200
        assert "not_a_real_key" not in response.json()

    def test_read_settings_no_longer_filters_legacy_keys(self, db_session):
        db_session.add(Config(key="flow_voice_model", value="legacy-model"))
        db_session.commit()

        assert settings_router.read_settings(db_session)["flow_voice_model"] == "legacy-model"


class TestReviewSettings:
    def test_review_settings_apply_without_legacy_schedule_rebuild(
        self, client, session_factory
    ):
        # FSRS settings apply immediately; legacy stage rebuild was removed.
        response = client.put(
            "/api/v1/settings/review",
            json={"desired_retention": "0.85", "apply_to_pending": "all"},
        )
        assert response.status_code == 200
        assert response.json()["desired_retention"] == "0.85"
        with session_factory() as session:
            row = session.query(Config).filter_by(key="desired_retention").first()
            assert row is not None
            assert row.value == "0.85"

    def test_review_aliases_share_config(self, client):
        response = client.put(
            "/api/v1/settings/review",
            json={"daily_new_limit": "30"},
        )

        assert response.status_code == 200
        assert client.get("/api/v1/settings/review").json()["daily_new_limit"] == "30"

    def test_dead_legacy_keys_are_rejected(self, client):
        """死配置键（艾宾浩斯间隔、逾期平滑等）不再被接受或返回。"""
        response = client.put(
            "/api/v1/settings/review",
            json={"ebbinghaus_intervals": "1,2,4", "sleep_review_time": "22:00"},
        )
        assert response.status_code == 200
        body = client.get("/api/v1/settings/review").json()
        assert "ebbinghaus_intervals" not in body
        assert "sleep_review_time" not in body


class TestClientPreferences:
    def test_get_all_groups_default_none(self, client):
        response = client.get("/api/v1/profile/client-preferences")

        assert response.status_code == 200
        assert response.json()["items"] == {
            group: None for group in settings_router.CLIENT_PREFERENCE_GROUPS
        }

    def test_put_roundtrip(self, client):
        response = client.put(
            "/api/v1/profile/client-preferences",
            json={"review_feedback_settings": {"a": 1}},
        )

        assert response.status_code == 200
        assert response.json()["items"]["review_feedback_settings"] == {"a": 1}
        assert client.get("/api/v1/profile/client-preferences").json()["items"][
            "review_feedback_settings"
        ] == {"a": 1}

    def test_study_goals_roundtrip(self, client):
        response = client.put(
            "/api/v1/profile/client-preferences",
            json={"study_goals": {"weekly_study_minutes": 300, "weekly_review_count": 20}},
        )

        assert response.status_code == 200
        assert response.json()["items"]["study_goals"] == {
            "weekly_study_minutes": 300,
            "weekly_review_count": 20,
        }

    def test_put_unknown_group_ignored(self, client):
        response = client.put(
            "/api/v1/profile/client-preferences",
            json={"unknown_group": 1},
        )

        assert response.status_code == 200
        assert "unknown_group" not in response.json()["items"]

    def test_put_null_clears_value(self, client):
        client.put(
            "/api/v1/profile/client-preferences",
            json={"review_feedback_settings": {"a": 1}},
        )

        response = client.put(
            "/api/v1/profile/client-preferences",
            json={"review_feedback_settings": None},
        )

        assert response.status_code == 200
        assert response.json()["items"]["review_feedback_settings"] is None
        assert client.get("/api/v1/profile/client-preferences").json()["items"][
            "review_feedback_settings"
        ] is None


class TestAiModels:
    def test_get_scenarios_shape(self, client):
        response = client.get("/api/v1/settings/ai-models")

        assert response.status_code == 200
        body = response.json()
        assert set(body) >= {"providers", "categories", "models", "scenes", "summary"}
        assert body["summary"]["scene_count"] == len(body["scenes"])

    def test_catalog_upsert_invalid_payload_400(self, client):
        response = client.post("/api/v1/settings/ai-models/models", json={})

        assert response.status_code == 400
        assert response.json()["detail"]["message"] == "模型 key 不能为空。"

    def test_provider_test_invalid_provider_400(self, client):
        response = client.post("/api/v1/settings/ai-models/providers/not-a-provider/test")

        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "provider_invalid"


class TestAiCallLogs:
    def test_list_empty(self, client):
        response = client.get("/api/v1/ai-call-logs")

        assert response.status_code == 200
        assert response.json()["items"] == []

    def test_get_missing_404(self, client):
        response = client.get("/api/v1/ai-call-logs/nope")

        assert response.status_code == 404
