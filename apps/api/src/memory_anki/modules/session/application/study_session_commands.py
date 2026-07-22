from __future__ import annotations

from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.platform.application import UnitOfWork

from .study_session_bridge import create_completed_study_session_from_time_payload
from .study_session_service import (
    abandon_study_session,
    append_study_session_events,
    complete_study_session,
    create_study_session,
)

ResponseCallback = Callable[[dict[str, Any]], None]


def create_study_session_command(
    session: Session,
    payload: dict[str, Any],
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None = None,
) -> dict[str, Any]:
    response = {"item": create_study_session(session, payload, commit=False)}
    _commit_response(response, uow=uow, before_commit=before_commit)
    return response


def append_study_session_events_command(
    session: Session,
    session_id: str,
    events: list[dict[str, Any]],
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None = None,
) -> dict[str, Any] | None:
    item = append_study_session_events(session, session_id, events, commit=False)
    return _commit_optional_item(item, uow=uow, before_commit=before_commit)


def complete_study_session_command(
    session: Session,
    session_id: str,
    payload: dict[str, Any],
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None = None,
) -> dict[str, Any] | None:
    item = complete_study_session(session, session_id, payload, commit=False)
    return _commit_optional_item(item, uow=uow, before_commit=before_commit)


def abandon_study_session_command(
    session: Session,
    session_id: str,
    payload: dict[str, Any],
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None = None,
) -> dict[str, Any] | None:
    item = abandon_study_session(session, session_id, payload, commit=False)
    return _commit_optional_item(item, uow=uow, before_commit=before_commit)


def create_study_session_from_time_record_command(
    session: Session,
    payload: dict[str, Any],
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None = None,
) -> dict[str, Any]:
    response = {
        "item": create_completed_study_session_from_time_payload(
            session, payload, commit=False
        )
    }
    _commit_response(response, uow=uow, before_commit=before_commit)
    return response


def _commit_optional_item(
    item: dict[str, Any] | None,
    *,
    uow: UnitOfWork,
    before_commit: ResponseCallback | None,
) -> dict[str, Any] | None:
    if item is None:
        return None
    response = {"item": item}
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
