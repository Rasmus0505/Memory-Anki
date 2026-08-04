# Module: content

## Status
active — owns the current palace and knowledge document contracts.

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

## Cross-module rule
Import only `memory_anki.modules.content.public`. Never import another module's application/infrastructure/presentation.
