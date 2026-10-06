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

## Learning progress (`/progress`)

The independent sidebar destination is owned by `modules/dashboard`: its page composes the module public `LearningProgressPage`; the API adapter and query hook live in `api` and `application`, pure filtering/indexing lives in `domain`, and presentation lives in `ui/progress`. Navigation/history metadata has a distinct `progress` key. Scope, selected identity, view, search, filter, and sort live in the URL, so switching views does not discard the current range and returning from a palace restores context. Expansion is local to the mounted page. Views are hierarchy, leaf distribution, and question coverage; no historical trend or mastery score is synthesized.

`GET /api/v1/dashboard/learning-progress` is a read-only snapshot composed through content, memory, and quiz public capabilities (the dashboard → quiz edge is registered in the context map). It must not repair documents, create schedules, flush, commit, or mutate practice state. Snapshot queries are batched, not one HTTP request per palace. The frontend validates the snapshot at its API boundary; a failed refresh retains the previous snapshot with a visible stale-data notice.

- Memory totals count current non-root **leaf nodes**; document branch headings remain navigation groups, not additional memory points. Empty palaces count zero. Actual document hierarchy is retained, without forcing missing chapter/unit levels.
- Reviewed coverage is effective rating evidence of current review units intersected with current leaf identities. This is unit-derived coverage, not proof that each leaf is mastered.
- Due coverage is an independent scheduling signal and is not added to reviewed coverage. Matrix amber takes display precedence; it does not mean forgotten.
- Question totals and answered counts are distinct question identities at every aggregate level. Any persisted answer record counts: question attempt counters, quiz attempt events, freestyle attempt rows, or a saved current answer. Incorrect answers count. Repeating a question does not inflate coverage, and clearing the current practice round does not erase historical answer coverage.
- Search and state filters affect visible rows only, not the range denominator. Hierarchy and comparison render 30 entries per page, matrix 96, preventing an expanded document from creating unbounded DOM.
- Palace review/quiz actions explicitly open the whole owning palace, never claim an unsupported leaf-scoped training session. No data is edited by the progress page.

The scoped generated OpenAPI types live in `shared/api/generated/learningProgress.ts`; a compile-time equality test reconciles the stable `contracts/learningProgress.ts` response with the generated backend schema. The complete application OpenAPI is not imported into runtime frontend code.

Regression coverage includes API purity/aggregation tests, pure projection and contract decoder unit tests, route/history checks, and hermetic Playwright desktop/mobile tests with isolated sample data. Progress screenshots from those tests are fixture illustrations, not the user's learning records.
