# Module: quiz

## Status
active — owns the current question and quiz-learning contracts.

## Owns
Questions, bindings, generation workspace, wrong-question sets

## Migrates from
- palace_quiz

## Forbids
No formal review session lifecycle

## Public surface
- `public/commands.py` — write intents
- `public/queries.py` — read contracts

## Choice question contract
- 单选题：`answer_payload.correct_option_id`；作答提交 `selected_option_id`。
- 多选题：`answer_payload.correct_option_ids`（≥2 个，按选项顺序）；作答提交 `selected_option_ids`，按集合完全一致判对。
- 前端 `QuizQuestionInteraction` 检测到 `correct_option_ids` 时渲染多选切换 + 提交按钮，提交前 `isQuizChoiceAttemptClosed` 保持未关闭。

## Cross-module rule
Import only `memory_anki.modules.quiz.public`. Never import another module's application/infrastructure/presentation.
