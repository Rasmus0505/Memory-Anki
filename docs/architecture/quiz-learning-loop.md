# Quiz Learning Loop

Palace Quiz owns the complete question lifecycle from generated candidate to published training item. Freestyle consumes only published questions and records unified attempt events through the Palace Quiz boundary.

## Lifecycle

- `temporary`: generated for an active coaching gap and not trusted as formal content.
- `candidate`: generated or promoted temporary content awaiting human review.
- `published`: passed deterministic checks and explicit human publication; eligible for training.
- `rejected`: retained for audit but excluded from training.

Existing questions migrate to `published`. New AI-generated questions persist as `candidate`; manual questions remain `published` for backward compatibility.

## Evidence and quality

Published questions require structured evidence with source names and page, paragraph, or mind-map node locations. The deterministic quality gate checks evidence, answer structure, explanation completeness, and multiple-choice consistency. AI reviewer output may enrich this contract later, but presentation cannot bypass the gate.

## Attempt events and mastery

`QuizAttemptEvent` is the cross-scene source of truth for new analytics. Legacy counters and Freestyle history remain compatibility projections. Events capture question/version identity, scene, answer, correctness, duration, hints, retries, confidence, and optional AI score.

The first mastery projection combines recent correctness, hint/retry penalties, confidence, and recency. LLM calls may assess open answers or generate follow-ups, but do not own scheduling or persisted mastery scores.

Quiz practice no longer writes a 4-level rating or a review schedule. `marked` is a learner flag only: it does not change `schedule_stage`, `schedule_due_on`, `schedule_passed`, attempt counters, or palace review units. Historical due dates remain so the freestyle overlay `due` range can still read them, and they are not updated by marking. A last stored 忘记 or 困难 rating (unpassed, with a due date) migrates to `marked`; 记得/轻松 and never-rated questions stay unmarked. Only that latest schedule was stored.

## Dependency direction

```text
freestyle presentation -> palace_quiz HTTP API
palace_quiz presentation -> palace_quiz.application.learning_loop
palace_quiz.application.learning_loop -> ORM tables + serialization
```

Entity-scoped asynchronous generation must carry stable owner and operation identity before candidate persistence or UI replacement.
