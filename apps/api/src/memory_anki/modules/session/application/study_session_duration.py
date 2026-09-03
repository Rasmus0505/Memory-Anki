"""Small, shared rules for accepting study-session durations.

The timer is allowed to report its active seconds, but a normal (not manually
edited) record must never contain more seconds than elapsed wall-clock time.
This is the last line of defence for delayed browser timers, backgrounded PWAs,
and requests that arrive after the tab has thawed.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

MAX_SESSION_KEY_LENGTH = 160
MAX_OPERATION_ID_LENGTH = 128


def payload_value(payload: dict[str, Any], snake_name: str, camel_name: str) -> Any:
    """Read one mutation field from either the API or legacy timer spelling."""

    if snake_name in payload:
        return payload[snake_name]
    return payload.get(camel_name)


def normalize_session_key(value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) > MAX_SESSION_KEY_LENGTH:
        raise ValueError(f"session_key 不能超过 {MAX_SESSION_KEY_LENGTH} 个字符。")
    return text


def normalize_operation_id(value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) > MAX_OPERATION_ID_LENGTH:
        raise ValueError(f"operation_id 不能超过 {MAX_OPERATION_ID_LENGTH} 个字符。")
    return text


def normalize_client_revision(value: object, *, default: int | None = None) -> int | None:
    if value in (None, ""):
        return default
    if isinstance(value, bool):
        raise ValueError("客户端版本必须是非负整数。")
    try:
        revision = int(str(value))
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("客户端版本必须是非负整数。") from exc
    if revision < 0:
        raise ValueError("客户端版本必须是非负整数。")
    return revision


def write_metadata(payload: dict[str, Any]) -> tuple[str | None, int | None, str | None]:
    """Return ``session_key``, revision and operation id from a write payload."""

    return (
        normalize_session_key(payload_value(payload, "session_key", "sessionKey")),
        normalize_client_revision(payload_value(payload, "client_revision", "clientRevision")),
        normalize_operation_id(payload_value(payload, "operation_id", "operationId")),
    )


def wall_clock_seconds(
    started_at: datetime | None,
    ended_at: datetime | None,
) -> int | None:
    """Return non-negative whole seconds in a timestamp interval."""

    if started_at is None or ended_at is None:
        return None
    if started_at > ended_at:
        raise ValueError("开始时间不能晚于结束时间。")
    return max(0, int((ended_at - started_at).total_seconds()))


def normalize_effective_seconds(
    value: object,
    *,
    started_at: datetime | None,
    ended_at: datetime | None,
    duration_edited: bool = False,
    now: datetime | None = None,
) -> int:
    """Normalize a timer duration and cap unedited values to wall time.

    Active checkpoints have no ``ended_at``.  They are capped against the
    server's current time so a stale or resumed browser cannot submit more
    time than the session has existed.  A hand-edited record is explicitly
    user-owned and is therefore not truncated.
    """

    try:
        seconds = max(0, int(str(value or 0)))
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError("有效时长必须是非负整数。") from exc
    # Validate the interval even for hand-edited history.  The explicit edit
    # only opts out of the duration cap; it must not make impossible timestamps
    # valid.
    if started_at is not None and ended_at is not None and started_at > ended_at:
        raise ValueError("开始时间不能晚于结束时间。")
    if duration_edited:
        return seconds

    boundary = ended_at if ended_at is not None else now
    # A client clock can be ahead of the server.  Keep the supplied timestamp
    # for auditability but never credit seconds beyond the server's current
    # wall clock.
    if boundary is not None and now is not None and boundary > now:
        boundary = now
    wall_seconds = wall_clock_seconds(started_at, boundary)
    if wall_seconds is None:
        return seconds
    return min(seconds, wall_seconds)


def completion_priority(status: str | None, completion_method: str | None) -> int:
    """Rank terminal writes so stale autosaves cannot reopen a finished row."""

    if status != "completed":
        return 0
    return {
        "saved": 0,
        "left_page": 1,
        "restart": 2,
        "manual_complete": 3,
        "auto_complete": 3,
        "all_units_passed": 4,
    }.get(str(completion_method or ""), 2)


def should_ignore_terminal_write(
    *,
    existing_status: str | None,
    existing_completion_method: str | None,
    incoming_status: str | None,
    incoming_completion_method: str | None,
    existing_effective_seconds: int,
    incoming_effective_seconds: int,
    incoming_duration_edited: bool,
    existing_client_revision: int = 0,
    incoming_client_revision: int | None = None,
    existing_operation_id: str | None = None,
    incoming_operation_id: str | None = None,
) -> bool:
    """Return whether a write is duplicate, stale, or older than terminal state."""

    # Operation IDs are idempotency keys scoped to a session row.  A repeated
    # request returns the already accepted representation without reapplying it.
    if incoming_operation_id and incoming_operation_id == existing_operation_id:
        return True
    # Revisions are monotonic.  Treat equal revisions as already handled too:
    # accepting a different payload at the same revision would make retry order
    # observable and lets a delayed autosave overwrite a terminal write.
    if (
        incoming_client_revision is not None
        and incoming_client_revision <= max(0, existing_client_revision)
        and not incoming_duration_edited
    ):
        # A history edit is an explicit user operation.  It may be based on
        # the revision that was read before the edit (including legacy rows at
        # revision 0), so the optimistic-version guard must not discard the
        # user's duration.  Operation IDs still win above, keeping retries
        # idempotent.
        return True

    existing_priority = completion_priority(existing_status, existing_completion_method)
    incoming_priority = completion_priority(incoming_status, incoming_completion_method)

    # Once a row is terminal, a late active/paused checkpoint must never reopen
    # it, including legacy rows whose completion method was ``saved``.
    if existing_status == "completed" and incoming_status != "completed":
        return True
    # Legacy rows marked completed/saved are still terminal.  A second
    # autosave with the same (or weaker) completion method must not replace it;
    # an explicit manual duration edit remains the one supported escape hatch.
    if (
        existing_status == "completed"
        and incoming_status == "completed"
        and incoming_priority <= existing_priority
        and not incoming_duration_edited
    ):
        return True
    # A completed row is authoritative over a late autosave checkpoint.
    if existing_priority > 0 and incoming_priority == 0 and not incoming_duration_edited:
        return True
    if incoming_priority < existing_priority and not incoming_duration_edited:
        return True
    # A timer's cumulative duration cannot legitimately go backwards in either
    # an active checkpoint or a terminal write. Manual history edits opt out
    # explicitly through duration_edited=true.
    return (
        existing_status in {"active", "paused", "recovered"}
        and incoming_status in {"active", "paused", "recovered"}
        and not incoming_duration_edited
        and incoming_effective_seconds < max(0, existing_effective_seconds)
    ) or (
        existing_priority > 0
        and incoming_priority == existing_priority
        and not incoming_duration_edited
        and incoming_effective_seconds < max(0, existing_effective_seconds)
    )
