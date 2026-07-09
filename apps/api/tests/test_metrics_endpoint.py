from memory_anki.modules.settings.application.metrics_service import build_metrics
from memory_anki.modules.settings.presentation import router as settings_router


def test_build_metrics_shape(db_session):
    payload = build_metrics(db_session)

    assert "generated_at" in payload
    assert payload["database"]["path"]
    assert "size_bytes" in payload["database"]
    assert isinstance(payload["table_row_counts"], dict)
    assert "palaces" in payload["table_row_counts"]
    assert set(payload["ai_calls_last_24h"]) == {"total", "failed"}
    assert "latest_backup" in payload


def test_metrics_endpoint_shape(make_client):
    client = make_client(settings_router)

    response = client.get("/api/v1/metrics")

    assert response.status_code == 200
    payload = response.json()
    assert "database" in payload
    assert "palaces" in payload["table_row_counts"]
    assert set(payload["ai_calls_last_24h"]) == {"total", "failed"}
