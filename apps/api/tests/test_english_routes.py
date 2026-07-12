import io
import json
import tempfile
from pathlib import Path

from memory_anki.core.concurrency_limits import concurrency_slot
from memory_anki.infrastructure.db._tables.english import EnglishCourse, EnglishGenerationTask
from memory_anki.modules.english.application import course_service, task_service
from memory_anki.modules.english.application.asr_normalization import prepare_sentences_from_asr
from memory_anki.modules.english.domain.errors import EnglishCourseError
from memory_anki.modules.english.domain.text import (
    check_sentence_tokens,
    tokenize_learning_sentence,
)
from memory_anki.modules.english.infrastructure import dashscope_gateway, paths
from memory_anki.modules.english.presentation import router as english_router
from memory_anki.platform.application import (
    AiRuntimeOptions,
    PersistedAiRuntime,
    ResolvedAiRuntime,
)
from support import RouterTestCase

TOKEN_VECTOR_PATH = Path(__file__).resolve().parents[2] / "shared" / "english-token-vectors.json"


class CallbackRunner:
    def __init__(self, callback):
        self.callback = callback

    def launch(self, task_id: str, target):
        self.callback(task_id)


class NoopAsrGateway:
    def transcribe(self, audio_path, *, task_id, progress_callback=None):
        return {"transcripts": []}


class NoopTranslator:
    def translate_sentences(self, sentences, *, task_id):
        return sentences


class StubPromptCatalog:
    def render(self, key: str, variables: dict[str, object] | None = None) -> str:
        source_text = str((variables or {}).get("source_text") or "")
        return f"{key}\n{source_text}"


class FakeAiRuntimeProvider:
    def __init__(self, api_key: str = "current-secret") -> None:
        self.api_key = api_key

    def normalize_options(self, value):
        return AiRuntimeOptions()

    def resolve(self, scenario_key, *, options=None):
        model = options.model if options and options.model else f"{scenario_key}-model"
        return ResolvedAiRuntime(
            scene_key=scenario_key,
            scene_label=scenario_key,
            model_key=model,
            model_label=model,
            model=model,
            provider="dashscope",
            model_type="text",
            has_vision=False,
            thinking_enabled=False,
            supports_temperature=True,
            structured_output_mode="none",
            input_price_per_million=None,
            output_price_per_million=None,
            cached_input_price_per_million=None,
            api_key=self.api_key,
            base_url="https://dashscope.test/compatible-mode/v1",
            extra_payload=None,
            prompt_override=None,
            public_metadata={
                "scenario": scenario_key,
                "model": model,
                "provider": "dashscope",
            },
        )

    def restore(self, snapshot: PersistedAiRuntime):
        return self.resolve(
            snapshot.scenario_key,
            options=AiRuntimeOptions(model=snapshot.model),
        )


class EnglishRouteTests(RouterTestCase):
    ROUTER_MODULES = (english_router,)

    def setUp(self):
        self.original_task_get_session = task_service.get_session
        self.original_runtime = task_service.get_english_runtime()
        self.original_call_chat_completion_text = dashscope_gateway.call_chat_completion_text
        self.original_api_key = dashscope_gateway.DASHSCOPE_API_KEY
        self.original_translation_model = dashscope_gateway.ENGLISH_TRANSLATION_MODEL
        self.original_course_media_dir = course_service.ENGLISH_MEDIA_DIR
        self.original_paths_media_dir = paths.ENGLISH_MEDIA_DIR
        self.original_paths_tasks_dir = paths.ENGLISH_TASKS_DIR
        self.original_task_extract_audio_track_to_wav = task_service.extract_audio_track_to_wav
        self.original_task_probe_media_duration_seconds = task_service.probe_media_duration_seconds
        self.original_probe_media_duration_seconds = course_service.probe_media_duration_seconds
        self.temp_dir = tempfile.TemporaryDirectory()
        self.media_dir = Path(self.temp_dir.name) / "english_media"
        self.tasks_dir = Path(self.temp_dir.name) / "english_tasks"
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        course_service.ENGLISH_MEDIA_DIR = self.media_dir
        paths.ENGLISH_MEDIA_DIR = self.media_dir
        paths.ENGLISH_TASKS_DIR = self.tasks_dir
        dashscope_gateway.DASHSCOPE_API_KEY = "test-key"
        dashscope_gateway.ENGLISH_TRANSLATION_MODEL = "qwen-mt-flash"

        super().setUp()

        def get_test_session():
            return self.SessionLocal()

        task_service.get_session = get_test_session

    def tearDown(self):
        task_service.get_session = self.original_task_get_session
        task_service.configure_english_runtime(self.original_runtime)
        dashscope_gateway.call_chat_completion_text = self.original_call_chat_completion_text
        dashscope_gateway.DASHSCOPE_API_KEY = self.original_api_key
        dashscope_gateway.ENGLISH_TRANSLATION_MODEL = self.original_translation_model
        course_service.ENGLISH_MEDIA_DIR = self.original_course_media_dir
        paths.ENGLISH_MEDIA_DIR = self.original_paths_media_dir
        paths.ENGLISH_TASKS_DIR = self.original_paths_tasks_dir
        task_service.extract_audio_track_to_wav = self.original_task_extract_audio_track_to_wav
        task_service.probe_media_duration_seconds = self.original_task_probe_media_duration_seconds
        course_service.probe_media_duration_seconds = self.original_probe_media_duration_seconds
        super().tearDown()
        self.temp_dir.cleanup()

    def test_upload_generates_course_and_progress_flow(self):
        def fake_launch(task_id: str):
            with self.SessionLocal() as session:
                task = session.query(EnglishGenerationTask).filter_by(id=task_id).one()
                task_service.finalize_generation_task(
                    task_id=task_id,
                    source_path=Path(task.source_media_path),
                    source_mime_type="video/mp4",
                    file_size=task.file_size,
                    duration_seconds=96,
                    sentences=[
                        {
                            "index": 0,
                            "text_en": "Hello world.",
                            "text_zh": "你好，世界。",
                            "start_ms": 0,
                            "end_ms": 1200,
                            "tokens": ["hello", "world"],
                        },
                        {
                            "index": 1,
                            "text_en": "We can keep going.",
                            "text_zh": "我们可以继续。",
                            "start_ms": 1200,
                            "end_ms": 2600,
                            "tokens": ["we", "can", "keep", "going"],
                        },
                    ],
                )

        task_service.configure_english_runtime(
            task_service.EnglishRuntime(
                runner=CallbackRunner(fake_launch),
                asr_gateway=NoopAsrGateway(),
                translator=NoopTranslator(),
            )
        )

        upload = self.client.post(
            "/api/v1/english/upload",
            files={"video_file": ("lesson.mp4", io.BytesIO(b"fake-video-bytes"), "video/mp4")},
        )
        self.assertEqual(upload.status_code, 200)
        upload_payload = upload.json()["task"]
        self.assertEqual(upload_payload["status"], "queued")
        task_id = upload_payload["id"]

        workspace = self.client.get("/api/v1/english")
        self.assertEqual(workspace.status_code, 200)
        workspace_payload = workspace.json()
        self.assertIsNone(workspace_payload["currentTask"])
        self.assertEqual(workspace_payload["stats"]["total_courses"], 1)
        self.assertEqual(len(workspace_payload["recentCourses"]), 1)
        course_id = workspace_payload["recentCourses"][0]["id"]
        self.assertEqual(workspace_payload["continueCourse"]["id"], course_id)

        detail = self.client.get(f"/api/v1/english/courses/{course_id}")
        self.assertEqual(detail.status_code, 200)
        detail_payload = detail.json()
        self.assertEqual(detail_payload["sentenceCount"], 2)
        self.assertEqual(detail_payload["progress"]["currentSentenceIndex"], 0)
        self.assertEqual(len(detail_payload["sentences"]), 2)
        self.assertNotIn("vocabulary", detail_payload["sentences"][0])

        media = self.client.get(f"/api/v1/english/courses/{course_id}/media")
        self.assertEqual(media.status_code, 200)
        self.assertEqual(media.headers["content-type"], "video/mp4")
        self.assertEqual(media.content, b"fake-video-bytes")

        task_log = self.client.get(f"/api/v1/english/tasks/{task_id}/generation-log")
        self.assertEqual(task_log.status_code, 200)
        self.assertEqual(task_log.json()["task"]["status"], "completed")
        self.assertEqual(task_log.json()["task"]["courseId"], course_id)
        self.assertGreaterEqual(len(task_log.json()["events"]), 1)

        course_log = self.client.get(f"/api/v1/english/courses/{course_id}/generation-log")
        self.assertEqual(course_log.status_code, 200)
        self.assertEqual(course_log.json()["task"]["id"], task_id)
        self.assertGreaterEqual(len(course_log.json()["events"]), 1)

        stream = self.client.get(f"/api/v1/english/tasks/{task_id}/stream")
        self.assertEqual(stream.status_code, 200)
        self.assertIn("event: status", stream.text)
        self.assertIn("event: done", stream.text)

        progress = self.client.put(
            f"/api/v1/english/courses/{course_id}/progress",
            json={"currentSentenceIndex": 1, "completedSentenceIndexes": [0]},
        )
        self.assertEqual(progress.status_code, 200)
        self.assertEqual(progress.json()["currentSentenceIndex"], 1)

        check = self.client.post(
            f"/api/v1/english/courses/{course_id}/check",
            json={"sentenceIndex": 1, "inputText": "We can keep going"},
        )
        self.assertEqual(check.status_code, 200)
        self.assertTrue(check.json()["passed"])

    def test_course_list_does_not_repair_duration_until_explicit_maintenance(self):
        course_dir = self.media_dir / "course-1"
        course_dir.mkdir(parents=True)
        (course_dir / "source.mp4").write_bytes(b"fake-video")
        with self.SessionLocal() as session:
            session.add(
                EnglishCourse(
                    id=1,
                    title="Needs duration repair",
                    original_filename="lesson.mp4",
                    media_filename="source.mp4",
                    media_relative_path="course-1/source.mp4",
                    media_mime_type="video/mp4",
                    duration_seconds=0,
                    sentence_count=0,
                )
            )
            session.commit()

        calls: list[Path] = []
        course_service.probe_media_duration_seconds = lambda path: calls.append(Path(path)) or 42

        list_response = self.client.get("/api/v1/english/courses")
        calls_after_list = list(calls)
        with self.SessionLocal() as session:
            duration_after_list = (
                session.query(EnglishCourse).filter_by(id=1).one().duration_seconds
            )

        repair_response = self.client.post("/api/v1/english/courses/repair-durations")
        with self.SessionLocal() as session:
            duration_after_repair = (
                session.query(EnglishCourse).filter_by(id=1).one().duration_seconds
            )

        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(duration_after_list, 0)
        self.assertEqual(calls_after_list, [])
        self.assertEqual(
            [path.resolve() for path in calls],
            [(self.media_dir / "course-1" / "source.mp4").resolve()],
        )
        self.assertEqual(repair_response.status_code, 200)
        self.assertEqual(repair_response.json()["repaired_count"], 1)
        self.assertEqual(duration_after_repair, 42)

    def test_failed_task_can_be_cleared(self):
        def failing_launch(task_id: str):
            task_service.update_task_fields(
                None,
                task_id,
                status="failed",
                stage="failed",
                progress_percent=100,
                message="生成失败",
                error_message="mock failure",
            )

        task_service.configure_english_runtime(
            task_service.EnglishRuntime(
                runner=CallbackRunner(failing_launch),
                asr_gateway=NoopAsrGateway(),
                translator=NoopTranslator(),
            )
        )

        upload = self.client.post(
            "/api/v1/english/upload",
            files={"video_file": ("broken.mp4", io.BytesIO(b"broken"), "video/mp4")},
        )
        self.assertEqual(upload.status_code, 200)
        self.assertEqual(upload.json()["task"]["status"], "queued")

        current_task = self.client.get("/api/v1/english/current-task")
        self.assertEqual(current_task.status_code, 200)
        self.assertEqual(current_task.json()["task"]["status"], "failed")
        self.assertEqual(current_task.json()["task"]["errorMessage"], "mock failure")

        cleared = self.client.delete("/api/v1/english/current-task")
        self.assertEqual(cleared.status_code, 200)
        self.assertTrue(cleared.json()["ok"])

        workspace = self.client.get("/api/v1/english")
        self.assertEqual(workspace.status_code, 200)
        self.assertIsNone(workspace.json()["currentTask"])
        self.assertEqual(workspace.json()["recentCourses"], [])

    def test_upload_rejects_while_heavy_upload_slot_is_held(self):
        with concurrency_slot("heavy_upload"):
            response = self.client.post(
                "/api/v1/english/upload",
                files={"video_file": ("busy.mp4", io.BytesIO(b"busy"), "video/mp4")},
            )

        self.assertEqual(response.status_code, 429)
        self.assertIn("已有同类 AI 任务在进行中", response.json()["detail"])

    def test_workspace_repairs_implausible_course_durations(self):
        def fake_launch(task_id: str):
            with self.SessionLocal() as session:
                task = session.query(EnglishGenerationTask).filter_by(id=task_id).one()
                task_service.finalize_generation_task(
                    task_id=task_id,
                    source_path=Path(task.source_media_path),
                    source_mime_type="video/mp4",
                    file_size=task.file_size,
                    duration_seconds=course_service.MAX_REASONABLE_MEDIA_DURATION_SECONDS + 120,
                    sentences=[
                        {
                            "index": 0,
                            "text_en": "Repair duration.",
                            "text_zh": "修正时长。",
                            "start_ms": 0,
                            "end_ms": 1000,
                            "tokens": ["repair", "duration"],
                        }
                    ],
                )

        task_service.configure_english_runtime(
            task_service.EnglishRuntime(
                runner=CallbackRunner(fake_launch),
                asr_gateway=NoopAsrGateway(),
                translator=NoopTranslator(),
            )
        )
        course_service.probe_media_duration_seconds = lambda _path: 187

        upload = self.client.post(
            "/api/v1/english/upload",
            files={"video_file": ("repair.mp4", io.BytesIO(b"repair-video-bytes"), "video/mp4")},
        )
        self.assertEqual(upload.status_code, 200)

        workspace = self.client.get("/api/v1/english")
        self.assertEqual(workspace.status_code, 200)
        workspace_payload = workspace.json()
        course_id = workspace_payload["recentCourses"][0]["id"]
        self.assertEqual(workspace_payload["recentCourses"][0]["durationSeconds"], 187)
        self.assertEqual(workspace_payload["continueCourse"]["durationSeconds"], 187)

        detail = self.client.get(f"/api/v1/english/courses/{course_id}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["durationSeconds"], 187)

        with self.SessionLocal() as session:
            course = session.query(EnglishCourse).filter_by(id=course_id).one()
            self.assertEqual(course.duration_seconds, 187)

    def test_prepare_sentences_uses_asr_sentence_boundaries_directly(self):
        payload = {
            "transcripts": [
                {
                    "sentences": [
                        {
                            "text": "Hello world. This should stay one sentence.",
                            "begin_time": 0,
                            "end_time": 2100,
                        }
                    ]
                }
            ]
        }
        prepared = prepare_sentences_from_asr(payload).sentences
        self.assertEqual(len(prepared), 1)
        self.assertEqual(prepared[0]["text_en"], "Hello world. This should stay one sentence.")

    def test_tokenization_matches_shared_vectors(self):
        vectors = json.loads(TOKEN_VECTOR_PATH.read_text(encoding="utf-8"))
        for vector in vectors:
            with self.subTest(vector["name"]):
                tokens = tokenize_learning_sentence(vector["text"])
                self.assertEqual(tokens, vector["tokens"])
                result = check_sentence_tokens(vector["tokens"], vector["checkInput"])
                self.assertEqual(result.passed, vector["checkPassed"])

    def test_cleanup_marks_running_task_as_interrupted_failed(self):
        with self.SessionLocal() as session:
            completed = EnglishGenerationTask(
                id="completed-task", status="completed", stage="completed"
            )
            already_cleared = EnglishGenerationTask(
                id="cleared-task", status="cleared", stage="cleared"
            )
            failed = EnglishGenerationTask(id="failed-task", status="failed", stage="failed")
            running = EnglishGenerationTask(id="running-task", status="running", stage="transcribe")
            queued = EnglishGenerationTask(id="queued-task", status="queued", stage="queued")
            retried = EnglishGenerationTask(id="retried-task", status="retried", stage="retried")
            session.add_all([completed, already_cleared, failed, running, queued, retried])
            session.commit()

            for task_id in [
                "failed-task",
                "running-task",
                "queued-task",
                "completed-task",
                "cleared-task",
                "retried-task",
            ]:
                task_path = paths.task_dir(task_id)
                task_path.mkdir(parents=True, exist_ok=True)
                (task_path / "temp.txt").write_text("temporary", encoding="utf-8")

            result = task_service.cleanup_incomplete_generation_tasks(session)

            self.assertEqual(result, {"cleared": 1, "interrupted": 2})
            self.assertEqual(
                session.get(EnglishGenerationTask, "completed-task").status, "completed"
            )
            self.assertEqual(session.get(EnglishGenerationTask, "cleared-task").status, "cleared")
            self.assertEqual(session.get(EnglishGenerationTask, "failed-task").status, "failed")
            self.assertEqual(session.get(EnglishGenerationTask, "running-task").status, "failed")
            self.assertEqual(
                session.get(EnglishGenerationTask, "running-task").stage, "interrupted"
            )
            self.assertEqual(
                session.get(EnglishGenerationTask, "running-task").message,
                "生成因服务重启被中断，可点击重试继续。",
            )
            self.assertEqual(
                session.get(EnglishGenerationTask, "running-task").error_message,
                "服务重启导致任务中断。",
            )
            self.assertEqual(session.get(EnglishGenerationTask, "queued-task").status, "failed")
            self.assertEqual(session.get(EnglishGenerationTask, "queued-task").stage, "interrupted")
            self.assertEqual(session.get(EnglishGenerationTask, "retried-task").status, "cleared")
            self.assertTrue(paths.task_dir("completed-task").exists())
            self.assertTrue(paths.task_dir("cleared-task").exists())
            self.assertTrue(paths.task_dir("failed-task").exists())
            self.assertTrue(paths.task_dir("running-task").exists())
            self.assertTrue(paths.task_dir("queued-task").exists())
            self.assertFalse(paths.task_dir("retried-task").exists())

    def test_retry_reuses_asr_artifact(self):
        class CountingAsrGateway:
            def __init__(self):
                self.calls = 0

            def transcribe(self, audio_path, *, task_id, ai_options=None, progress_callback=None):
                self.calls += 1
                return {"transcripts": []}

        class TextZhTranslator:
            def translate_sentences(self, sentences, *, task_id):
                return [{**sentence, "text_zh": "你好，世界。"} for sentence in sentences]

        asr_gateway = CountingAsrGateway()
        task_service.configure_english_runtime(
            task_service.EnglishRuntime(
                runner=CallbackRunner(lambda task_id: task_service.run_generation_task(task_id)),
                asr_gateway=asr_gateway,
                translator=TextZhTranslator(),
            )
        )
        task_service.extract_audio_track_to_wav = lambda _source, _output: self.fail(
            "audio artifact should be reused"
        )
        task_service.probe_media_duration_seconds = lambda _path: 42

        with self.SessionLocal() as session:
            original = task_service.create_task_row(
                session,
                filename="cached.mp4",
                content_type="video/mp4",
                file_bytes=b"cached-video",
            )
            failed = session.get(EnglishGenerationTask, original["id"])
            failed.status = "failed"
            failed.stage = "interrupted"
            failed.message = "生成因服务重启被中断，可点击重试继续。"
            failed.error_message = "服务重启导致任务中断。"
            session.commit()

        original_dir = paths.task_dir(original["id"])
        (original_dir / "audio.wav").write_bytes(b"cached-audio")
        (original_dir / "runtime_options.json").write_text(
            json.dumps(
                {"asr": {"model": "cached-model", "thinking_enabled": True}}, ensure_ascii=False
            ),
            encoding="utf-8",
        )
        (original_dir / "asr_result.json").write_text(
            json.dumps(
                {
                    "transcripts": [
                        {
                            "sentences": [
                                {
                                    "text": "Hello world.",
                                    "begin_time": 0,
                                    "end_time": 1200,
                                }
                            ]
                        }
                    ]
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        response = self.client.post("/api/v1/english/current-task/retry")
        self.assertEqual(response.status_code, 200)
        retry_task = response.json()["task"]

        self.assertEqual(retry_task["ownerId"], original["id"])
        self.assertEqual(retry_task["operationId"], retry_task["id"])
        self.assertNotEqual(retry_task["operationId"], original["operationId"])
        self.assertEqual(asr_gateway.calls, 0)
        with self.SessionLocal() as session:
            original_row = session.get(EnglishGenerationTask, original["id"])
            retry_row = session.get(EnglishGenerationTask, retry_task["id"])
            self.assertEqual(original_row.status, "retried")
            self.assertEqual(retry_row.status, "completed")
            self.assertEqual(retry_row.course_id, 1)

        retry_log = self.client.get(f"/api/v1/english/tasks/{retry_task['id']}/generation-log")
        self.assertEqual(retry_log.status_code, 200)
        self.assertIn(
            "复用已完成的 ASR 转写结果（未重新调用 ASR）。",
            [event["message"] for event in retry_log.json()["events"]],
        )

    def test_task_runtime_snapshot_excludes_credentials_and_exposes_identity(self):
        provider = FakeAiRuntimeProvider(api_key="must-not-be-persisted")
        dependencies = task_service.EnglishAiDependencies(provider, StubPromptCatalog())
        with self.SessionLocal() as session:
            task = task_service.create_task_row(
                session,
                filename="secure.mp4",
                content_type="video/mp4",
                file_bytes=b"video",
                asr_ai_options=AiRuntimeOptions(model="asr-model"),
                ai_dependencies=dependencies,
            )

        snapshot_path = paths.task_dir(task["id"]) / task_service.TASK_RUNTIME_FILE
        snapshot_text = snapshot_path.read_text(encoding="utf-8")
        snapshot = json.loads(snapshot_text)
        self.assertNotIn("must-not-be-persisted", snapshot_text)
        self.assertNotIn("api_key", snapshot_text)
        self.assertEqual(snapshot["owner_id"], task["id"])
        self.assertEqual(snapshot["operation_id"], task["id"])
        self.assertEqual(task["ownerId"], task["id"])
        self.assertEqual(task["operationId"], task["id"])
        self.assertEqual(task["resolved_ai"]["model"], "asr-model")

    def test_runtime_restore_uses_current_provider_credential(self):
        provider = FakeAiRuntimeProvider(api_key="creation-secret")
        dependencies = task_service.EnglishAiDependencies(provider, StubPromptCatalog())
        task_path = paths.task_dir("credential-rotation")
        task_path.mkdir(parents=True, exist_ok=True)
        task_service.write_task_runtime_snapshot(
            task_path,
            owner_id="english-owner",
            operation_id="credential-rotation",
            ai_dependencies=dependencies,
            asr_ai_options=AiRuntimeOptions(model="stable-model"),
        )
        provider.api_key = "rotated-secret"

        restored = task_service.restore_task_runtime(
            task_path,
            "asr",
            ai_dependencies=dependencies,
        )

        self.assertIsNotNone(restored)
        self.assertEqual(restored.api_key, "rotated-secret")
        self.assertEqual(restored.model, "stable-model")

    def test_translate_sentences_uses_translation_options_and_falls_back_to_single(self):
        recorded_calls: list[dict] = []

        def fake_call_chat_completion_text(*, config, messages, extra_payload=None, **kwargs):
            source_text = str(messages[0]["content"])
            recorded_calls.append(
                {
                    "model": config.model,
                    "source_text": source_text,
                    "extra_payload": extra_payload,
                }
            )
            if "ai_prompt_english_translation_batch" in source_text:
                return "bad translation payload"
            if source_text.endswith("Hello world."):
                return "你好，世界。"
            if source_text.endswith("We keep going."):
                return "我们继续前进。"
            return "未知"

        dashscope_gateway.call_chat_completion_text = fake_call_chat_completion_text
        with self.SessionLocal() as session:
            created = task_service.create_task_row(
                session,
                filename="demo.mp4",
                content_type="video/mp4",
                file_bytes=b"demo",
            )

        translated = dashscope_gateway.DashscopeEnglishTranslator().translate_sentences(
            [
                {
                    "index": 0,
                    "text_en": "Hello world.",
                    "start_ms": 0,
                    "end_ms": 800,
                    "tokens": ["hello", "world"],
                },
                {
                    "index": 1,
                    "text_en": "We keep going.",
                    "start_ms": 900,
                    "end_ms": 1800,
                    "tokens": ["we", "keep", "going"],
                },
            ],
            task_id=created["id"],
            prompt_catalog=StubPromptCatalog(),
        )

        self.assertEqual(
            [item["text_zh"] for item in translated], ["你好，世界。", "我们继续前进。"]
        )
        self.assertEqual(len(recorded_calls), 3)
        self.assertIn("ai_prompt_english_translation_batch", recorded_calls[0]["source_text"])
        self.assertIn("[S0000] Hello world.", recorded_calls[0]["source_text"])
        self.assertIn("ai_prompt_english_translation_single", recorded_calls[1]["source_text"])
        for item in recorded_calls:
            self.assertEqual(
                item["extra_payload"],
                {"translation_options": {"source_lang": "English", "target_lang": "Chinese"}},
            )

    def test_translate_single_sentence_empty_result_keeps_domain_error_message(self):
        def fake_call_chat_completion_text(*, config, messages, extra_payload=None, **kwargs):
            return "  "

        dashscope_gateway.call_chat_completion_text = fake_call_chat_completion_text
        config = dashscope_gateway.OpenAICompatibleChatConfig(
            api_key="test-key",
            base_url="https://dashscope.test/compatible-mode/v1",
            model="qwen-mt-flash",
            timeout_seconds=120,
        )

        with self.assertRaises(EnglishCourseError) as raised:
            dashscope_gateway.DashscopeEnglishTranslator().translate_single_sentence(
                config=config,
                runtime_extra_payload=None,
                sentence={"index": 7, "text_en": "Hello."},
                task_id="empty-single-task",
                prompt_catalog=StubPromptCatalog(),
            )

        self.assertEqual(str(raised.exception), "单句翻译结果为空。")
