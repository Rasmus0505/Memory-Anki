# Unified Training Evidence Boundary

## Product boundary

Memory Anki uses one learning loop: confirmed mind-map structure produces training content; training sessions produce auditable evidence; evidence produces explainable mastery and next actions. Existing review, practice, mini-palace, freestyle, and quiz URLs remain compatible while their session behavior converges.

The primary navigation is intentionally limited to four destinations: `今日`, `知识`, `创建`, and `洞察`. Settings remain available through system/profile surfaces and are not a fifth learning destination.

## Recall evidence

Formal mind-map review records three normalized ratings:

- `1`: forgot
- `2`: fuzzy
- `3`: remembered

Legacy rating `5` remains readable as remembered. New clients do not emit it.

Every recall event records whether it was `manual` or `inferred`. Inferred events require a confidence value and carry stable session/node/round operation identity. Response duration, hint count, and retry count are evidence attributes, not scheduling commands.

Corrections append a new event through `supersedes_event_id`; history is never destructively rewritten. Automatic inference is low-confidence and must be replaceable by a manual correction.

## Mastery projection

`mindmap_learning` owns the explainable projection. It outputs status, numeric score, evidence counts, reason, recent events, and a suggested training category. Manual evidence has full weight; inferred evidence has capped weight. A single remembered event cannot produce stable mastery.

The projection does not replace the existing review scheduler. AI may evaluate or coach, but it cannot directly own persisted mastery or scheduling.

## UI ownership

- `features/review/hooks/useMindMapRecallRatings.ts` owns optimistic evidence writes, legacy normalization, and correction linkage.
- `widgets/mindmap-review-flow/FlipCardMindMapPanel.tsx` owns shared flip-card rendering, keyboard/touch capture, node progression, and viewport preservation for Palace learning and formal Review.
- Global rating shortcuts are disabled for editable targets and open dialogs.
- `1/2/3` and `J/K/L` submit manual ratings; moving forward without rating submits a low-confidence fuzzy inference; `Backspace` returns to the latest rated node for correction.

## FSRS rating evidence

The current evidence contract uses four direct ratings: `1=忘记`, `2=困难`, `3=记得`, `4=轻松`. Subtree operations append one event per affected non-root node; the selected node is `direct`, descendants are `batch_inherited`, and every event carries a stable operation identity and scope. A later single-node event supersedes the effective rating for that node without rewriting history.

Reviews consumes this public evidence capability and owns FSRS state, scheduling, due queues, and palace-level projections. Legacy Ebbinghaus schedules and logs remain queryable for audit and migration provenance, but are not the source of bookshelf progress or new node scheduling.
