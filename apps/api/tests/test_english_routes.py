import io
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, EnglishCourse, EnglishGenerationTask
from memory_anki.modules.english.application import service as english_service
from memory_anki.modules.english.presentation import router as english_router


class EnglishRouteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)
        self.original_router_get_session = english_router.get_session
        self.original_service_get_session = english_service.get_session
        self.original_launch = english_service.launch_generation_task
        self.original_call_chat_completion_text = english_service.call_chat_completion_text
        self.original_api_key = english_service.DASHSCOPE_API_KEY
        self.original_translation_model = english_service.ENGLISH_TRANSLATION_MODEL
        self.original_probe_media_duration_seconds = english_service._probe_media_duration_seconds
        self.temp_dir = tempfile.TemporaryDirectory()
        self.media_dir = Path(self.temp_dir.name) / "english_media"
        self.tasks_dir = Path(self.temp_dir.name) / "english_tasks"
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        english_service.ENGLISH_MEDIA_DIR = self.media_dir
        english_service.ENGLISH_TASKS_DIR = self.tasks_dir
        english_service.DASHSCOPE_API_KEY = "test-key"
        english_service.ENGLISH_TRANSLATION_MODEL = "qwen-mt-flash"

        def get_test_session():
            return self.SessionLocal()

        english_router.get_session = get_test_session
        english_service.get_session = get_test_session

        app = FastAPI()
        app.include_router(english_router.router, prefix="/api/v1")
        self.client = TestClient(app)

    def tearDown(self):
        english_router.get_session = self.original_router_get_session
        english_service.get_session = self.original_service_get_session
        english_service.launch_generation_task = self.original_launch
        english_service.call_chat_completion_text = self.original_call_chat_completion_text
        english_service.DASHSCOPE_API_KEY = self.original_api_key
        english_service.ENGLISH_TRANSLATION_MODEL = self.original_translation_model
        english_service._probe_media_duration_seconds = self.original_probe_media_duration_seconds
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_upload_generates_course_and_progress_flow(self):
        def fake_launch(task_id: str):
            with self.SessionLocal() as session:
                task = session.query(EnglishGenerationTask).filter_by(id=task_id).one()
                english_service._finalize_course_from_task(
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

        english_service.launch_generation_task = fake_launch

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

    def test_failed_task_can_be_cleared(self):
        def failing_launch(task_id: str):
            english_service._update_task_fields(
                None,
                task_id,
                status="failed",
                stage="failed",
                progress_percent=100,
                message="生成失败",
                error_message="mock failure",
            )

        english_service.launch_generation_task = failing_launch

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

    def test_workspace_repairs_implausible_course_durations(self):
        def fake_launch(task_id: str):
            with self.SessionLocal() as session:
                task = session.query(EnglishGenerationTask).filter_by(id=task_id).one()
                english_service._finalize_course_from_task(
                    task_id=task_id,
                    source_path=Path(task.source_media_path),
                    source_mime_type="video/mp4",
                    file_size=task.file_size,
                    duration_seconds=english_service.MAX_REASONABLE_MEDIA_DURATION_SECONDS + 120,
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

        english_service.launch_generation_task = fake_launch
        english_service._probe_media_duration_seconds = lambda _path: 187

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
        prepared = english_service._prepare_sentences_from_asr(payload, task_id="demo-task")
        self.assertEqual(len(prepared), 1)
        self.assertEqual(prepared[0]["text_en"], "Hello world. This should stay one sentence.")

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
            if source_text.startswith("[S0000]"):
                return "bad translation payload"
            if source_text == "Hello world.":
                return "你好，世界。"
            if source_text == "We keep going.":
                return "我们继续前进。"
            return "未知"

        english_service.call_chat_completion_text = fake_call_chat_completion_text
        with self.SessionLocal() as session:
            created = english_service._create_task_row(
                session,
                filename="demo.mp4",
                content_type="video/mp4",
                file_bytes=b"demo",
            )

        translated = english_service._translate_sentences(
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
        )

        self.assertEqual([item["text_zh"] for item in translated], ["你好，世界。", "我们继续前进。"])
        self.assertEqual(len(recorded_calls), 3)
        self.assertTrue(recorded_calls[0]["source_text"].startswith("[S0000] Hello world."))
        for item in recorded_calls:
            self.assertEqual(
                item["extra_payload"],
                {"translation_options": {"source_lang": "English", "target_lang": "Chinese"}},
            )
