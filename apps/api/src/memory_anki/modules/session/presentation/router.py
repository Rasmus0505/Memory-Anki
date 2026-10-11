from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from memory_anki.modules.session.application.live_study_room import (
    apply_live_study_command,
    stream_live_study_events,
)
from memory_anki.modules.session.domain.schemas import LiveStudyCommand

router = APIRouter(tags=["sessions"])


@router.get("/session/live/stream")
def api_live_study_stream(
    client_id: str = Query(..., min_length=1, max_length=80),
):
    return StreamingResponse(
        stream_live_study_events(client_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.post("/session/live/commands")
def api_live_study_command(data: LiveStudyCommand):
    try:
        return apply_live_study_command(data.model_dump(exclude_unset=True))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
