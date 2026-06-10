from __future__ import annotations

import json
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import Config

MUTATION_ID_HEADER = "X-Memory-Anki-Mutation-ID"
CONFIG_PREFIX = "api_mutation."
MAX_MUTATION_ID_LENGTH = 80


def read_mutation_id(request: Request | None) -> str | None:
    if request is None:
        return None
    value = request.headers.get(MUTATION_ID_HEADER, "").strip()
    if not value or len(value) > MAX_MUTATION_ID_LENGTH:
        return None
    return value


def _config_key(mutation_id: str) -> str:
    return f"{CONFIG_PREFIX}{mutation_id}"


def get_idempotent_response(session: Session, request: Request | None) -> Any | None:
    mutation_id = read_mutation_id(request)
    if not mutation_id:
        return None
    row = session.query(Config).filter_by(key=_config_key(mutation_id)).first()
    if row is None or not row.value:
        return None
    try:
        return json.loads(row.value)
    except Exception:
        return None


def save_idempotent_response(
    session: Session,
    request: Request | None,
    payload: Any,
) -> None:
    mutation_id = read_mutation_id(request)
    if not mutation_id:
        return
    try:
        value = json.dumps(payload, ensure_ascii=False)
    except Exception:
        return
    row = session.query(Config).filter_by(key=_config_key(mutation_id)).first()
    if row is None:
        row = Config(key=_config_key(mutation_id), value=value)
        session.add(row)
    else:
        row.value = value
        row.updated_at = utc_now_naive()
    session.commit()
