from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.deps import session_dep
from memory_anki.modules.progression.application.overview_service import build_progression_overview

router = APIRouter(tags=["progression"])


@router.get("/progression/overview")
def api_progression_overview(s: Session = Depends(session_dep)) -> dict[str, Any]:
    return build_progression_overview(s)
