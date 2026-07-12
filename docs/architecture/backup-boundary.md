# Backup Context Boundary

Backups owns storage snapshots, Palace editor versions, restore operations, editor safety checks, and full local archive transfer. Other contexts may orchestrate these capabilities but must not import Backups application modules directly.

## Public Entry

```text
palaces -> backups.api
palace_quiz -> backups.api
settings -> backups.api
knowledge -> backups.api
```

`backups.api` is the only cross-context entry point. It exposes explicit lifecycle commands, Palace-version operations, archive transfer operations, and structure-safety predicates. Backups presentation may continue composing its own application services internally.

The facade does not introduce cloud storage or a remote service. All backup and transfer behavior remains local and follows the configured Memory Anki runtime storage roots.
