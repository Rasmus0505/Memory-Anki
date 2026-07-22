"""FSRS helpers for English pattern viewpoint sentences."""

from __future__ import annotations

from datetime import UTC, datetime

from fsrs import Card, Rating, State
from sqlalchemy import or_
from sqlalchemy.orm import Session

from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db._tables.english import EnglishPatternSentence
from memory_anki.modules.memory.public.queries import build_scheduler, load_fsrs_settings


def init_fsrs_card(session: Session, row: EnglishPatternSentence) -> None:
    settings = load_fsrs_settings(session)
    now = utc_now_naive()
    row.fsrs_state = int(State.Learning)
    row.fsrs_step = 0
    row.stability = None
    row.difficulty = None
    row.due_at = now
    row.next_due_at = now
    row.next_due_date = now.date()
    row.last_review_at = None
    row.desired_retention = float(settings["desired_retention"])
    row.maximum_interval = int(settings["maximum_interval"])
    row.scheduler_version = "fsrs-6.3.1"
    row.algorithm_used = "FSRS"
    row.review_type = "fsrs"
    row.interval_days = 0
    row.review_number = 0
    row.anchor_date = now.date()


def apply_fsrs_rating(
    session: Session,
    row: EnglishPatternSentence,
    rating: int,
    *,
    now: datetime,
) -> None:
    settings = load_fsrs_settings(session)
    scheduler = build_scheduler(session)
    if row.due_at is None and row.next_due_at is None:
        init_fsrs_card(session, row)
    card = card_from_row(row)
    review_dt = now.replace(tzinfo=UTC) if now.tzinfo is None else now.astimezone(UTC)
    card, _log = scheduler.review_card(card, Rating(rating), review_datetime=review_dt)
    row.fsrs_state = int(card.state)
    row.fsrs_step = card.step
    row.stability = card.stability
    row.difficulty = card.difficulty
    due_naive = (
        card.due.astimezone(UTC).replace(tzinfo=None) if card.due.tzinfo else card.due
    )
    last_naive = None
    if card.last_review is not None:
        last_naive = (
            card.last_review.astimezone(UTC).replace(tzinfo=None)
            if card.last_review.tzinfo
            else card.last_review
        )
    row.due_at = due_naive
    row.next_due_at = due_naive
    row.next_due_date = due_naive.date() if due_naive else None
    row.last_review_at = last_naive
    row.last_reviewed_at = last_naive or now
    row.desired_retention = float(settings["desired_retention"])
    row.maximum_interval = int(settings["maximum_interval"])
    row.scheduler_version = "fsrs-6.3.1"
    row.algorithm_used = "FSRS"
    row.review_type = "fsrs"
    if last_naive and due_naive:
        row.interval_days = max(0, (due_naive.date() - last_naive.date()).days)
    row.review_number = int(row.review_number or 0) + 1


def card_from_row(row: EnglishPatternSentence) -> Card:
    due = row.due_at or row.next_due_at or utc_now_naive()
    if due.tzinfo is None:
        due_aware = due.replace(tzinfo=UTC)
    else:
        due_aware = due.astimezone(UTC)
    last = row.last_review_at or row.last_reviewed_at
    last_aware = None
    if last is not None:
        last_aware = last.replace(tzinfo=UTC) if last.tzinfo is None else last.astimezone(UTC)
    return Card(
        card_id=int(row.id or 0),
        state=State(int(row.fsrs_state or 1)),
        step=row.fsrs_step,
        stability=row.stability,
        difficulty=row.difficulty,
        due=due_aware,
        last_review=last_aware,
    )


def sentence_due_filter(now: datetime):
    return or_(
        EnglishPatternSentence.due_at <= now,
        (
            EnglishPatternSentence.due_at.is_(None)
            & (EnglishPatternSentence.next_due_at <= now)
        ),
        (
            EnglishPatternSentence.due_at.is_(None)
            & EnglishPatternSentence.next_due_at.is_(None)
            & (EnglishPatternSentence.next_due_date <= now.date())
        ),
    )


def is_sentence_due(row: EnglishPatternSentence, now: datetime) -> bool:
    if row.status != "active":
        return False
    if not str(row.text_en or "").strip():
        return False
    if row.due_at is not None:
        return row.due_at <= now
    if row.next_due_at is not None:
        return row.next_due_at <= now
    if row.next_due_date is not None:
        return row.next_due_date <= now.date()
    return True
