import io
import json
import tempfile
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, EnglishCourse, EnglishGenerationTask
from memory_anki.modules.english.application import course_service, task_service
from memory_anki.modules.english.application.asr_normalization import prepare_sentences_from_asr
from memory_anki.modules.english.domain.text import (
    check_sentence_tokens,
    tokenize_learning_sentence,
)
from memory_anki.modules.english.infrastructure import dashscope_gateway, paths
from memory_anki.modules.english.presentation import router as english_router

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
        self.original_task_get_session = task_service.get_session
        self.original_runtime = task_service.get_english_runtime()
        self.original_call_chat_completion_text = dashscope_gateway.call_chat_completion_text
        self.original_api_key = dashscope_gateway.DASHSCOPE_API_KEY
        self.original_translation_model = dashscope_gateway.ENGLISH_TRANSLATION_MODEL
        self.original_course_media_dir = course_service.ENGLISH_MEDIA_DIR
        self.original_paths_media_dir = paths.ENGLISH_MEDIA_DIR
        self.original_paths_tasks_dir = paths.ENGLISH_TASKS_DIR
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

        def get_test_session():
            return self.SessionLocal()

        english_router.get_session = get_test_session
        task_service.get_session = get_test_session

        app = FastAPI()
        app.include_router(english_router.router, prefix="/api/v1")
        self.client = TestClient(app)

    def tearDown(self):
        english_router.get_session = self.original_router_get_session
        task_service.get_session = self.original_task_get_session
        task_service.configure_english_runtime(self.original_runtime)
        dashscope_gateway.call_chat_completion_text = self.original_call_chat_completion_text
        dashscope_gateway.DASHSCOPE_API_KEY = self.original_api_key
        dashscope_gateway.ENGLISH_TRANSLATION_MODEL = self.original_translation_model
        course_service.ENGLISH_MEDIA_DIR = self.original_course_media_dir
        paths.ENGLISH_MEDIA_DIR = self.original_paths_media_dir
        paths.ENGLISH_TASKS_DIR = self.original_paths_tasks_dir
        course_service.probe_media_duration_seconds = self.original_probe_media_duration_seconds
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()
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
            duration_after_list = session.query(EnglishCourse).filter_by(id=1).one().duration_seconds

        repair_response = self.client.post("/api/v1/english/courses/repair-durations")
        with self.SessionLocal() as session:
            duration_after_repair = session.query(EnglishCourse).filter_by(id=1).one().duration_seconds

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

    def test_startup_cleanup_marks_non_completed_tasks_cleared_and_removes_task_dirs(self):
        with self.SessionLocal() as session:
            completed = EnglishGenerationTask(id="completed-task", status="completed", stage="completed")
            already_cleared = EnglishGenerationTask(id="cleared-task", status="cleared", stage="cleared")
            failed = EnglishGenerationTask(id="failed-task", status="failed", stage="failed")
            running = EnglishGenerationTask(id="running-task", status="running", stage="transcribe")
            queued = EnglishGenerationTask(id="queued-task", status="queued", stage="queued")
            session.add_all([completed, already_cleared, failed, running, queued])
            session.commit()

            for task_id in ["failed-task", "running-task", "queued-task", "completed-task", "cleared-task"]:
                task_path = paths.task_dir(task_id)
                task_path.mkdir(parents=True, exist_ok=True)
                (task_path / "temp.txt").write_text("temporary", encoding="utf-8")

            result = task_service.cleanup_incomplete_generation_tasks(session)

            self.assertEqual(result, {"cleared": 3})
            self.assertEqual(session.get(EnglishGenerationTask, "completed-task").status, "completed")
            self.assertEqual(session.get(EnglishGenerationTask, "cleared-task").status, "cleared")
            self.assertEqual(session.get(EnglishGenerationTask, "failed-task").status, "cleared")
            self.assertEqual(session.get(EnglishGenerationTask, "running-task").status, "cleared")
            self.assertEqual(session.get(EnglishGenerationTask, "queued-task").status, "cleared")
            self.assertTrue(paths.task_dir("completed-task").exists())
            self.assertTrue(paths.task_dir("cleared-task").exists())
            self.assertFalse(paths.task_dir("failed-task").exists())
            self.assertFalse(paths.task_dir("running-task").exists())
            self.assertFalse(paths.task_dir("queued-task").exists())

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
        )

        self.assertEqual([item["text_zh"] for item in translated], ["你好，世界。", "我们继续前进。"])
        self.assertEqual(len(recorded_calls), 3)
        self.assertTrue(recorded_calls[0]["source_text"].startswith("[S0000] Hello world."))
        for item in recorded_calls:
            self.assertEqual(
                item["extra_payload"],
                {"translation_options": {"source_lang": "English", "target_lang": "Chinese"}},
            )
