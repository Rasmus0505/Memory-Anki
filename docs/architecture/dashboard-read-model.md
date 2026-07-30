# Dashboard Read Model

Dashboard is a composition context. It does not own palace, review, or study-session behavior and must not import those contexts' internal application modules.

## Dependency Direction

```text
dashboard.application -> palaces.api
dashboard.application -> reviews.api
dashboard.application -> sessions.public.queries
```

The public facades expose stable read capabilities while their owner contexts retain implementation freedom. New dashboard metrics should first be implemented by the owning context and exported intentionally through its facade.

Time-record duration belongs to the Session read model. The Dashboard endpoint only requests fixed dashboard metrics through `memory_anki.modules.session.public.queries`; it neither imports `StudySession` nor accepts range, month, or custom-date parameters for a second duration projection. The Insights screen obtains its selected total, client breakdown, category breakdown, trend, and paginated rows from the single `GET /api/v1/study-sessions/time-records` response. Its persisted filter is the sole source of range, keyword, category, sort, and page-size state.

Dashboard currently still assembles a local SQL read projection over the shared legacy schema. A later migration may move those ORM-heavy projections behind owner-provided query ports, but no new private application dependency is allowed.
