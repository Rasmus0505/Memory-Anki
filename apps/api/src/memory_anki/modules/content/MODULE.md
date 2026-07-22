# Module: content

## Status
scaffolding — public surface path for concentrated refactor (branch 7.22-refactor-optimize).

## Owns
Palace documents, knowledge tree, editor state, attachments

## Migrates from
- palaces (document/editor/tree/attachment)
- knowledge
- mindmap_document

## Forbids
Must not import memory/FSRS; no review scheduling

## Public surface
- `public/commands.py` — write intents
- `public/queries.py` — read intents
- `public/events.py` — domain events this module emits
- `public/projections.py` — stable read DTOs for other modules

## Cross-module rule
Import only `memory_anki.modules.content.public`. Never import another module's application/infrastructure/presentation.
