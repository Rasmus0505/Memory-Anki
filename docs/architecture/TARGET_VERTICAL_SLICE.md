# Target Vertical Slice Architecture (7.22-refactor-optimize)

This is the **target** map for the concentrated refactor. Runtime ownership still
largely lives in legacy module names until W2/W3 file moves complete.

## Backend target modules

| Target | Legacy source | Status |
|---|---|---|
| content | palaces (doc) + knowledge + mindmap_document | scaffolding |
| memory | reviews + wave + FSRS | scaffolding |
| quiz | palace_quiz | scaffolding |
| practice | freestyle + formal review orchestration | scaffolding |
| produce | mindmap_import + ai_split + pdf_library + batch_generation | scaffolding |
| session | sessions | scaffolding |
| english / english_reading | same | migrated names kept |
| settings / dashboard / search / backups / ai_learning | same | keep, narrow deps |

## Frontend target modules

`apps/web/src/modules/<id>/` with `public.ts` only cross-import.

FSD `features/` + `entities/` are removed after W3 content move.

## Platform

- `platform.events` — in-process bus (scaffold)
- `platform.jobs` — unified job registry (scaffold)
- existing `platform.application` UoW / AiRuntime / mutations

## Import rule

```text
other modules -> modules.<id>.public only
```

## Wave ownership

Wave/FSRS logic already in baseline stays the semantic source of truth and moves
into `memory` without algorithm rewrite.
