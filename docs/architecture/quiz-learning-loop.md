# Quiz Learning Loop

Every non-deleted question is practiceable. Freestyle and palace quiz do not gate membership on `lifecycle_status`. Soft-deleted questions stay hidden. The stored column may still say `published`, `candidate`, `temporary`, or `rejected`; those values are not a practice door and are not rewritten in bulk.

## Lifecycle

Question publish state is gone. There is no review queue, no 审核发布 action, and no transition that makes a question eligible. `POST /palace-quiz-questions/{id}/lifecycle` returns HTTP 410 with detail `题目不再区分发布状态。` `GET /palace-quiz-questions/review-queue` returns an empty list. The quality review endpoint may still describe evidence gaps, but it does not decide whether a question can be practiced.

## Evidence and quality

Structured evidence can still be stored with a question. It is not required before practice.

## Attempt events and marks

`QuizAttemptEvent` is the cross-scene source of truth for new analytics. Legacy counters and Freestyle history remain compatibility projections. Events capture question/version identity, scene, answer, correctness, duration, hints, retries, confidence, and optional AI score.

Question mastery is not a practice filter. Answering still shows right or wrong and the stored analysis. The learner flags on a question are `marked` (the rose bookmark) and `needs_mutation` (待换题). Neither changes `schedule_stage`, `schedule_due_on`, `schedule_passed`, or palace review units. Palace memory-card ratings (忘记 / 困难 / 记得 / 轻松) and today's mind-map due queue stay.

## AI variants and 待换题

A question row always keeps the original content. External-AI rewrites live in
`variant_history_json`, and `active_variant_id` selects the displayed version;
switching back to `original` needs no snapshot. Practice grades against the
active variant. `needs_mutation` can be toggled manually or set by the
configurable muscle-memory rule (default 3 attempts / 3 consecutive correct /
under 5 seconds). See `question-variants.md` for the data shape, APIs and the
Freestyle attempt-ownership rule.

AI 出题、讲解、纠错和自由提问已禁用. Those HTTP entry points return 403 before any model call. Stored questions are kept. English TTS, voice coach, and palace-card review are unchanged.

## Dependency direction

```text
freestyle presentation -> palace_quiz HTTP API
palace_quiz presentation -> palace_quiz.application.learning_loop
palace_quiz.application.learning_loop -> ORM tables + serialization
```

Entity-scoped asynchronous generation must carry stable owner and operation identity before candidate persistence or UI replacement.
