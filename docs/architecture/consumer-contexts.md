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

- **Palaces facade**: stable tree structure, first-level branch units, node counts (`list_active_palace_tree_structures`, `stable_tree_order`, `subtree_node_uids`).
- **Reviews facade**: node due sets and memory projections (`list_due_nodes`, `get_palace_memory_projection`); FSRS writes remain owned by Reviews.
- **Palace Quiz facade**: published questions, node bindings, mastery profiles (`list_published_questions_for_palaces`, `list_node_bindings_for_palaces`, `list_mastery_profiles_for_palaces` / `build_mastery_profile`).

Branch units are complete single-rooted subtrees. Split from root children using a best-fit rule against `node_limit`: keep a parent when its size is closer to the limit than its children; recurse when any child is still over limit or a child is a better fit. When a parent is drilled into, it is folded into the first descendant unit's ratable set (never a size-1 residual card) so every non-root node remains in exactly one unit's ratable set. Wide flat branches (leaf-only children) stay as complete over-limit units — never truncate siblings. Context ancestors above the highest folded / unit root are display-only. Queue building is seed-deterministic. Requests carry `operation_id`; clients ignore stale responses. The freestyle mind-map card clips to the unit subtree (synthetic context root; folded ancestors as a single-child spine) and freezes due/rating focus with `scope_node_uids` / unit ratable UIDs. Formal due units settle like palace review (completion summary + FSRS dialog; submit only when frozen due nodes are fully rated).

Frontend ownership:

- Domain/config/skip/refresh: `apps/web/src/modules/freestyle` via `public.ts`
- Immersive page/widgets: `features/freestyle` + thin `pages/today/ImmersiveFreestylePage`
- Primary nav first item is **随心** (`/freestyle`); legacy `/freestyle/session` redirects there
- Mind-map cards reuse `widgets/mindmap-review-flow`; quiz cards keep unified attempt evidence and do not map to FSRS

## Study Sessions

Cross-context session reads, review-session creation, and resumable progress operations are exported only through `sessions.api`. Reviews, Palaces, English, and English Reading must not import `sessions.application` modules directly. Sessions presentation remains free to compose its own application services internally.

## Settings Metrics

Settings metrics consume backup catalog data through `backups.api`. This keeps Settings eligible for eventual platform ownership and prevents operational dashboards from binding to backup lifecycle implementation modules.

## English Reading Vocabulary

Vocabulary scheduling consumes reusable review policy and schedule-draft capabilities through `reviews.api`. English Reading owns vocabulary notes; Reviews owns the scheduling policy. The vocabulary service must not import `reviews.application.schedule_policy` directly.

## English Topic Patterns (句模)

Pattern sentence FSRS scheduling also consumes reusable scheduler helpers through `reviews.api` (`build_scheduler`, `load_fsrs_settings`, `normalize_rating`). English owns topic patterns, prompts, and viewpoint sentences; Reviews owns the scheduling policy only. Pattern services must not import `reviews.application` internals.
