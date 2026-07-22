# Target Vertical Slice Architecture (7.22-refactor-optimize)

## Status
Backend package ownership moved: content / memory / quiz / practice / produce / session.
Frontend FSD features/entities absorbed into apps/web/src/modules/*.

## Backend modules
| Module | Owns |
|---|---|
| content | Palace documents, knowledge bindings, editor state |
| memory | FSRS, waves, ratings, due rollups |
| quiz | Questions, generation, bindings |
| practice | Freestyle feed/queue + formal review composition surfaces |
| produce | Mind-map import jobs, AI split, import router |
| session | Study sessions, progress, timing |
| english / english_reading | English tracks |
| settings / dashboard / search / backups / ai_learning | Support contexts |

## Public import rule
Cross-context code must import only public entries (`modules.<id>.public` or `modules.<id>.api`).
Do not import another context application/infrastructure/presentation.

## Frontend
`apps/web/src/modules/<id>/public.ts` is the cross-module entry. UI lives under `modules/<id>/ui`.

## Platform
- platform.events event bus
- platform.jobs job registry scaffold
- existing UoW / AiRuntime / mutations
