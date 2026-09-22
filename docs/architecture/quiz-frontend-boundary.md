# Quiz Frontend Boundary

Quiz question contracts, API wrappers, runtime state, reusable answer interaction UI, attempt orchestration, and result feedback belong to `modules/quiz`. These capabilities are shared by Palace Quiz, Freestyle, and Review flows and must not live inside a page-oriented route.

```text
pages/palace-quiz -> modules/quiz/public.ts
modules/practice/ui/freestyle -> modules/quiz/public.ts
modules/practice/ui/review -> modules/quiz/public.ts
```

The Palace memory lookup dialog composes Palace data, review feedback, and the mind-map editor, so it belongs to `widgets/palace-memory-lookup`. Palace Quiz and Freestyle consume the widget without importing one another. When a caller passes the current question’s bound node uids (`focusNodeUid` / `focusNodeUids` from `collectMemoryLookupFocusNodeUids`), the dialog keeps the full palace `editor_doc` and visually centers the deepest bound node via `focusRequestNodeUid` (`resolveMemoryLookupFocusNodeUid`). A default palace-root binding must not win over a deeper bound card. It must not re-root or clip the tree to the bound node. Node-bound question badges use `widgets/node-bound-quiz`. Freestyle toolbar 做题 uses `widgets/freestyle-scope-quiz`: same answering chrome, question list from the saved feed palace range plus `overlay_question_range` (`due` / `all`). Durable overlay membership and answered drafts live on round-plan `overlay_quiz` and survive PWA reload. The SPA `quizSessionProgress` mirror is shared across node-bound badges, the overlay, and Palace Quiz practice for the SPA lifetime only; toolbar 做题 re-seeds it from `overlay_quiz` after reload. 「再来一轮」 clears both. When a palace’s review units in the round are all scored, the UI asks before dropping that palace’s overlay 已做. All three surfaces show 标记 / 取消标记. Marking writes `marked` and does not schedule review or auto-advance. Marked question numbers on the index rail use a rose fill. It must not switch `training_mode` or open `QuizLauncher`. New cross-scene quiz primitives should be added to the Quiz entity; new multi-feature visual composition should be added to a widget or page.

Multiple-choice active-recall rewriting (选择 / 主观) lives in the Quiz entity: `quizAnswerMode`, `mcqSubjectiveRewrite`, `QuizQuestionStem`, `QuizQuestionInteraction`, and the `quiz_answer_mode` client preference. Switching to 主观 rewrites the stem so it does not depend on options and stays at equal or higher recall difficulty (not a shorter recognition prompt). After a converted multiple-choice submit, the entity lists the original options without marking the correct choice, and writes the reference answer as the first line of the analysis. Enter submits the short-answer attempt; the interaction surface restores keyboard focus when the question or mode changes so hosts do not leave submit shortcuts stuck on 下一题. Freestyle cards, node-bound quiz dialogs, and Palace Quiz practice consume that primitive; they must not reimplement the toggle, stem rewrite, short-answer presentation, or submit shortcuts.

Do-question overlays (`widgets/freestyle-scope-quiz`, `widgets/node-bound-quiz`) paginate the top question-number rail through `QuizQuestionIndexPager` (20 per page). Hosts must not render the full round-button grid inline.

## Application Quiz Launcher

The global quiz launcher is mounted by `AppProviders` and coordinates Palace metadata, AI configuration, background generation tasks, navigation, and Palace Quiz generation. It belongs to `widgets/quiz-launcher`, while question generation and interaction stay in `modules/quiz`. Palace View, Palace Edit, and Review flows consume the widget context without importing quiz internals.

Review feedback reward state and reusable feedback orchestration live in `modules/memory/domain/review-entity`, because Palace practice, Review flows, and lookup widgets share them. Route code must not recreate these models under a page.
