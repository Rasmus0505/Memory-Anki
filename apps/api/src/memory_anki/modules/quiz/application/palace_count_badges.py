"""Palace-wide question corner badges for bookshelf cards.

Same split as a mind-map node badge: objective is every type except
``short_answer``, subjective is ``short_answer``, and a side turns rose when
it contains a marked question. Counts are distinct non-deleted questions
whose binding target is the palace (the root-node total when every edge
still points at a live node). A side with zero questions is omitted.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import (
    PalaceQuizQuestion,
    PalaceQuizQuestionNodeBinding,
)

BadgeKind = str


def _badge(kind: BadgeKind, count: int, has_marked: bool) -> dict[str, str] | None:
    if count <= 0:
        return None
    label = "客观" if kind == "objective" else "主观"
    return {
        "text": str(count),
        "tone": "rose" if has_marked else ("success" if kind == "objective" else "info"),
        "title": f"{label} {count} 道，含标记题" if has_marked else f"{label} {count} 道",
        "kind": kind,
    }


def project_palace_quiz_count_badges(
    session: Session,
    palace_ids: list[int],
) -> dict[int, list[dict[str, str]]]:
    """Return ``palace_id -> [subjective?, objective?]`` corner badges."""
    if not palace_ids:
        return {}
    rows = (
        session.query(
            PalaceQuizQuestionNodeBinding.palace_id,
            PalaceQuizQuestion.id,
            PalaceQuizQuestion.question_type,
            PalaceQuizQuestion.marked,
        )
        .join(
            PalaceQuizQuestion,
            PalaceQuizQuestion.id == PalaceQuizQuestionNodeBinding.question_id,
        )
        .filter(
            PalaceQuizQuestionNodeBinding.palace_id.in_(palace_ids),
            PalaceQuizQuestion.deleted_at.is_(None),
        )
        .all()
    )
    seen: set[tuple[int, int]] = set()
    objective_count: dict[int, int] = {}
    subjective_count: dict[int, int] = {}
    objective_marked: dict[int, bool] = {}
    subjective_marked: dict[int, bool] = {}
    for palace_id, question_id, question_type, marked in rows:
        if palace_id is None or question_id is None:
            continue
        key = (int(palace_id), int(question_id))
        if key in seen:
            continue
        seen.add(key)
        subjective = str(question_type or "").strip() == "short_answer"
        target = subjective_count if subjective else objective_count
        marked_target = subjective_marked if subjective else objective_marked
        target[key[0]] = target.get(key[0], 0) + 1
        if marked:
            marked_target[key[0]] = True

    result: dict[int, list[dict[str, str]]] = {}
    for palace_id in set(objective_count) | set(subjective_count):
        badges = [
            _badge("subjective", subjective_count.get(palace_id, 0), subjective_marked.get(palace_id, False)),
            _badge("objective", objective_count.get(palace_id, 0), objective_marked.get(palace_id, False)),
        ]
        present = [badge for badge in badges if badge is not None]
        if present:
            result[palace_id] = present
    return result
