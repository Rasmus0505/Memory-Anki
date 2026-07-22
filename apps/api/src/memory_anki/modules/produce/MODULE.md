# Module: produce

## Status
scaffolding — public surface path for concentrated refactor (branch 7.22-refactor-optimize).

## Owns
Import jobs, OCR, AI split, batch generation, PDF library

## Migrates from
- palaces mindmap_import*
- mindmap_ai_split*
- pdf_library
- batch_generation

## Forbids
Writes content only via content commands; no memory mutations

## Public surface
- `public/commands.py` — write intents
- `public/queries.py` — read intents
- `public/events.py` — domain events this module emits
- `public/projections.py` — stable read DTOs for other modules

## Cross-module rule
Import only `memory_anki.modules.produce.public`. Never import another module's application/infrastructure/presentation.
