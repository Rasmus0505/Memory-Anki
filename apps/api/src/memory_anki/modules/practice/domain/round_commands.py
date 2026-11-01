"""Explicit commands over the freestyle round plan.

Why a command facade
--------------------
The plan is one mutable dict with about fifteen keys, and every feature that
touched a round — retry, wrong-first ordering, settlement compression, the new
study day, bedtime, favourites — added a rule that assigns into it directly. The
rules then depend on call order rather than on a declared transition, which is
how "the card under my finger changed" kept coming back through a different
door each time.

This module names the transitions. Each command takes the plan plus its inputs
and returns ``(new_plan, event)``. It deliberately does **not** touch the
database, the session, or ``plan_version``: the caller keeps transaction
ownership, so the command stays a pure function and can be replayed in a test.

Stage 1 of the migration: every command delegates to the existing rule, so
behaviour is byte-identical. Later stages move the dict writes inside and switch
call sites over one at a time; the golden tests in
``tests/test_round_commands.py`` are what make that safe.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .round_compress import compress_completed
from .round_plan import apply_rating, leave_card, set_cursor
from .round_plan_intraday import publish_ready_retries
from .round_plan_normalization import Plan, normalize_plan

# Commands a caller may issue against an open round.
COMMAND_APPLY_RATING = "apply_rating"
COMMAND_LEAVE_CARD = "leave_card"
COMMAND_MOVE_CURSOR = "move_cursor"
COMMAND_PUBLISH_READY_RETRIES = "publish_ready_retries"
COMMAND_COMPRESS_COMPLETED = "compress_completed"


@dataclass(frozen=True)
class ApplyRating:
    card_id: str
    rating: int
    encounter_id: str
    occurrence_id: str = ""
    unit_id: str = ""
    round_id: str = ""
    unit_revision: int | None = None
    available_at: datetime | None = None
    intraday_kind: str | None = None
    intraday_exhausted: bool = False


@dataclass(frozen=True)
class LeaveCard:
    card_id: str


@dataclass(frozen=True)
class MoveCursor:
    card_id: str


@dataclass(frozen=True)
class PublishReadyRetries:
    now: datetime


@dataclass(frozen=True)
class CompressCompleted:
    """Compress the cards a 小结算 confirmed.

    The set to drop comes from ``round_compress.compressible_ids``; this command
    only carries the snapshot the caller wants recorded for 大结算.
    """

    settlement: Mapping[str, Any] | None = None


RoundCommand = ApplyRating | LeaveCard | MoveCursor | PublishReadyRetries | CompressCompleted


@dataclass(frozen=True)
class RoundEvent:
    """What changed, in terms a caller can act on without re-reading the plan."""

    command: str
    current_card_id: str | None = None
    current_index: int = 0
    completed_ids: list[str] = field(default_factory=list)
    inserted_occurrence_ids: list[str] = field(default_factory=list)
    compressed_ids: list[str] = field(default_factory=list)


def _event(command: str, plan: Mapping[str, Any], **extra: Any) -> RoundEvent:
    return RoundEvent(
        command=command,
        current_card_id=plan.get("current_card_id"),
        current_index=int(plan.get("current_index") or 0),
        completed_ids=list(plan.get("completed_ids") or []),
        **extra,
    )


def _occurrence_ids(plan: Mapping[str, Any], *, status: str) -> list[str]:
    return [
        str(item.get("occurrence_id"))
        for item in plan.get("occurrences") or []
        if isinstance(item, Mapping) and item.get("status") == status and item.get("occurrence_id")
    ]


def apply_command(
    plan: Mapping[str, Any] | None,
    command: RoundCommand,
) -> tuple[Plan, RoundEvent]:
    """Run one declared transition and report what it changed."""
    if isinstance(command, ApplyRating):
        next_plan = apply_rating(
            normalize_plan(plan),
            card_id=command.card_id,
            rating=command.rating,
            encounter_id=command.encounter_id,
            occurrence_id=command.occurrence_id,
            unit_id=command.unit_id,
            round_id=command.round_id,
            unit_revision=command.unit_revision,
            available_at=command.available_at,
            intraday_kind=command.intraday_kind,
            intraday_exhausted=command.intraday_exhausted,
        )
        return next_plan, _event(
            COMMAND_APPLY_RATING,
            next_plan,
            inserted_occurrence_ids=_occurrence_ids(next_plan, status="inserted"),
        )
    if isinstance(command, LeaveCard):
        next_plan = leave_card(normalize_plan(plan), command.card_id)
        return next_plan, _event(COMMAND_LEAVE_CARD, next_plan)
    if isinstance(command, MoveCursor):
        next_plan = set_cursor(normalize_plan(plan), command.card_id)
        return next_plan, _event(COMMAND_MOVE_CURSOR, next_plan)
    if isinstance(command, PublishReadyRetries):
        next_plan = publish_ready_retries(normalize_plan(plan), now=command.now)
        return next_plan, _event(
            COMMAND_PUBLISH_READY_RETRIES,
            next_plan,
            inserted_occurrence_ids=_occurrence_ids(next_plan, status="inserted"),
        )
    if isinstance(command, CompressCompleted):
        next_plan = compress_completed(
            normalize_plan(plan),
            dict(command.settlement) if command.settlement else None,
        )
        return next_plan, _event(
            COMMAND_COMPRESS_COMPLETED,
            next_plan,
            compressed_ids=list(next_plan.get("compressed_ids") or []),
        )
    raise TypeError(f"unsupported round command: {type(command).__name__}")


__all__ = [
    "ApplyRating",
    "COMMAND_APPLY_RATING",
    "COMMAND_COMPRESS_COMPLETED",
    "COMMAND_LEAVE_CARD",
    "COMMAND_MOVE_CURSOR",
    "COMMAND_PUBLISH_READY_RETRIES",
    "CompressCompleted",
    "LeaveCard",
    "MoveCursor",
    "PublishReadyRetries",
    "RoundCommand",
    "RoundEvent",
    "apply_command",
]
