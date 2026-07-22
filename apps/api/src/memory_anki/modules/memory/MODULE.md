# Module: memory

## Status
scaffolding — public surface path for concentrated refactor (branch 7.22-refactor-optimize).

## Owns
FSRS, ReviewWave, ratings, due rollups, calibration

## Migrates from
- reviews (incl. wave_*, calibration, node_memory_*, fsrs_runtime)

## Forbids
Must not import palace application internals; read trees via content.public

## Public surface
- `public/commands.py` — write intents
- `public/queries.py` — read intents
- `public/events.py` — domain events this module emits
- `public/projections.py` — stable read DTOs for other modules

## Cross-module rule
Import only `memory_anki.modules.memory.public`. Never import another module's application/infrastructure/presentation.
