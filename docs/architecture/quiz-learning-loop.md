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

## Dependency direction

```text
freestyle presentation -> palace_quiz HTTP API
palace_quiz presentation -> palace_quiz.application.learning_loop
palace_quiz.application.learning_loop -> ORM tables + serialization
```

Entity-scoped asynchronous generation must carry stable owner and operation identity before candidate persistence or UI replacement.
