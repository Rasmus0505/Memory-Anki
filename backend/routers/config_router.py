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


@router.get("/settings")
def api_settings(s: Session = Depends(session_dep)):
    result = dict(DEFAULTS)
    for row in s.query(Config).all():
        result[row.key] = row.value
    return result


@router.put("/settings")
def api_settings_update(data: dict, s: Session = Depends(session_dep)):
    old_algorithm = None
    old_row = s.query(Config).filter_by(key="default_algorithm").first()
    if old_row:
        old_algorithm = old_row.value

    for key, value in data.items():
        if key in DEFAULTS:
            row = s.query(Config).filter_by(key=key).first()
            if row:
                row.value = str(value)
                row.updated_at = datetime.utcnow()
            else:
                s.add(Config(key=key, value=str(value)))
    s.commit()

    # 如果算法变了且用户选择全部应用
    new_algorithm = data.get("default_algorithm", "")
    if (data.get("apply_to_pending") == "all" and
            new_algorithm and new_algorithm != old_algorithm):
        update_all_pending_schedules(s, new_algorithm)

    result = dict(DEFAULTS)
    for row in s.query(Config).all():
        result[row.key] = row.value
    return result
