# Review Context Boundary

The review context owns scheduling, queue selection, progress, and review submission. Palace owns palace editing and palace-specific read projections.

## Dependency Direction

```text
reviews.application -> mindmap_document.api
reviews.presentation -> palaces.api (response composition only)
palaces application/presentation -> reviews.api
```

`reviews.application` must not import the palace context. Generic mind-map traversal belongs to the pure `mindmap_document` context. Palace response composition remains in presentation and crosses the context through `palaces.api`.

## Read Invariants

- Review queue and count queries never commit or repair palace state.
- Archived and soft-deleted palaces are excluded explicitly.
- Compatibility repair such as legacy unarchive operations must run as an explicit maintenance command, never inside GET/query paths.

The remaining `palaces -> reviews` dependency is explicit and restricted to the public `reviews.api` facade. Future slices may replace read-heavy calls with precomputed projections, but private review application modules are not cross-context APIs.

## Review repair transaction ownership

Schedule rebuild primitives never commit. The explicit Review repair command owns one `UnitOfWork` covering schedule replacement, orphan progress migration, practice recovery, and study-session synchronization. Settings uses the public `reviews.api` facade and commits schedule-impacting setting changes together with the rebuilt pending schedules. The unused Palace `segment_progress_service` compatibility transaction entry was removed.

## Review mutation commands

Idempotent review submission and overdue spreading are composed in `review_commands.py`. Domain/application primitives flush with `commit=False`; the command stores the platform mutation response and commits once through `UnitOfWork`. Reviews no longer depends on the transitional Persistence context.

Formal review completion uses one stable mutation identity across retries. The command atomically creates the review log and completed study session, rebuilds stage schedules, clears recoverable progress, and stores a completion receipt. The receipt is readable by review-log id so a refreshed PWA or desktop result page never depends on the deleted pre-rebuild schedule id.

Frontend review completion emits the typed `reviewStateChanged` application event only after the atomic command succeeds. Review queue and Palace catalog caches invalidate immediately; Knowledge may consume the returned projection and refetch its chapter detail without importing private Review implementation modules.

## Frontend review-flow composition

`widgets/mindmap-review-flow` owns the cross-feature flip-card session surface that combines Review use cases, Palace learning, quiz launching, and mind-map editing. Its public `FlipCardMindMapPanel` is the only host allowed to configure flip-card synchronization, viewport preservation, keyboard/touch progression, fullscreen, and clear-UI behavior. Palace learning and formal Review provide separate progress data and callbacks; formal Review alone adds rating evidence and review completion. `features/review` does not import Palace or Mind-map Editor; reusable state transforms remain under `entities/review`.
## Manual stage correction

Manual palace stage adjustment is a Review-owned scheduling correction, even when the action starts from the Palace catalog UI. Preview requests may simulate schedule rebuilding but must roll back all database changes. Apply requests rebuild palace-level schedules through the Review use case, use mutation identity and one `UnitOfWork`, reject stale `expected_completed_count` values, and store a separate adjustment audit record. They must not create `ReviewLog` or `StudySession` rows and must not alter learning-group progress.
