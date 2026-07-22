# Module: session

## Status
scaffolding — public surface path for concentrated refactor (branch 7.22-refactor-optimize).

## Owns
Study sessions, timing, scene attribution

## Migrates from
- sessions

## Forbids
No FSRS math

## Public surface
- `public/commands.py` — write intents
- `public/queries.py` — read intents
- `public/events.py` — domain events this module emits
- `public/projections.py` — stable read DTOs for other modules

## Cross-module rule
Import only `memory_anki.modules.session.public`. Never import another module's application/infrastructure/presentation.
