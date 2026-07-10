from __future__ import annotations

import fitz
import pytest

from memory_anki.infrastructure.db._tables.knowledge import Chapter, Subject
from memory_anki.infrastructure.db._tables.palaces import Palace
from memory_anki.modules.palace_quiz.application.question_contracts import PalaceQuizValidationError
from memory_anki.modules.palace_quiz.application.workspace_service import (
    add_pdf_source,
    add_text_source,
    create_job,
    delete_pdf_asset,
    parse_page_numbers,
    reorder_sources,
    update_matching,
    upload_pdf_asset,
)


def test_parse_page_numbers_supports_ranges_and_discrete_pages() -> None:
    assert parse_page_numbers("1-3, 5，7-8,3", 10) == [1, 2, 3, 5, 7, 8]


@pytest.mark.parametrize("expression", ["", "0", "-1", "4-2", "1-a", "11"])
def test_parse_page_numbers_rejects_invalid_values(expression: str) -> None:
    with pytest.raises(PalaceQuizValidationError):
        parse_page_numbers(expression, 10)


def _seed_job(db_session):
    subject = Subject(name="生物")
    db_session.add(subject)
    db_session.flush()
    chapter = Chapter(subject_id=subject.id, name="第三章")
    palace = Palace(title="细胞宫殿")
    db_session.add_all([chapter, palace])
    db_session.commit()
    return create_job(db_session, palace_id=palace.id, data={"selected_chapter_id": chapter.id})


def _pdf_bytes() -> bytes:
    document = fitz.open()
    document.new_page().insert_text((72, 72), "Question page")
    document.new_page().insert_text((72, 72), "Answer page")
    content = document.tobytes()
    document.close()
    return content


def test_pdf_assets_dedupe_physical_file_and_block_referenced_delete(db_session) -> None:
    content = _pdf_bytes()
    first = upload_pdf_asset(db_session, content=content, original_name="one.pdf", name="第一份")
    second = upload_pdf_asset(db_session, content=content, original_name="two.pdf", name="第二份")
    assert first["page_count"] == 2
    from memory_anki.infrastructure.db._tables.quiz_generation import QuizPdfAsset

    assert (
        db_session.get(QuizPdfAsset, first["id"]).relative_path
        == db_session.get(QuizPdfAsset, second["id"]).relative_path
    )
    job = _seed_job(db_session)
    add_pdf_source(
        db_session,
        job["id"],
        {"role": "answer", "pdf_asset_id": first["id"], "page_expression": "2"},
    )
    with pytest.raises(PalaceQuizValidationError, match="只能归档"):
        delete_pdf_asset(db_session, first["id"])


def test_sources_reorder_and_matching_answer_edit_persist(db_session) -> None:
    job = _seed_job(db_session)
    first = add_text_source(
        db_session, job["id"], {"role": "question", "source_type": "text", "text_content": "题目一"}
    )
    second = add_text_source(
        db_session, job["id"], {"role": "answer", "source_type": "text", "text_content": "答案一"}
    )
    reordered = reorder_sources(db_session, job["id"], [second["id"], first["id"]])
    assert [item["id"] for item in reordered["sources"]] == [second["id"], first["id"]]
    updated = update_matching(
        db_session,
        job["id"],
        [
            {
                "id": "match-1",
                "status": "matched",
                "confidence": "high",
                "ignored": False,
                "question_text": "细胞核的作用？",
                "answer_text": "储存遗传信息",
                "answer_generated_by_ai": False,
                "question": {
                    "question_type": "short_answer",
                    "stem": "旧题干",
                    "options": [],
                    "answer_payload": {},
                    "analysis": "",
                    "source_meta": {},
                },
            }
        ],
    )
    question = updated["matching_items"][0]["question"]
    assert question["stem"] == "细胞核的作用？"
    assert question["answer_payload"]["reference_answer"] == "储存遗传信息"
