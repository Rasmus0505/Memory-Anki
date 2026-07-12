from __future__ import annotations

from memory_anki.modules.learning_record.public import LearningEvent
from memory_anki.shared_kernel.operations import (
    OperationIdentity,
    OperationRun,
    OperationStatus,
)


def test_operation_run_rejects_stale_owner_revision() -> None:
    current = OperationIdentity("operation-1", "palace", "42", 3)
    stale = OperationIdentity("operation-1", "palace", "42", 2)
    run = OperationRun("run-1", "quiz-generation", current, OperationStatus.RUNNING, {})

    assert run.accepts(current)
    assert not run.accepts(stale)


def test_completed_operation_cannot_accept_late_callback() -> None:
    identity = OperationIdentity("operation-1", "palace", "42", 3)
    run = OperationRun("run-1", "quiz-generation", identity, OperationStatus.SUCCEEDED, {})

    assert not run.accepts(identity)


def test_learning_event_is_append_only_fact() -> None:
    event = LearningEvent(
        event_id="event-1",
        session_id="session-1",
        activity_type="quiz",
        subject_reference="question:1",
        stimulus_reference=None,
        response={"answer": "A"},
        outcome={"correct": True},
        duration_ms=1200,
    )

    assert event.event_name == "learning_record.learning_event_recorded"
