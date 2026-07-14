"""settings AI model, prompt, and call-log route coverage."""
import json
import unittest
from unittest.mock import patch

from memory_anki.infrastructure.db._tables.misc import Config, ExternalAiCallLog
from memory_anki.modules.settings.application.ai_model_registry import resolve_scenario_runtime
from memory_anki.modules.settings.presentation import router as settings_router
from support import RouterTestCase


class SettingsAiRouteTests(RouterTestCase):
    ROUTER_MODULES = (settings_router,)

    def test_review_settings_include_ai_split_defaults(self):
        response = self.client.get("/api/v1/settings/review")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["mindmap_ai_split_model"], "qwen3.6-flash")
        self.assertEqual(payload["mindmap_ai_split_temperature"], "0.2")
        self.assertEqual(payload["mindmap_ai_split_max_children"], "5")
        self.assertEqual(payload["mindmap_ai_split_include_note"], "true")
        self.assertIn("mindmap_ai_split_custom_instruction", payload)

    def test_review_settings_can_persist_ai_split_config(self):
        response = self.client.put(
            "/api/v1/settings/review",
            json={
                "mindmap_ai_split_api_key": "demo-key",
                "mindmap_ai_split_base_url": "https://example.test/v1",
                "mindmap_ai_split_model": "qwen-custom",
                "mindmap_ai_split_temperature": "0.6",
                "mindmap_ai_split_max_children": "7",
                "mindmap_ai_split_include_note": "false",
                "mindmap_ai_split_custom_instruction": "优先按考试框架拆分。",
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["mindmap_ai_split_api_key"], "demo-key")
        self.assertEqual(payload["mindmap_ai_split_base_url"], "https://example.test/v1")
        self.assertEqual(payload["mindmap_ai_split_model"], "qwen-custom")
        self.assertEqual(payload["mindmap_ai_split_temperature"], "0.6")
        self.assertEqual(payload["mindmap_ai_split_max_children"], "7")
        self.assertEqual(payload["mindmap_ai_split_include_note"], "false")
        self.assertEqual(payload["mindmap_ai_split_custom_instruction"], "优先按考试框架拆分。")

    def test_ai_prompt_settings_can_list_save_and_reset_templates(self):
        list_response = self.client.get("/api/v1/settings/ai-prompts")
        self.assertEqual(list_response.status_code, 200)
        items = list_response.json()["items"]
        target = next(item for item in items if item["key"] == "ai_prompt_import_batch_mindmap")
        self.assertIn("{{structure_tree_json}}", target["template"])

        custom_template = "自定义批量提示词\n" "{{structure_tree_json}}\n" "请严格输出 JSON。"
        save_response = self.client.put(
            "/api/v1/settings/ai-prompts",
            json={"templates": {"ai_prompt_import_batch_mindmap": custom_template}},
        )
        self.assertEqual(save_response.status_code, 200)
        saved_target = next(
            item
            for item in save_response.json()["items"]
            if item["key"] == "ai_prompt_import_batch_mindmap"
        )
        self.assertNotEqual(saved_target["template"], custom_template)
        self.assertFalse(saved_target["is_customized"])
        self.assertTrue(save_response.json()["requires_evaluation"])
        candidate = save_response.json()["candidates"][0]
        self.assertEqual(candidate["template"], custom_template)
        self.assertEqual(candidate["status"], "candidate")

        versions_response = self.client.get(
            "/api/v1/settings/ai-prompts/ai_prompt_import_batch_mindmap/versions"
        )
        self.assertEqual(versions_response.status_code, 200)
        self.assertGreaterEqual(len(versions_response.json()["items"]), 2)

        reset_response = self.client.post(
            "/api/v1/settings/ai-prompts/reset",
            json={"keys": ["ai_prompt_import_batch_mindmap"]},
        )
        self.assertEqual(reset_response.status_code, 200)
        self.assertTrue(reset_response.json()["requires_evaluation"])
        self.assertEqual(reset_response.json()["candidates"][0]["source"], "builtin")

    def test_ai_prompt_candidate_requires_passing_eval_before_activation(self):
        custom_template = "候选提示词\n{{structure_tree_json}}"
        save_response = self.client.put(
            "/api/v1/settings/ai-prompts",
            json={"templates": {"ai_prompt_import_batch_mindmap": custom_template}},
        )
        candidate = save_response.json()["candidates"][0]

        eval_response = self.client.post(
            "/api/v1/settings/ai-evals/runs",
            json={
                "prompt_key": "ai_prompt_import_batch_mindmap",
                "candidate_version_id": candidate["id"],
            },
        )
        self.assertEqual(eval_response.status_code, 200)
        self.assertFalse(eval_response.json()["gate_passed"])
        self.assertEqual(eval_response.json()["case_count"], 0)

        activate_response = self.client.post(
            f"/api/v1/settings/ai-prompts/ai_prompt_import_batch_mindmap/versions/{candidate['id']}/activate"
        )
        self.assertEqual(activate_response.status_code, 400)
        self.assertIn("尚未通过", activate_response.json()["detail"])

    def test_ai_quality_summary_returns_lightweight_metrics(self):
        with self.SessionLocal() as session:
            session.add(
                ExternalAiCallLog(
                    id="quality-log-1",
                    feature="AI 分卡",
                    operation="mindmap_ai_split",
                    status="success",
                    provider="qwen",
                    base_url="https://example.test/v1",
                    model="qwen-plus",
                    request_id="request-1",
                    scene="mindmap_ai_split",
                    structured_output_mode="json_object",
                    input_tokens=120,
                    output_tokens=30,
                    cached_input_tokens=20,
                    duration_ms=800,
                    estimated_cost=0.001,
                )
            )
            session.commit()
        response = self.client.get("/api/v1/settings/ai-quality/summary?days=7")
        self.assertEqual(response.status_code, 200)
        metrics = response.json()["metrics"]
        self.assertEqual(metrics["total_calls"], 1)
        self.assertEqual(metrics["success_rate"], 1.0)
        self.assertEqual(metrics["input_tokens"], 120)
        self.assertTrue(metrics["has_estimated_cost"])

    def test_ai_prompt_settings_reject_unknown_placeholder(self):
        response = self.client.put(
            "/api/v1/settings/ai-prompts",
            json={
                "templates": {
                    "ai_prompt_import_batch_mindmap": "坏模板 {{structure_tree_json}} {{unknown_var}}"
                }
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("未知占位符", response.json()["detail"])

    def test_prompt_blocks_compile_in_fixed_layers_and_allow_missing_recommended_blocks(self):
        blocks_response = self.client.get("/api/v1/settings/ai-prompt-blocks")
        self.assertEqual(blocks_response.status_code, 200)
        block_keys = {item["key"] for item in blocks_response.json()["items"]}
        self.assertIn("content.fidelity", block_keys)
        self.assertIn("output.mindmap_json", block_keys)

        preview = self.client.post(
            "/api/v1/settings/ai-prompt-compose/preview",
            json={
                "scene_key": "vision_batch_mindmap",
                "selection": {
                    "block_keys": ["quality.json_integrity", "content.fidelity"],
                    "scene_instruction": "场景规则",
                    "run_instruction": "本次只处理第 64-68 页",
                },
            },
        )
        self.assertEqual(preview.status_code, 200)
        payload = preview.json()
        self.assertLess(payload["text"].index("严格保留"), payload["text"].index("输出前检查"))
        self.assertTrue(payload["text"].endswith("本次运行追加要求：\n本次只处理第 64-68 页"))
        self.assertTrue(any("boundary.document_chapter" in item for item in payload["warnings"]))

    def test_scene_default_activates_immediately_and_can_roll_back(self):
        before = self.client.get("/api/v1/settings/ai-prompt-scenes").json()["items"]
        scene = next(item for item in before if item["scene_key"] == "vision_batch_mindmap")
        original_version = scene["active_version_id"]

        saved = self.client.put(
            "/api/v1/settings/ai-prompt-scenes/vision_batch_mindmap/default",
            json={
                "block_keys": ["content.fidelity", "output.mindmap_json"],
                "scene_instruction": "新的场景默认要求",
            },
        )
        self.assertEqual(saved.status_code, 200)
        self.assertNotEqual(saved.json()["active_version_id"], original_version)
        self.assertIn("新的场景默认要求", saved.json()["compiled_prompt"])

        versions = self.client.get(
            "/api/v1/settings/ai-prompt-scenes/vision_batch_mindmap/versions"
        ).json()["items"]
        self.assertEqual(len(versions), 2)
        restored = self.client.post(
            f"/api/v1/settings/ai-prompt-scenes/vision_batch_mindmap/versions/{original_version}/activate"
        )
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.json()["active_version_id"], original_version)

    def test_shared_block_update_requires_affected_scene_acknowledgement(self):
        blocks = self.client.get("/api/v1/settings/ai-prompt-blocks").json()["items"]
        block = next(item for item in blocks if item["key"] == "content.fidelity")
        self.assertIn("vision_batch_mindmap", block["affected_scene_keys"])

        rejected = self.client.put(
            "/api/v1/settings/ai-prompt-blocks/content.fidelity",
            json={"template": "更新后的忠实规则"},
        )
        self.assertEqual(rejected.status_code, 400)
        accepted = self.client.put(
            "/api/v1/settings/ai-prompt-blocks/content.fidelity",
            json={
                "template": "更新后的忠实规则",
                "acknowledged_scene_keys": block["affected_scene_keys"],
            },
        )
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json()["template"], "更新后的忠实规则")

    def test_ai_model_settings_list_qwen_provider_and_shared_category_fields(self):
        with self.SessionLocal() as session:
            session.add(
                ExternalAiCallLog(
                    id="scene-log-1",
                    feature="AI 分卡",
                    operation="mindmap_ai_split",
                    job_id="job-scene-1",
                    palace_id=1,
                    status="success",
                    provider="qwen",
                    base_url="https://dashscope.example/v1",
                    model="qwen3.5-flash",
                    request_id="req-scene-1",
                    request_json=json.dumps(
                        {
                            "resolved_ai": {
                                "scene_key": "ai_split",
                                "scene_label": "AI 分卡",
                                "model_key": "qwen3.5-flash",
                                "model_label": "qwen3.5-flash（无视觉）",
                                "provider": "qwen",
                                "provider_label": "Qwen",
                                "model_type": "llm",
                                "model_type_label": "大语言",
                                "has_vision": False,
                                "thinking_enabled": False,
                            }
                        },
                        ensure_ascii=False,
                    ),
                    response_json="{}",
                    error_json="{}",
                )
            )
            session.commit()
        response = self.client.get("/api/v1/settings/ai-models")
        self.assertEqual(response.status_code, 200)
        payload = response.json()

        qwen_flash = next(item for item in payload["models"] if item["key"] == "qwen3.5-flash")
        self.assertEqual(qwen_flash["provider"], "qwen")
        self.assertEqual(qwen_flash["provider_label"], "Qwen")

        llm_category = next(item for item in payload["categories"] if item["key"] == "llm")
        self.assertIn("shared_model", llm_category)
        self.assertIn("available_models", llm_category)
        self.assertFalse(llm_category["has_shared_config"])
        self.assertIn("scene_count", llm_category)
        self.assertIn("custom_scene_count", llm_category)

        qwen_provider = next(item for item in payload["providers"] if item["key"] == "dashscope")
        self.assertIn("model_count", qwen_provider)
        self.assertIn("api_key_source", qwen_provider)

        ai_split_scene = next(item for item in payload["scenes"] if item["key"] == "ai_split")
        self.assertEqual(ai_split_scene["last_status"], "success")
        self.assertEqual(ai_split_scene["resolved_provider"], "qwen")
        self.assertEqual(ai_split_scene["resolved_model_label"], "qwen3.5-flash（无视觉）")

        summary = payload["summary"]
        self.assertIn("recent_success_call_count", summary)

    def test_ai_model_settings_can_save_category_shared_model_and_scene_override(self):
        first_response = self.client.put(
            "/api/v1/settings/ai-models",
            json={
                "category_updates": {
                    "llm": {
                        "default_model": "qwen3.5-flash",
                        "default_thinking_enabled": False,
                        "apply_to_scenes": True,
                    }
                }
            },
        )
        self.assertEqual(first_response.status_code, 200)
        payload = first_response.json()
        llm_category = next(item for item in payload["categories"] if item["key"] == "llm")
        self.assertTrue(llm_category["has_shared_config"])
        self.assertEqual(llm_category["shared_model"], "qwen3.5-flash")

        ai_split_scene = next(item for item in payload["scenes"] if item["key"] == "ai_split")
        self.assertTrue(ai_split_scene["inherits_category_default"])
        self.assertEqual(ai_split_scene["effective_model"], "qwen3.5-flash")

        second_response = self.client.put(
            "/api/v1/settings/ai-models",
            json={
                "scene_updates": {
                    "ai_split": {
                        "default_model": "glm-4.7-flash",
                        "default_thinking_enabled": True,
                    }
                }
            },
        )
        self.assertEqual(second_response.status_code, 200)
        payload = second_response.json()
        ai_split_scene = next(item for item in payload["scenes"] if item["key"] == "ai_split")
        self.assertFalse(ai_split_scene["inherits_category_default"])
        self.assertEqual(ai_split_scene["effective_model"], "glm-4.7-flash")
        self.assertTrue(ai_split_scene["effective_thinking_enabled"])

        with self.SessionLocal() as session:
            runtime = resolve_scenario_runtime(session, "ai_split")
            self.assertEqual(runtime.model_key, "glm-4.7-flash")
            self.assertEqual(runtime.provider, "zhipu")

    def test_qwen_runtime_reuses_dashscope_provider_credentials(self):
        with self.SessionLocal() as session:
            session.add_all(
                [
                    Config(key="category_model_llm", value="qwen3.5-flash"),
                    Config(key="dashscope_api_key", value="dashscope-test-key"),
                    Config(key="dashscope_base_url", value="https://dashscope.example/v1"),
                ]
            )
            session.commit()
            runtime = resolve_scenario_runtime(session, "ai_split")

        self.assertEqual(runtime.provider, "qwen")
        self.assertEqual(runtime.api_key, "dashscope-test-key")
        self.assertEqual(runtime.base_url, "https://dashscope.example/v1")

    def test_ai_model_impact_endpoint_and_delete_error_are_structured(self):
        self.client.put(
            "/api/v1/settings/ai-models",
            json={
                "scene_updates": {
                    "ai_split": {
                        "default_model": "glm-4.7-flash",
                        "default_thinking_enabled": True,
                    }
                }
            },
        )
        impact_response = self.client.get("/api/v1/settings/ai-models/models/glm-4.7-flash/impact")
        self.assertEqual(impact_response.status_code, 200)
        impact_payload = impact_response.json()
        self.assertFalse(impact_payload["can_delete"])
        self.assertGreaterEqual(impact_payload["usage_count"], 1)
        self.assertIn("AI 分卡", impact_payload["bound_scene_labels"])

        delete_response = self.client.delete("/api/v1/settings/ai-models/models/glm-4.7-flash")
        self.assertEqual(delete_response.status_code, 400)
        detail = delete_response.json()["detail"]
        self.assertEqual(detail["code"], "model_in_use")
        self.assertFalse(detail["can_delete"])
        self.assertIn("scene_impacts", detail)

    @patch("memory_anki.modules.settings.application.ai_model_registry.call_chat_completion_text")
    def test_provider_and_model_test_endpoints(self, call_chat_completion_text_mock):
        call_chat_completion_text_mock.return_value = "OK"
        with self.SessionLocal() as session:
            session.add_all(
                [
                    Config(key="dashscope_api_key", value="dashscope-test-key"),
                    Config(key="dashscope_base_url", value="https://dashscope.example/v1"),
                ]
            )
            session.commit()

        provider_response = self.client.post("/api/v1/settings/ai-models/providers/qwen/test")
        self.assertEqual(provider_response.status_code, 200)
        self.assertTrue(provider_response.json()["ok"])
        self.assertEqual(provider_response.json()["source"], "db")

        model_response = self.client.post("/api/v1/settings/ai-models/models/qwen3.5-flash/test")
        self.assertEqual(model_response.status_code, 200)
        self.assertTrue(model_response.json()["ok"])
        self.assertEqual(model_response.json()["model"], "qwen3.5-flash")

    def test_provider_test_endpoint_handles_missing_api_key(self):
        with patch.dict(
            "memory_anki.modules.settings.application.ai_model_registry.PROVIDER_ENV_DEFAULTS",
            {
                "dashscope": {
                    "api_key": "",
                    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                },
                "qwen": {
                    "api_key": "",
                    "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                },
                "zhipu": {"api_key": "", "base_url": "https://open.bigmodel.cn/api/paas/v4"},
                "siliconflow": {"api_key": "", "base_url": "https://api.siliconflow.cn/v1"},
            },
        ):
            response = self.client.post("/api/v1/settings/ai-models/providers/qwen/test")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["ok"])
        self.assertIn("API Key", payload["error"])

    def test_ai_call_log_endpoints_return_summary_and_detail(self):
        with self.SessionLocal() as session:
            session.add(
                ExternalAiCallLog(
                    id="log-1",
                    feature="AI 分卡",
                    operation="mindmap_ai_split",
                    job_id="job-1",
                    palace_id=1,
                    status="success",
                    provider="openai_compatible",
                    base_url="https://example.test/v1",
                    model="qwen3.6-flash",
                    request_id="req-1",
                    request_json=json.dumps(
                        {"prompt": "系统提示词", "input_artifacts": []},
                        ensure_ascii=False,
                    ),
                    response_json=json.dumps(
                        {"response_text": "{\"ok\":true}"},
                        ensure_ascii=False,
                    ),
                    error_json="{}",
                )
            )
            session.commit()

        list_response = self.client.get("/api/v1/ai-call-logs?job_id=job-1")
        self.assertEqual(list_response.status_code, 200)
        items = list_response.json()["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["id"], "log-1")

        detail_response = self.client.get("/api/v1/ai-call-logs/log-1")
        self.assertEqual(detail_response.status_code, 200)
        payload = detail_response.json()
        self.assertEqual(payload["prompt_text"], "系统提示词")
        self.assertEqual(payload["response_text"], "{\"ok\":true}")
        self.assertEqual(payload["job_id"], "job-1")


if __name__ == "__main__":
    unittest.main()
