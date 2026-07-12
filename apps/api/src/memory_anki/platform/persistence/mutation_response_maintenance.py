from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.misc import Config

MUTATION_RESPONSE_CONFIG_PREFIX = "api_mutation."
MUTATION_RESPONSE_TTL_DAYS = 14


def _like_prefix_pattern(prefix: str) -> str:
    return prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def purge_expired_mutation_responses(
    session: Session,
    *,
    ttl_days: int = MUTATION_RESPONSE_TTL_DAYS,
    now: datetime | None = None,
) -> int:
    cutoff = (now or utc_now_naive()) - timedelta(days=ttl_days)
    deleted = (
        session.query(Config)
        .filter(
            Config.key.like(
                _like_prefix_pattern(MUTATION_RESPONSE_CONFIG_PREFIX), escape="\\"
            ),
            or_(Config.updated_at.is_(None), Config.updated_at < cutoff),
        )
        .delete(synchronize_session=False)
    )
    session.commit()
    return int(deleted)
