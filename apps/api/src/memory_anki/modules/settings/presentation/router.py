from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from memory_anki.core.config import DEFAULTS
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Config, get_session
from memory_anki.modules.reviews.application.schedule_service import (
    normalize_algorithm,
    update_all_pending_schedules,
)

router = APIRouter(tags=["settings"])

SCHEDULE_IMPACTING_KEYS = {
    "default_algorithm",
    "custom_intervals",
    "ebbinghaus_intervals",
    "sleep_review_time",
    "early_review_anchor",
}


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


def read_settings(session: Session) -> dict:
    result = dict(DEFAULTS)
    for row in session.query(Config).all():
        result[row.key] = normalize_algorithm(row.value) if row.key == "default_algorithm" else row.value
    return result


def write_settings(data: dict, session: Session) -> dict:
    before_settings = read_settings(session)

    for key, value in data.items():
        if key in DEFAULTS:
            nextValue = normalize_algorithm(value) if key == "default_algorithm" else value
            row = session.query(Config).filter_by(key=key).first()
            if row:
                row.value = str(nextValue)
                row.updated_at = utc_now_naive()
            else:
                session.add(Config(key=key, value=str(nextValue)))
    session.commit()

    next_settings = read_settings(session)
    if data.get("apply_to_pending") == "all":
        changed_keys = {
            key
            for key in SCHEDULE_IMPACTING_KEYS
            if str(before_settings.get(key, "")) != str(next_settings.get(key, ""))
        }
        if changed_keys:
            update_all_pending_schedules(
                session,
                next_settings.get("default_algorithm"),
            )
            next_settings = read_settings(session)

    return next_settings


@router.get("/settings")
def api_settings(s: Session = Depends(session_dep)):
    return read_settings(s)


@router.put("/settings")
def api_settings_update(data: dict, s: Session = Depends(session_dep)):
    return write_settings(data, s)


@router.get("/settings/review")
def api_review_settings(s: Session = Depends(session_dep)):
    return read_settings(s)


@router.put("/settings/review")
def api_review_settings_update(data: dict, s: Session = Depends(session_dep)):
    return write_settings(data, s)


@router.get("/profile/review-settings")
def api_profile_review_settings(s: Session = Depends(session_dep)):
    return read_settings(s)


@router.put("/profile/review-settings")
def api_profile_review_settings_update(data: dict, s: Session = Depends(session_dep)):
    return write_settings(data, s)
