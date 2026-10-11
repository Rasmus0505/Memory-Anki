"""Session text library.

The startup script prepares this once, before the window opens. Page reads then
return the in-memory copy. English audio and subject image files stay on disk
until a page actually opens them.
"""

from contextlib import contextmanager

from fastapi import APIRouter
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.content.application.study_text_library import (
    build_study_text_editors,
    group_bindings_by_palace,
    group_questions_by_palace,
)
from memory_anki.modules.content.application.study_text_library_cache import (
    configure_study_text_library_builder,
    install_study_text_refresh_listener,
    prepare_study_text_library,
    read_prepared_study_text_library,
)
from memory_anki.modules.quiz.public.queries import (
    list_published_questions_for_palaces,
    list_study_text_bindings,
)

router = APIRouter()


def compose_study_text_library(session: Session) -> dict:
    # Imported here so catalog routes can finish loading before this composer
    # calls them. The catalog builders are the same payloads the shelf reads.
    from memory_anki.modules.content.presentation.catalog_router import (
        api_list_grouped,
        api_list_subject_shelf,
    )

    editors, minimal_by_palace = build_study_text_editors(session)
    questions = list_published_questions_for_palaces(session)
    bindings = list_study_text_bindings(session)
    return {
        "editors": editors,
        "questions_by_palace": group_questions_by_palace(questions, minimal_by_palace),
        "bindings_by_palace": group_bindings_by_palace(bindings, editors),
        "grouped": api_list_grouped("", None, False, session),
        "subjects": api_list_subject_shelf("", session),
    }


def _build_study_text_library() -> dict:
    with contextmanager(session_dep)() as session:
        return compose_study_text_library(session)


@router.get("/study-text-library")
def api_study_text_library():
    return read_prepared_study_text_library()


@router.post("/study-text-library/prepare")
def api_prepare_study_text_library():
    payload = prepare_study_text_library(force=True, max_age_seconds=15)
    editors = payload.get("editors") or []
    return {
        "ready": True,
        "palaces": len(editors) if isinstance(editors, list) else 0,
        "prepared_at": payload.get("prepared_at"),
    }


configure_study_text_library_builder(_build_study_text_library)
install_study_text_refresh_listener()
