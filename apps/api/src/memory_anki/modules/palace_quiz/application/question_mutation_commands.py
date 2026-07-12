from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.modules.palace_quiz.application.ocr_sources import (
    upsert_palace_ocr_sources,
)
from memory_anki.modules.palace_quiz.application.questions.commands import (
    batch_create_chapter_questions,
    batch_create_questions,
    create_question,
    record_choice_attempt,
)
from memory_anki.platform.application import UnitOfWork

ResponseCallback = Callable[[dict[str, Any]], None]


def create_question_command(
    session: Session,
    palace_id: int,
    payload: dict[str, Any],
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None = None,
) -> dict[str, Any]:
    response = {"item": create_question(session, palace_id, payload, commit=False)}
    _commit_response(response, uow=uow, before_commit=before_commit)
    return response


def batch_create_palace_questions_command(
    session: Session,
    palace_id: int,
    payload: dict[str, Any],
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None = None,
) -> dict[str, Any]:
    question_payloads = payload.get("questions")
    items = batch_create_questions(
        session,
        palace_id,
        question_payloads if isinstance(question_payloads, list) else [],
        commit=False,
    )
    ocr_sources = payload.get("ocr_sources")
    if isinstance(ocr_sources, list) and ocr_sources:
        upsert_palace_ocr_sources(
            session, palace_id=palace_id, payloads=ocr_sources, commit=False
        )
    response = {"items": items}
    _commit_response(response, uow=uow, before_commit=before_commit)
    return response


def batch_create_chapter_questions_command(
    session: Session,
    chapter_id: int,
    payload: dict[str, Any],
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None = None,
) -> dict[str, Any]:
    question_payloads = payload.get("questions")
    items = batch_create_chapter_questions(
        session,
        chapter_id,
        question_payloads if isinstance(question_payloads, list) else [],
        save_mode=str(payload.get("save_mode") or "append"),
        commit=False,
    )
    palace_id = payload.get("palace_id")
    ocr_sources = payload.get("ocr_sources")
    if palace_id and isinstance(ocr_sources, list) and ocr_sources:
        upsert_palace_ocr_sources(
            session,
            palace_id=int(palace_id),
            payloads=ocr_sources,
            commit=False,
        )
    response = {"items": items}
    _commit_response(response, uow=uow, before_commit=before_commit)
    return response


def record_choice_attempt_command(
    session: Session,
    question_id: int,
    selected_option_id: str,
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None = None,
) -> dict[str, Any]:
    response = record_choice_attempt(
        session, question_id, selected_option_id, commit=False
    )
    _commit_response(response, uow=uow, before_commit=before_commit)
    return response


def _commit_response(
    response: dict[str, Any],
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None,
) -> None:
    if before_commit is not None:
        before_commit(response)
    uow.commit()
