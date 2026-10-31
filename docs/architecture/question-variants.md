# Question Variants and Muscle-Memory Marking

Question practice can become a recognition reflex: the learner remembers the
first half of the stem or the position of the correct option, not the concept.
This workflow marks such questions, sends the currently displayed content plus
its bound mind-map context to an external AI, and stores the returned rewrite as
a selectable variant of the same question id.

## Core invariant: the question row is the original

`palace_quiz_questions.stem`, `options_json`, `answer_payload_json` and
`analysis` always hold the original question. A variant never overwrites the
row. `active_variant_id` selects what practice displays:

- `original` — the row content.
- `v1`, `v2`, … — a record in `variant_history_json`.

`variant_history_json` is a JSON array of
`{version_id, created_at, question_type, stem, options, answer_payload,
analysis, base_version_id, source}`. The original is therefore always
recoverable by setting `active_variant_id` back to `original`; there is no
second snapshot that could drift.

`serialize_question_content` applies the active variant to the read shape.
When a variant is active it also returns `original_content`, so the management
editor can keep editing the original row instead of saving the variant content
back over it.

## Mark and auto-mark

`needs_mutation` is the learner's 待换题 flag. It is independent of `marked`
(the rose question-number bookmark) and does not schedule review.

Every canonical answer updates `mutation_attempt_count`,
`consecutive_correct_count` and `last_answer_duration_ms`. The auto-mark rule
reads three runtime settings:

| Key | Default |
|---|---|
| `quiz_mutation_min_attempts` | `3` |
| `quiz_mutation_min_consecutive_correct` | `3` |
| `quiz_mutation_max_duration_ms` | `5000` |

It marks the question when the answer is correct, the duration is below the
threshold, the attempt and consecutive-correct counters meet their thresholds,
and the question is not already marked. The settings are stored in the shared
`config` table and exposed beside the review settings.

Canonical-answer ownership matters because Freestyle records both a choice
attempt (`/choice-attempts`) and a history attempt
(`/freestyle/question-attempts`). The choice attempt therefore sends
`update_mutation_stats: false`, and the history record owns the counters. The
Freestyle orchestration also skips applying the choice response's question, so
a response that is one transaction behind cannot overwrite the history update
in the feed.

## API

| Method / path | Purpose |
|---|---|
| `POST /palace-quiz-questions/{id}/mutation-mark` | Toggle `needs_mutation`. |
| `GET /palace-quiz-questions/{id}/versions` | Original + stored variants + counters. |
| `POST /palace-quiz-questions/{id}/active-variant` | Switch `original` / `v1` / …; resets the current check. |
| `DELETE /palace-quiz-questions/{id}/variants/{version_id}` | Delete a variant; the original cannot be deleted. |
| `POST /palace-quiz-question-variants/import` | `{items, dry_run}` batch import; per-item validation, bad items skipped. |
| `POST /palace-quiz-mutation-prompt` | Build the copy-ready prompt for the marked questions in scope. |

`record_choice_attempt` grades against the effective (active variant) answer,
not the original row. Attempt events additionally store
`question_version_id`.

Import validates `question_type` against the original, preserves the original
single/multi-choice answer mode, normalizes the `【AI变体】` source tag without
duplicating it, and rejects an item whose `base_version_id` no longer matches
the question's active version. A successful import appends the variant,
activates it, clears `needs_mutation`, and resets the consecutive-correct and
duration counters so the new variant is checked from zero.

## UI surfaces

`QuizQuestionVariantControl` is the shared per-question control: the original /
variant badge, 标记换题 / 待换题, 恢复真题 and 历史版本. It is mounted in:

- Freestyle quiz cards.
- The Freestyle 做题 overlay (`FreestyleScopeQuizDialog`).
- The node-bound question dialog (`NodeBoundQuizDialog`).
- Palace Quiz practice cards and the palace question management list.

`QuizMutationBatchBar` adds 一键复制待换题 + Prompt and 导入 AI 替换题 JSON to the
two overlay headers and the palace question management header. The prompt
endpoint filters the supplied ids to `needs_mutation = true`, so the count in
the button and the prompt body agree.

Switching or restoring a version resets the local answer state for that
question, because the stem, options and answer have changed. Importing does the
same for every imported question.

## Node context

The prompt includes, for each binding, the palace title, ancestor path, node
text, note and up to eight child texts. `build_document_tree` exposes those
fields; the project reads the same `palaces.editor_doc` that the mind-map
editor uses. If a binding is a historical mismatch, the prompt's错绑节点豁免
rule tells the model to ignore it and use the original question and analysis.

## Related code

- `modules/quiz/application/question_variants.py` — normalization, effective
  content, variant serialization.
- `modules/quiz/application/question_variant_commands.py` — mark, activate,
  delete, import.
- `modules/quiz/application/question_variant_prompt.py` — prompt builder.
- `modules/quiz/application/auto_mark.py` — canonical attempt counters and
  auto-mark rule.
- `modules/settings/infrastructure/quiz_mutation_settings.py` — threshold read.
- `apps/web/src/modules/quiz/domain/quiz-entity/ui/QuizQuestionVariantControl.tsx`,
  `QuizQuestionVersionSheet.tsx`, `QuizMutationBatchBar.tsx` — shared UI.
