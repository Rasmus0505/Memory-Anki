# Module: memory

## Status
migrated — permanent-mark unit scheduling is the only palace review runtime.

## Owns
- permanent-mark unit state and topology reconciliation
- fixed-ladder scheduling and local-day due dates
- review sessions, encounters, atomic amendments, close locking, and undo

## Retired
- node ratings and node FSRS state
- waves, calibration, aggregation, daily plans, and temporary marks

## Forbids
Must not import palace application internals; read trees via content.public

## Public surface
- `public/commands.py` — write intents
- `public/queries.py` — read intents

## Cross-module rule
Import only `memory_anki.modules.memory.public`. Never import another module's application/infrastructure/presentation.
