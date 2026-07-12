# Quiz Frontend Boundary

Quiz question contracts, API wrappers, runtime state, reusable answer interaction UI, attempt orchestration, and result feedback belong to `entities/quiz`. These capabilities are shared by Palace Quiz, Freestyle, and Review flows and must not live inside a page-oriented feature.

```text
features/palace-quiz -> entities/quiz
features/freestyle -> entities/quiz
features/review -> entities/quiz
```

The Palace memory lookup dialog composes Palace data, review feedback, and the mind-map editor, so it belongs to `widgets/palace-memory-lookup`. Palace Quiz and Freestyle consume the widget without importing one another. New cross-scene quiz primitives should be added to the Quiz entity; new multi-feature visual composition should be added to a widget or page.

## Application Quiz Launcher

The global quiz launcher is mounted by `AppProviders` and coordinates Palace metadata, AI configuration, background generation tasks, navigation, and Palace Quiz generation. It belongs to `widgets/quiz-launcher`, not `features/palace-quiz`. Palace View, Palace Edit, and Review flows consume the widget context without importing the Palace Quiz feature.

Review feedback reward state and reusable feedback orchestration live in `entities/review/model`, because Palace practice, Review flows, and lookup widgets share them. Feature code must not recreate these models under `features/review`.
