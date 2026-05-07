from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime
from models import get_session, Config
from services.schedule_service import update_all_pending_schedules
from config import DEFAULTS

router = APIRouter(tags=["settings"])


def session_dep():
    s = get_session()
    try:
        yield s
    finally:
        s.close()


def read_settings(session: Session) -> dict:
    result = dict(DEFAULTS)
    for row in session.query(Config).all():
        result[row.key] = row.value
    return result


def write_settings(data: dict, session: Session) -> dict:
    old_algorithm = None
    old_row = session.query(Config).filter_by(key="default_algorithm").first()
    if old_row:
        old_algorithm = old_row.value

    for key, value in data.items():
        if key in DEFAULTS:
            row = session.query(Config).filter_by(key=key).first()
            if row:
                row.value = str(value)
                row.updated_at = datetime.utcnow()
            else:
                session.add(Config(key=key, value=str(value)))
    session.commit()

    # 如果算法变了且用户选择全部应用
    new_algorithm = data.get("default_algorithm", "")
    if (data.get("apply_to_pending") == "all" and
            new_algorithm and new_algorithm != old_algorithm):
        update_all_pending_schedules(session, new_algorithm)

    return read_settings(session)


@router.get("/settings")
def api_settings(s: Session = Depends(session_dep)):
    return read_settings(s)


@router.put("/settings")
def api_settings_update(data: dict, s: Session = Depends(session_dep)):
    return write_settings(data, s)


@router.get("/profile/review-settings")
def api_profile_review_settings(s: Session = Depends(session_dep)):
    return read_settings(s)


@router.put("/profile/review-settings")
def api_profile_review_settings_update(data: dict, s: Session = Depends(session_dep)):
    return write_settings(data, s)
