# Quiz Learning Loop

Every non-deleted question is practiceable. Freestyle and palace quiz do not gate membership on `lifecycle_status`. Soft-deleted questions stay hidden. The stored column may still say `published`, `candidate`, `temporary`, or `rejected`; those values are not a practice door and are not rewritten in bulk.

## Lifecycle

Question publish state is gone. There is no review queue, no 审核发布 action, and no transition that makes a question eligible. `POST /palace-quiz-questions/{id}/lifecycle` returns HTTP 410 with detail `题目不再区分发布状态。` `GET /palace-quiz-questions/review-queue` returns an empty list. The quality review endpoint may still describe evidence gaps, but it does not decide whether a question can be practiced.

## Evidence and quality

Structured evidence can still be stored with a question. It is not required before practice.

## Attempt events and marks

`QuizAttemptEvent` is the cross-scene source of truth for new analytics. Legacy counters and Freestyle history remain compatibility projections. Events capture question/version identity, scene, answer, correctness, duration, hints, retries, confidence, and optional AI score.

Question mastery is not a practice filter. Answering still shows right or wrong and the stored analysis. The only learner flag on a question is `marked` versus unmarked. `marked` does not change `schedule_stage`, `schedule_due_on`, `schedule_passed`, attempt counters, or palace review units. Palace memory-card ratings (忘记 / 困难 / 记得 / 轻松) and today's mind-map due queue stay.

AI 出题、讲解、纠错和自由提问已禁用. Those HTTP entry points return 403 before any model call. Stored questions are kept. English TTS, voice coach, and palace-card review are unchanged.

## Dependency direction

```text
freestyle presentation -> palace_quiz HTTP API
palace_quiz presentation -> palace_quiz.application.learning_loop
palace_quiz.application.learning_loop -> ORM tables + serialization
```

Entity-scoped asynchronous generation must carry stable owner and operation identity before candidate persistence or UI replacement.
