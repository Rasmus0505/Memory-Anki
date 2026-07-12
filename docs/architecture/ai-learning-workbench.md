# AI Learning Workbench Boundary

The AI learning context owns persisted study conversations, immutable context snapshots, run identity, feedback, and generic preview serialization. It does not own palace editing, quiz publishing, model administration, or prompt administration.

## Dependency Direction

```text
review presentation -> entities/ai-learning -> /ai-learning API
ai_learning application -> platform.application.AiRuntimeProvider
ai_learning presentation -> settings.api.SettingsAiRuntimeProvider
business result actions -> owning public facade (palaces or palace_quiz)
```

## Invariants

1. Every run carries stable `owner_id` and unique `operation_id`; retries and follow-ups create new records instead of overwriting history.
2. Context snapshots include source entity, source revision, ordered stable node UIDs, selected scope, and a non-secret model snapshot.
3. Preview and execution use the same server serializer. Context-budget warnings are explicit; no silent truncation is allowed.
4. API keys and provider credentials are never persisted or returned.
5. AI output never directly edits a palace or publishes quiz questions. Domain-owned confirmation commands remain required.
6. Review defaults to the active subtree and falls back to the current review node set, never automatically to the full mind map.
7. Native fullscreen renders the workbench inside the active fullscreen element; editable controls suppress review keyboard shortcuts through the existing keyboard-target guard.

## Frontend Ownership

- `entities/ai-runtime` owns reusable model, thinking, and per-run prompt configuration.
- `entities/ai-learning` owns context/run contracts, API access, and pure context selection.
- `widgets/mindmap-review-flow` composes the review-specific workbench and task actions.
- New AI entrypoints must reuse these public entities rather than recreate model selectors or request preview logic.
