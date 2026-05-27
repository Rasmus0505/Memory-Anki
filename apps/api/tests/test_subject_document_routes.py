import io
import tempfile
import unittest
from pathlib import Path

import fitz
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base, Subject
from memory_anki.modules.knowledge.application import subject_document_service
from memory_anki.modules.knowledge.presentation import router as knowledge_router


def build_pdf_bytes(page_count: int = 3) -> bytes:
    document = fitz.open()
    for index in range(page_count):
        page = document.new_page()
        page.insert_text((72, 72), f"Page {index + 1}")
    try:
        return document.tobytes()
    finally:
        document.close()


class SubjectDocumentRouteTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)
        self.original_get_session = knowledge_router.get_session
        self.temp_dir = tempfile.TemporaryDirectory()
        self.attachments_dir = Path(self.temp_dir.name) / "attachments"
        self.attachments_dir.mkdir(parents=True, exist_ok=True)
        subject_document_service.ATTACHMENTS_DIR = self.attachments_dir
        subject_document_service.SUBJECT_DOCUMENTS_DIR = self.attachments_dir / "subjects"
        subject_document_service.SUBJECT_DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)

        def get_test_session():
            return self.SessionLocal()

        knowledge_router.get_session = get_test_session
        with self.SessionLocal() as session:
            session.add(Subject(name="外国教育史", color="#6366f1", sort_order=0))
            session.commit()

        app = FastAPI()
        app.include_router(knowledge_router.router, prefix="/api/v1")
        self.client = TestClient(app)

    def tearDown(self):
        knowledge_router.get_session = self.original_get_session
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_upload_list_download_pages_and_delete_subject_document(self):
        pdf_bytes = build_pdf_bytes(page_count=3)

        upload = self.client.post(
            "/api/v1/subjects/1/documents",
            files={"file": ("history.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
        )
        self.assertEqual(upload.status_code, 200)
        payload = upload.json()
        self.assertEqual(payload["original_name"], "history.pdf")
        self.assertEqual(payload["page_count"], 3)
        document_id = payload["id"]

        listed = self.client.get("/api/v1/subjects/1/documents")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["items"]), 1)

        downloaded = self.client.get(f"/api/v1/subjects/1/documents/{document_id}")
        self.assertEqual(downloaded.status_code, 200)
        self.assertEqual(downloaded.headers["content-type"], "application/pdf")

        pages = self.client.get(f"/api/v1/subjects/1/documents/{document_id}/pages")
        self.assertEqual(pages.status_code, 200)
        pages_payload = pages.json()
        self.assertEqual(pages_payload["page_count"], 3)
        self.assertEqual(len(pages_payload["pages"]), 3)
        self.assertIn("/pages/1/image", pages_payload["pages"][0]["thumbnail_url"])

        image = self.client.get(
            f"/api/v1/subjects/1/documents/{document_id}/pages/2/image?kind=thumbnail"
        )
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image.headers["content-type"], "image/png")
        self.assertTrue(image.content.startswith(b"\x89PNG"))

        deleted = self.client.delete(f"/api/v1/subjects/1/documents/{document_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertTrue(deleted.json()["ok"])

        listed_after_delete = self.client.get("/api/v1/subjects/1/documents")
        self.assertEqual(listed_after_delete.status_code, 200)
        self.assertEqual(listed_after_delete.json()["items"], [])

    def test_rejects_non_pdf_upload(self):
        upload = self.client.post(
            "/api/v1/subjects/1/documents",
            files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
        )
        self.assertEqual(upload.status_code, 400)
        self.assertIn("仅支持上传 PDF", upload.json()["error"])
