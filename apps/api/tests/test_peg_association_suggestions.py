import json

import pytest

from memory_anki.infrastructure.db._tables.misc import Config
from memory_anki.modules.knowledge.application import chapter_service, subject_service
from memory_anki.modules.knowledge.presentation import router as knowledge_router
from memory_anki.modules.palaces.application import peg_association_service as service
from memory_anki.modules.palaces.presentation import router as palace_router
from memory_anki.modules.settings.application import ai_model_registry_runtime


@pytest.fixture(autouse=True)
def _no_rolling_backup(monkeypatch):
    monkeypatch.setattr(
        palace_router,
        "maybe_create_rolling_backup",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        chapter_service,
        "maybe_create_rolling_backup",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        subject_service,
        "maybe_create_rolling_backup",
        lambda *args, **kwargs: None,
    )


@pytest.fixture()
def client(make_client):
    return make_client(palace_router, knowledge_router)


def _create_palace(client) -> int:
    response = client.post(
        "/api/v1/palaces",
        json={
            "title": "细胞能量宫殿",
            "description": "细胞结构与能量转换",
            "pegs": [
                {"name": "厨房灶台", "content": "灶台上的火等于线粒体产能"},
                {"name": "冰箱门", "content": "贴着物质进出清单"},
            ],
        },
    )
    assert response.status_code == 200
    return response.json()["id"]


def _clear_provider_env_defaults(monkeypatch):
    for provider in ("dashscope", "qwen", "zhipu", "siliconflow", "deepseek"):
        monkeypatch.setitem(
            ai_model_registry_runtime.PROVIDER_ENV_DEFAULTS,
            provider,
            {"api_key": "", "base_url": "https://example.test/v1"},
        )


def test_peg_association_suggestions_fallback_is_deterministic(client, monkeypatch):
    _clear_provider_env_defaults(monkeypatch)
    palace_id = _create_palace(client)
    payload = {
        "knowledge_text": "线粒体通过有氧呼吸生成 ATP。\n细胞膜控制物质进出。",
        "max_suggestions": 2,
    }

    first = client.post(
        f"/api/v1/palaces/{palace_id}/peg-association-suggestions",
        json=payload,
    )
    second = client.post(
        f"/api/v1/palaces/{palace_id}/peg-association-suggestions",
        json=payload,
    )

    assert first.status_code == 200
    assert first.json() == second.json()
    body = first.json()
    assert body["source"] == "fallback"
    assert body["fallback_reason"] == "missing_ai_key"
    assert len(body["suggestions"]) == 2
    assert body["suggestions"][0]["peg_name"] == "厨房灶台"
    assert "线粒体" in body["suggestions"][0]["knowledge_text"]


def test_peg_association_suggestions_uses_linked_chapter_context(client, monkeypatch):
    _clear_provider_env_defaults(monkeypatch)
    palace_id = _create_palace(client)
    subject = client.post("/api/v1/subjects", json={"name": "生物"}).json()
    chapter = client.post(
        f"/api/v1/subjects/{subject['id']}/chapters",
        json={"name": "细胞呼吸", "notes": "葡萄糖氧化分解释放能量并合成 ATP。"},
    ).json()
    link_response = client.put(
        f"/api/v1/palaces/{palace_id}/knowledge-binding",
        json={
            "subject_ids": [subject["id"]],
            "chapter_ids": [chapter["id"]],
            "primary_chapter_id": chapter["id"],
            "base_revision": 0,
            "operation_id": "peg-association-bind",
        },
    )
    assert link_response.status_code == 200

    response = client.post(
        f"/api/v1/palaces/{palace_id}/peg-association-suggestions",
        json={"max_suggestions": 1},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "fallback"
    assert body["knowledge_items"][0]["source"] == "chapter"
    assert "细胞呼吸" in body["knowledge_items"][0]["text"]


def test_peg_association_suggestions_can_use_ai_response(
    client,
    session_factory,
    monkeypatch,
):
    palace_id = _create_palace(client)
    with session_factory() as session:
        session.add_all(
            [
                Config(key="dashscope_api_key", value="test-key"),
                Config(key="dashscope_base_url", value="https://dashscope.example/v1"),
            ]
        )
        session.commit()

    def fake_call_chat_completion_text(**kwargs):
        messages = kwargs["messages"]
        assert "厨房灶台" in messages[-1]["content"]
        return json.dumps(
            {
                "suggestions": [
                    {
                        "peg_id": 1,
                        "knowledge_text": "线粒体生成 ATP",
                        "association": "把 ATP 想成灶台上不断冒出的能量火花。",
                        "rationale": "灶台的热量和线粒体供能形成稳定画面。",
                        "keywords": ["ATP", "灶台"],
                    }
                ]
            },
            ensure_ascii=False,
        )

    monkeypatch.setattr(service, "call_chat_completion_text", fake_call_chat_completion_text)

    response = client.post(
        f"/api/v1/palaces/{palace_id}/peg-association-suggestions",
        json={"knowledge_text": "线粒体生成 ATP", "max_suggestions": 3},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source"] == "ai"
    assert body["suggestions"] == [
        {
            "id": "ai-1",
            "peg_id": 1,
            "peg_name": "厨房灶台",
            "peg_path": ["厨房灶台"],
            "knowledge_text": "线粒体生成 ATP",
            "association": "把 ATP 想成灶台上不断冒出的能量火花。",
            "rationale": "灶台的热量和线粒体供能形成稳定画面。",
            "keywords": ["ATP", "灶台"],
            "source": "ai",
        }
    ]


def test_peg_association_suggestions_missing_palace_returns_404(client):
    response = client.post(
        "/api/v1/palaces/99999/peg-association-suggestions",
        json={"knowledge_text": "x"},
    )

    assert response.status_code == 404
