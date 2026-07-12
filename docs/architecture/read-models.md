# Read Model Purity

Queries and serializers return projections of persisted state. They do not repair, normalize, unarchive, flush, or commit aggregates.

## Palace Rules

- `palace_json`, `palace_summary_json`, and palace grouping/shelf projections are read-only.
- Inconsistent chapter bindings are represented through `binding_status`; they are not repaired during serialization.
- Archived palaces are excluded by repository query predicates rather than being automatically unarchived.
- Legacy bulk unarchive behavior lives only in `palace_maintenance.restore_all_archived_palaces` and must be invoked as an explicit maintenance command.
- Chapter-binding reconciliation remains an explicit command used after relevant write operations or dedicated repair workflows.

These rules ensure GET requests are retry-safe, make cache behavior deterministic, and prevent serializers from owning transactions.

## Palace Core Transactions

Palace core CRUD commands receive `UnitOfWork`; `PalaceRepository` exposes persistence primitives but never commits or refreshes transactions. Palace creation stages the Palace, pegs, initial Review schedules, and idempotency response before one UoW commit. Failure in any pre-commit collaborator rolls back the complete creation.

## Segment and mini-palace transaction rules

- Segment and mini-palace create/update/delete use cases receive the platform `UnitOfWork` port; application services never commit through SQLAlchemy `Session`.
- Create routes persist the aggregate row and mutation-id response in one transaction. A failure while preparing the idempotency record rolls back the aggregate write.
- Mini-palace list queries are projections only. They preserve stored node bindings and never clean, flush, commit, or refresh ORM state during GET handling. Any future cleanup must be exposed as an explicit maintenance command.

## Attachment compensation boundary

Attachment commands coordinate SQL state with local files without pretending the filesystem is transactional:

- Upload writes the file first, then commits attachment metadata through `UnitOfWork`; any database failure rolls back and deletes the new file.
- Delete first moves the file to a unique quarantine name, commits metadata deletion, and only then removes the quarantined file. A database failure rolls back and restores the original path.
- Presentation injects the SQLAlchemy adapter. The application service depends only on the platform `UnitOfWork` port and owns compensation behavior.

## Palace creation paths

Every route that creates a Palace must establish the same atomic minimum invariant: the Palace row, initial Review schedules, and mutation-id response either all commit or all roll back. Template instantiation therefore uses the same application-owned transaction pattern as core Palace creation instead of committing a Palace and triggering Review initialization afterward. Template CRUD and focus-node commands also receive the platform `UnitOfWork` port rather than committing through `Session`.

## Batch Palace imports

JSON and Markdown imports are application-owned batch transactions. The import service returns the exact created Palace entities instead of forcing presentation to rediscover them using descending IDs. All Palace rows, nested Peg trees, initial Review schedules, and the mutation-id response commit together. Failure while initializing any imported Palace rolls back the entire batch.
