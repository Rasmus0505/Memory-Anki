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

## Frontend review-flow composition

`widgets/mindmap-review-flow` owns the cross-feature session surface that combines Review use cases, Mini Palace training, quiz launching, and mind-map editing. `features/review` no longer imports Mini Palace or Mind-map Editor; reusable state transforms remain under `entities/review`.
