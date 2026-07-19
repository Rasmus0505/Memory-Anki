# Consumer Context Boundaries

Search and Freestyle are read-oriented consumer contexts. They compose capabilities owned elsewhere but do not depend on another context's internal application modules.

## Search

```text
search.application -> palaces.api
```

Search owns query matching and result shaping. Palace owns title resolution.

## Freestyle

```text
freestyle.application -> english.api
freestyle.application -> english_reading.api
freestyle.application -> palace_quiz.api
freestyle.application -> palaces.api
freestyle.application -> reviews.api
```

Each facade is intentionally narrow: recent English course continuation, recent reading materials, quiz question serialization, Palace context projections, and due-review policy. New Freestyle card types must request an explicit public capability from the owner context instead of importing its service implementation.

## Study Sessions

Cross-context session reads, review-session creation, and resumable progress operations are exported only through `sessions.api`. Reviews, Palaces, English, and English Reading must not import `sessions.application` modules directly. Sessions presentation remains free to compose its own application services internally.

## Settings Metrics

Settings metrics consume backup catalog data through `backups.api`. This keeps Settings eligible for eventual platform ownership and prevents operational dashboards from binding to backup lifecycle implementation modules.

## English Reading Vocabulary

Vocabulary scheduling consumes reusable review policy and schedule-draft capabilities through `reviews.api`. English Reading owns vocabulary notes; Reviews owns the scheduling policy. The vocabulary service must not import `reviews.application.schedule_policy` directly.

## English Topic Patterns (句模)

Pattern sentence FSRS scheduling also consumes reusable scheduler helpers through `reviews.api` (`build_scheduler`, `load_fsrs_settings`, `normalize_rating`). English owns topic patterns, prompts, and viewpoint sentences; Reviews owns the scheduling policy only. Pattern services must not import `reviews.application` internals.
