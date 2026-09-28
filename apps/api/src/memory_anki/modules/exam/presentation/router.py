from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.exam.application.overview_service import build_exam_overview
from memory_anki.modules.exam.application.settings_service import (
    ExamNotFoundError,
    get_exam_settings,
    save_exam_settings,
    set_chapter_stars,
    set_palace_stars,
    set_subject_share,
)

router = APIRouter(tags=["exam"])


@router.get("/exam/overview")
def api_exam_overview(s: Session = Depends(session_dep)) -> dict[str, Any]:
    return build_exam_overview(s)


@router.get("/exam/settings")
def api_get_exam_settings(s: Session = Depends(session_dep)) -> dict[str, Any]:
    return get_exam_settings(s)


@router.put("/exam/settings")
def api_save_exam_settings(data: dict[str, Any], s: Session = Depends(session_dep)) -> dict[str, Any]:
    try:
        return save_exam_settings(s, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/exam/chapters/{chapter_id}/stars")
def api_set_chapter_stars(chapter_id: int, data: dict[str, Any], s: Session = Depends(session_dep)) -> dict[str, Any]:
    try:
        return set_chapter_stars(s, chapter_id, data)
    except ExamNotFoundError as exc:
        raise HTTPException(status_code=404, detail="chapter not found") from exc


@router.put("/exam/palaces/{palace_id}/stars")
def api_set_palace_stars(palace_id: int, data: dict[str, Any], s: Session = Depends(session_dep)) -> dict[str, Any]:
    try:
        return set_palace_stars(s, palace_id, data)
    except ExamNotFoundError as exc:
        raise HTTPException(status_code=404, detail="palace not found") from exc


@router.put("/exam/subjects/{subject_id}/share")
def api_set_subject_share(subject_id: int, data: dict[str, Any], s: Session = Depends(session_dep)) -> dict[str, Any]:
    try:
        return set_subject_share(s, subject_id, data)
    except ExamNotFoundError as exc:
        raise HTTPException(status_code=404, detail="subject not found") from exc
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="share must be 0-100") from exc
