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

## Runtime Lock Scope

Database and file-backed writers serialize on the shared runtime storage lock (`core.runtime_storage_lock`, surfaced on disk as `日志缓存/runtime-storage.lock`). SQLAlchemy acquires it on `before_flush` and holds it until the outermost transaction ends.

A snapshot must **not** hold that lock for its bulk copy. `write_storage_backup` therefore runs in two phases:

1. **Locked, fast** — `_snapshot_databases_under_lock` captures the database via `sqlite3` online backup (a consistent, streaming snapshot).
2. **Unlocked, slow** — every remaining item (media, attachments, exports) is copied with the lock released, so live autosave and review writes keep committing.

Regression context: the whole rolling backup used to run inside `storage_write_lock`. On this product's ~200 MB database hosted on a synced drive, one rolling copy held the lock for ~9 minutes, and every foreground write during that window failed with `TimeoutError: timed out acquiring runtime storage thread lock` — surfacing to users as `PUT /api/v1/palaces/{id}/editor -> 500` and "自动保存暂时失败". `test_bulk_backup_copy_runs_outside_the_runtime_write_lock` pins the two-phase ordering.

Contention is reported as a **retryable** condition, not an internal error: `StorageBusyError` (a `TimeoutError` subclass) is translated by the app error handlers into `503` with a `Retry-After` header and `code: storage_busy`. Foreground writes wait `_WAIT_SECONDS`; background jobs may pass a longer `wait_seconds`.

### Read paths must not write

The lock is process-wide and single. Anything that takes it inside a *read* request therefore stalls every writer in the product, and a read that waits past `_WAIT_SECONDS` returns 503 — which clients retry, adding contention to the lock they are already waiting on.

`list_due_units` used to do exactly that: on a lagging palace hash it called `reconcile_palace_units` in-request (a write, hence the lock). Because the dashboard and review queue both read through it, merely opening a page could hold the lock long enough to fail `POST /review/units/{id}/sessions`, which is what builds the encounter the rating bar needs. The observed symptom was a rating bar whose buttons were silently disabled and a queue stuck at "18/43".

The rule now:

- **Read-only callers pass `allow_reconcile=False`** (`GET /review/queue`, `get_review_queue_summary`, i.e. dashboard). A lagging palace is recorded by `unit_reconcile_scheduler.schedule_reconcile` and its units are skipped for that read — so the queue is briefly short instead of the API stalling.
- **Write-path callers keep the default `allow_reconcile=True`** (freestyle round build, session start) and still heal inline, because they already own a write transaction.
- **Deferral is bounded, not permanent.** `start_reconcile_worker` drains the queue on a daemon tick (2s) and startup warmup drains once, so content still converges to current — the owner explicitly chose freshness over "never wait", so deferral must never become "stale forever".
- **Client-side, 503 is treated as busy, not failed.** The mutation queue honours `Retry-After` and gives up into a *visible* manual-retry state after `MAX_BUSY_ATTEMPTS`, so a busy server can no longer look like a dead button.

`test_unit_reconcile_deferral.py` pins both halves: the read path issues no `UPDATE`/`INSERT`/`DELETE`, and a scheduled drain actually heals the palace.

Editor saves additionally trigger `maybe_create_rolling_backup`, gated by `ROLLING_EDIT_BACKUP_INTERVAL`. Because each rolling snapshot rewrites the full database, that interval must stay long enough that a large synced-drive database is not re-copied continuously.

## Runtime Home Resolution

`MEMORY_ANKI_HOME` wins when set. Otherwise the configured `local-config` `local_app_home` is used, and only as a last resort does resolution fall back to `%LOCALAPPDATA%\MemoryAnki`. Every entry point must agree on one live database: a bare `uvicorn`/tool launch that silently used the LocalAppData default would open a *stale* second database and write review progress to the wrong place. Startup logs the resolved `app_home` plus its `source` (`env` | `local-config` | `default`) and warns when an alternate database is detected.
