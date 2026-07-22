# Freestyle Immersive Feed Boundary

## Product surface

- Primary nav first item: **随心** → `/freestyle`
- Legacy `/freestyle/session` redirects to `/freestyle`
- Default PWA entry remains `/freestyle`

## Ownership

| Concern | Owner |
|---|---|
| Feed config, skip/refresh/merge rules | `apps/web/src/modules/freestyle` (`public.ts`) |
| Immersive page composition | `features/freestyle` + thin `pages/today/ImmersiveFreestylePage` |
| Branch split / queue ordering | `modules/freestyle/domain` (backend pure functions) |
| Queue HTTP build | `modules/freestyle/application/queue_service.py` |
| Tree structure | `palaces.api` |
| Due / FSRS projection & writes | `reviews.api` / Reviews module |
| Published questions, bindings, mastery | `palace_quiz.api` |
| Mind-map flip/rating UI | `widgets/mindmap-review-flow` |

## Invariants

1. Freestyle application code must not import other modules' private application packages; only `.api` facades.
2. Browse-only (rating mode off) must not write FSRS or mark due nodes reviewed.
3. Quiz attempts stay on the unified attempt evidence path; they are not mapped to mind-map FSRS ratings.
4. Queue rebuild is seed-deterministic and preserves completed / skip / hidden state.
5. Clients ignore queue responses whose `operation_id` is not the latest request identity.
6. Queue length is finite (`queue_length`, default 20); not an infinite feed.
7. Mind-map flip cards are **complete subtree units** sized near `node_limit` (never truncated siblings). Every **non-root** node appears in exactly one unit's `ratable_node_uids`. When best-fit drills past a parent, that parent is **folded into the first descendant unit's ratable set** (not a size-1 residual card). Context path is ancestors above the highest folded / unit root node; those ancestors are display-only and do not count toward `node_count`.
8. The freestyle mind-map card UI **clips** `editor_doc` to the queue unit via `clipEditorStateToBranchUnit` (synthetic context root + unit subtree). Folded ancestors appear as a single-child spine above the unit root, not as sibling branches of the full palace. Flip/due/rating scope still uses `ratable_node_uids` / unit `due_node_uids`.
9. Due freestyle units start formal review with explicit `scope_node_uids` (unit due intersection). They must not resume or expand into a mismatched full-palace formal freeze.
10. Formal freestyle completion uses the same FSRS settlement path as palace review: load completion summary → dialog (bulk-rate unrated if needed) → submit only when every frozen due node is rated. Direct `submit` while unrated is rejected by the API (409).

## API

`POST /api/v1/freestyle/queue/build`

Request: full config, `operation_id`, `completed_ids`, `hidden_ids`  
Response: echo `operation_id`, sanitized config, lightweight cards, phase stats, counts.

## Frontend module exports

Consumers must import freestyle domain/persistence helpers only from `@/modules/freestyle/public`.
