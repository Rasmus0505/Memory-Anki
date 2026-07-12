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
- `widgets/mindmap-review-flow/ReviewFlowMapPanel.tsx` owns keyboard/touch capture and node progression.
- Global rating shortcuts are disabled for editable targets and open dialogs.
- `1/2/3` and `J/K/L` submit manual ratings; moving forward without rating submits a low-confidence fuzzy inference; `Backspace` returns to the latest rated node for correction.