"""Server-side 未保存 rating intents: one per round + card.

A save that failed is recorded here so it survives a reload and every device
that opens the round can see and retry it. Writes are idempotent by operation id:
clearing only removes the intent whose operation id matches, so a late success
for an older tap never erases a newer 未保存 choice.

An intent whose attempt a later real practice has superseded is dropped on read.
It can never be written, so listing it would keep a card's rail tick unfilled and
point 重试 at a guaranteed 400.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import FreestyleRatingIntent
from memory_anki.modules.memory.api import rating_attempt_is_superseded

MAX_PAYLOAD_BYTES = 8_192


def _to_dict(row: FreestyleRatingIntent) -> dict[str, Any]:
    try:
        payload = json.loads(row.payload_json or "{}")
    except json.JSONDecodeError:
        payload = {}
    return {
        "card_id": row.card_id,
        "operation_id": row.operation_id,
        "rating": int(row.rating),
        "failure": row.failure or "",
        "payload": payload if isinstance(payload, dict) else {},
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def list_rating_intents(session: Session, *, round_id: str) -> list[dict[str, Any]]:
    rows = (
        session.query(FreestyleRatingIntent)
        .filter_by(round_id=round_id)
        .order_by(FreestyleRatingIntent.updated_at)
        .all()
    )
    items: list[dict[str, Any]] = []
    dropped = False
    for row in rows:
        data = _to_dict(row)
        payload = data["payload"]
        try:
            retry_attempt = int(payload.get("retry_attempt") or 0)
        except (TypeError, ValueError):
            retry_attempt = 0
        if rating_attempt_is_superseded(
            session,
            round_id=round_id,
            unit_id=str(payload.get("unit_id") or ""),
            encounter_id=str(payload.get("encounter_id") or ""),
            card_id=str(payload.get("card_id") or row.card_id),
            occurrence_id=str(payload.get("occurrence_id") or ""),
            retry_attempt=retry_attempt,
        ):
            session.delete(row)
            dropped = True
            continue
        items.append(data)
    if dropped:
        session.commit()
    return items


def put_rating_intent(
    session: Session,
    *,
    round_id: str,
    card_id: str,
    operation_id: str,
    rating: int,
    failure: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    card = str(card_id or "").strip()
    if not card:
        raise ValueError("card_id is required")
    encoded = json.dumps(payload or {}, ensure_ascii=False)
    if len(encoded.encode("utf-8")) > MAX_PAYLOAD_BYTES:
        raise ValueError("rating intent payload is too large")
    row = session.get(FreestyleRatingIntent, (round_id, card))
    if row is None:
        row = FreestyleRatingIntent(round_id=round_id, card_id=card)
        session.add(row)
    row.operation_id = operation_id
    row.rating = int(rating)
    row.failure = failure or ""
    row.payload_json = encoded
    row.updated_at = utc_now_naive()
    session.commit()
    return _to_dict(row)


def clear_rating_intent(
    session: Session,
    *,
    round_id: str,
    card_id: str,
    operation_id: str,
) -> bool:
    row = session.get(FreestyleRatingIntent, (round_id, card_id))
    if row is None or row.operation_id != operation_id:
        return False
    session.delete(row)
    session.commit()
    return True
