"""Ever-answered question coverage, independent of current round completion."""
from typing import Any

from sqlalchemy.orm import Session

from memory_anki.infrastructure.db._tables.palaces import (
    FreestyleQuizAttempt,
    PalaceQuizQuestion,
    QuizAttemptEvent,
)

from .freestyle_projection import list_node_bindings_for_palaces
from .practice_progress import read_practice_progress


def _submitted_answer(state: dict[str, Any]) -> bool:
    """A saved answer counts; merely opening a question does not."""
    if state.get("resolved") or state.get("rating") or state.get("shortAnswerSubmitted"):
        return True
    if str(state.get("selectedOptionId") or "").strip() or isinstance(state.get("trueFalseAnswer"), bool):
        return True
    blanks = state.get("blankInputs")
    if isinstance(blanks, dict) and any(str(value or "").strip() for value in blanks.values()):
        return True
    pairs = state.get("matchingPairs")
    assignments = state.get("categorizationAssignments")
    return bool(state.get("submittedBlankIds") or state.get("orderingIds")
                or (isinstance(pairs, dict) and pairs)
                or (isinstance(assignments, dict) and assignments))


def read_learning_progress_quiz(session: Session) -> dict[str, Any]:
    with session.no_autoflush:
        questions = session.query(
            PalaceQuizQuestion.id, PalaceQuizQuestion.palace_id, PalaceQuizQuestion.attempt_count,
        ).filter(PalaceQuizQuestion.deleted_at.is_(None)).all()
        bindings = list_node_bindings_for_palaces(session)
        progress = read_practice_progress(session)
        event_ids = {
            question_id for (question_id,) in session.query(QuizAttemptEvent.question_id).filter(
                QuizAttemptEvent.question_id.isnot(None),
            ).distinct().all()
        }
        freestyle_ids = {
            question_id for (question_id,) in session.query(FreestyleQuizAttempt.question_id).filter(
                FreestyleQuizAttempt.question_id.isnot(None),
            ).distinct().all()
        }
    active = {question_id for question_id, _palace_id, _attempts in questions}
    answered = {question_id for question_id, _palace_id, attempts in questions if attempts > 0}
    answered.update(event_ids)
    answered.update(freestyle_ids)
    answered.update(
        item["question_id"] for item in progress["items"]
        if isinstance(item["state"], dict) and _submitted_answer(item["state"])
    )
    return {
        "questions": [{"id": question_id, "palace_id": palace_id} for question_id, palace_id, _attempts in questions],
        "bindings": bindings,
        "answered": answered & active,
    }
