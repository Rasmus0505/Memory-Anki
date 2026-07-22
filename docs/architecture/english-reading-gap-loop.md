# English Reading Gap Loop

English Reading owns immutable source/generated articles, anchored word or sentence targets, English-only explanations, generation runs, and target-to-article links.

## Learning Flow

```text
source article -> anchored targets -> English explanation -> generated article -> optional second generation layer
```

- Article content is immutable after creation; title changes do not change target offsets.
- A target is valid only when its quote exactly matches the stored content range and checksum.
- Generated articles may reach depth two. Depth-two articles remain readable and explainable but cannot generate descendants.
- Yellow presentation means a target has at least one generated article link. CEFR difficulty colors and completion feedback are retired.
- The manual profile CEFR is the only difficulty input. Reading behavior never mutates it.

## Boundaries

- `english_reading` owns article, target, explanation, generation-run, and link persistence.
- AI calls use the platform AI runtime and settings-owned prompt catalog. Every entity-scoped generation carries an owner article and unique operation ID.
- The legacy vocabulary and English topic-pattern contexts remain independent. The new reading loop does not write either context.
- Consumers use `english_reading.api`; recent-article compatibility projections do not expose ORM rows.
- Framework-free selection bounds, queue limits, and generation defaults are owned by `modules/english-reading` and exported only through its `public.ts`.
