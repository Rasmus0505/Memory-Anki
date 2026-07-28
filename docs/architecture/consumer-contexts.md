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

### Immersive feed queue

`POST /api/v1/freestyle/queue/build` composes a finite immersive queue:

- **Palaces facade**: stable tree structure used only to render the complete palace and resolve context paths (`list_active_palace_tree_structures`).
- **Reviews facade**: active permanent-mark units, stable membership, revision, stage, and due date (`get_palace_unit_projection`). Reviews owns all palace scheduling writes (rating, manual schedule adjust, undo content-demote batch, reconcile). UI may show a unit projection panel over this read model for schedule observability; it must not invent a second schedule store.
- **Palace Quiz facade**: published questions, node bindings, mastery profiles (`list_published_questions_for_palaces`, `list_node_bindings_for_palaces`, `list_mastery_profiles_for_palaces` / `build_mastery_profile`).

Practice does not split palace documents. It maps each Reviews projection to one revisioned queue card and uses the member UIDs only for highlighting and quiz binding. Queue requests carry `operation_id`; clients ignore stale responses. Stale encounter / revision after concurrent document or schedule writes is treated as rebuildable queue state, not a hard feed failure. A due unit always keeps its palace review card even when standalone Anki cards are generated from nodes inside that unit. Anki and quiz cards never carry review-unit rating identity.

Frontend ownership:

- Domain/config/skip/refresh: `apps/web/src/modules/practice` via `public.ts`
- Immersive page/widgets: `features/freestyle` + thin `pages/today/ImmersiveFreestylePage`
- Primary nav first item is **随心** (`/freestyle`); legacy `/freestyle/session` redirects there
- Mind-map cards reuse `widgets/mindmap-review-flow`; quiz cards keep unified attempt evidence and do not map to palace unit scheduling

## Study Sessions

Cross-context session reads, review-session creation, and resumable progress operations are exported only through `sessions.api`. Reviews, Palaces, English, and English Reading must not import `sessions.application` modules directly. Sessions presentation remains free to compose its own application services internally.

## Settings Metrics

Settings metrics consume backup catalog data through `backups.api`. This keeps Settings eligible for eventual platform ownership and prevents operational dashboards from binding to backup lifecycle implementation modules.

## Independent English FSRS

English owns the shared FSRS runtime behind `english.api`. English Reading vocabulary consumes that narrow public capability; both tracks remain independent FSRS cards. They do not share palace review-unit state and must not call palace unit rating commands.
