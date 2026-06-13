import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, SubjectDocument
from memory_anki.modules.palaces.presentation import import_router


class ImportRouteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)
        self.original_get_session = import_router.get_session

        def get_test_session():
            return self.SessionLocal()

        import_router.get_session = get_test_session

        with self.SessionLocal() as session:
            session.add(
                SubjectDocument(
                    id=1,
                    subject_id=1,
                    filename="subjects/1/demo.pdf",
                    original_name="demo.pdf",
                    mime_type="application/pdf",
                    file_size=123,
                    page_count=8,
                )
            )
            session.commit()

        app = FastAPI()
        app.include_router(import_router.router, prefix="/api/v1")
        self.client = TestClient(app)

    def tearDown(self):
        import_router.get_session = self.original_get_session
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_preview_pdf_stream_passes_ai_options_into_stream_runtime(self):
        def fake_stream(**_kwargs):
            yield {
                "event": "result",
                "data": {
                    "ok": True,
                    "source_tree": {"title": "导入脑图", "children": []},
                    "editor_doc": {"root": {"data": {"text": "导入脑图", "uid": "root"}, "children": []}},
                },
            }

        with patch.object(import_router, "stream_pdf_import_preview", side_effect=fake_stream) as mock_stream:
            response = self.client.post(
                "/api/v1/import/preview-mindmap-pdf",
                json={
                    "subject_document_id": 1,
                    "page_selection": [2, 3],
                    "pdf_mode": "direct_generation",
                    "range_prompt": "古希腊",
                    "fallback_title": "demo.pdf",
                    "ai_options": {
                        "model": "glm-4.6v-flash",
                        "thinking_enabled": True,
                    },
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertIn("text/event-stream", response.headers["content-type"])
        self.assertIn("event: result", response.text)
        self.assertEqual(mock_stream.call_count, 1)

        call_kwargs = mock_stream.call_args.kwargs
        self.assertEqual(call_kwargs["document"].id, 1)
        self.assertEqual(call_kwargs["page_selection"], [2, 3])
        self.assertIsNotNone(call_kwargs["session"])
        self.assertEqual(call_kwargs["ai_options"].model, "glm-4.6v-flash")
        self.assertTrue(call_kwargs["ai_options"].thinking_enabled)


if __name__ == "__main__":
    unittest.main()
