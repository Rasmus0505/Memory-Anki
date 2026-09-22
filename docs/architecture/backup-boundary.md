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


## Settings Presentation Contract

`ProfileBackupsPage` presents three explicit areas: backup/restore, migration/import-export, and danger. Restore eligibility is based on `has_database`, independent of whether the snapshot kind is `full`, `rolling`, or `rescue`. Safe exports and Palace imports remain in migration; full ZIP replacement remains only in danger and must preserve preview, schema validation, destructive confirmation, rescue backup, and reload behavior.

## Snapshot Policy

Automatic, manual, and shutdown snapshots are database-only (`rolling`). Rescue snapshots before restore/import are also database-only. Snapshot files live under `日志缓存/backups`. Attachments stay in `学科附件`; English media stays in `学习数据`. Those trees must not be copied into every backup. `create_full_backup` remains as an explicit/internal helper and is not on the product create/startup path.
