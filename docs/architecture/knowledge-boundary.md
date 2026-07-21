# Knowledge Context Boundary

Knowledge owns subjects, chapters, chapter trees, and subject mind-map documents. Palace owns Palace-to-chapter binding invariants; Backup owns filesystem snapshot policy.

## Dependency Direction

```text
knowledge.application -> mindmap_document.api
knowledge.application -> palaces.api
knowledge.application -> backups.api
knowledge.application -> reviews.api (read-only FSRS projections for chapter palace cards)
```

Knowledge invokes the single `update_palace_chapter_binding` public command instead of coordinating Palace link expansion and reconciliation itself. Read endpoints never reconcile bindings; inconsistent state remains observable until an explicit write or maintenance command repairs it.

Chapter palace list cards may call `reviews.api.get_palace_memory_projection` for due counts, mastery, and next due time. Knowledge must not import private review application modules or mutate FSRS state.

`ChapterCreate` and `ChapterUpdate` belong to Knowledge request contracts and must not be defined in Palace domain schemas. Rolling backup triggering is an explicit post-commit capability exported by `backups.api`.

## Transaction Ownership

All Knowledge subject and chapter write commands receive `platform.application.UnitOfWork`. FastAPI composition constructs `SqlAlchemyUnitOfWork`; application services never call `Session.commit()` or `Session.rollback()` directly. Rolling backups run only after a successful UoW commit.

## Mutation responses

Knowledge subject/chapter creation extracts a platform `MutationIdentity` at presentation and persists the response through `SqlAlchemyMutationResponseStore` inside the existing application `UnitOfWork`. Knowledge no longer depends on the transitional Persistence context, and route error handling rolls back through the same UoW adapter used by the command.


## Palace subject ownership

Knowledge owns Subject, Chapter, and subject mind-map documents. Palace owns explicit `palace_subjects`, chapter binding revisions, primary-chapter repair, and the invariant that explicit linked chapters belong to an explicitly owned subject. Subject deletion is blocked while chapters or palace ownership references remain. The Palace editor may create a Subject through Knowledge's public HTTP contract, but all palace ownership mutations use the Palace knowledge-binding command.
