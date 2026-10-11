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

## Write Locking

There is no app-level storage lock any more (`core.runtime_storage_lock` and `日志缓存/runtime-storage.lock` were removed on 2026-10-11; see `storage-lock-contention.md`). SQLite (WAL, `busy_timeout`) is the only write serializer. A transient `database is locked` is answered as a retryable `503` + `Retry-After` by the app error handler.

`write_storage_backup` captures the database with the `sqlite3` online backup API in page steps (`_snapshot_databases`), then copies remaining items; neither phase blocks writers. Restore and full import replace live files without any lock, so run them while no study session is writing.

### Read paths must not write

SQLite allows one writer. A *read* request that writes therefore stalls every other writer, and a wait past `busy_timeout` returns 503 — which clients retry, adding contention to the lock they are already waiting on.

`list_due_units` used to do exactly that: on a lagging palace hash it called `reconcile_palace_units` in-request (a write, hence the lock). Because the dashboard and review queue both read through it, merely opening a page could hold the lock long enough to fail `POST /review/units/{id}/sessions`, which is what builds the encounter the rating bar needs. The observed symptom was a rating bar whose buttons were silently disabled and a queue stuck at "18/43".

The rule now:

- **Read-only callers pass `allow_reconcile=False`** (`GET /review/queue`, `get_review_queue_summary`, i.e. dashboard). A lagging palace is recorded by `unit_reconcile_scheduler.schedule_reconcile` and its units are skipped for that read — so the queue is briefly short instead of the API stalling.
- **Write-path callers keep the default `allow_reconcile=True`** (freestyle round build, session start) and still heal inline, because they already own a write transaction.
- **Deferral is bounded, not permanent.** `start_reconcile_worker` drains the queue on a daemon tick (2s) and startup warmup drains once, so content still converges to current — the owner explicitly chose freshness over "never wait", so deferral must never become "stale forever".
- **Client-side, 503 is treated as busy, not failed.** The mutation queue honours `Retry-After` and gives up into a *visible* manual-retry state after `MAX_BUSY_ATTEMPTS`, so a busy server can no longer look like a dead button.

`test_unit_reconcile_deferral.py` pins both halves: the read path issues no `UPDATE`/`INSERT`/`DELETE`, and a scheduled drain actually heals the palace.

Editor saves additionally trigger `maybe_create_rolling_backup`, gated by `ROLLING_EDIT_BACKUP_INTERVAL`. Because each rolling snapshot rewrites the full database, that interval must stay long enough that a large synced-drive database is not re-copied continuously.

## Backups never run in the study path (2026-10-11)

Study must never wait for a backup. All four triggers are kept, and all of them run off the request path:

- **Edit-triggered**: `maybe_create_rolling_backup` only calls `request_rolling_backup`, which starts one daemon worker and merges further requests into it (single-flight). The worker re-checks the newest backup's age inside `_BACKUP_LOCK`, so a burst of edits produces one backup. Call sites stay one-liners; none of them may call `create_rolling_backup` inline. Only the explicit `POST /backups/create` button does.
- **Startup**: `start_startup_backups()` in the serve lifespan removes crash leftovers, then runs the daily and age-gated periodic backups in a thread. The short-lived prepare step no longer takes backups.
- **Scheduled**: the 5-minute loop calls `maybe_create_periodic_backup`, age-gated at `AUTO_ROLLING_BACKUP_INTERVAL`.
- **Shutdown**: `run_shutdown_backup_bounded` runs in a worker off the event loop. It waits at most 5 s for a running backup and stops waiting after 20 s; the worker is a daemon and the process exits anyway.

Staging is isolated: half-written backups live in `backups/.staging/.backup-stage-*`, never inside `rolling/`. `_latest_backup_in`, pruning, listing and the daily check ignore dot-folders, so a crash can no longer leave something that looks like a newer, empty backup. `cleanup_stale_backup_staging` clears leftovers at startup.

The online snapshot takes no study lock and yields every 128 pages. It warns after 120 s and is abandoned after 1200 s (`BackupTooSlowError`) instead of restarting forever under write pressure. Only the raw-copy fallback for a corrupt source takes the study lock, with a 5 s budget so it fails the (background) backup rather than stalling writers.

Restore disposes pooled connections (`engine.dispose()`) before swapping files and deletes any stale `-wal`/`-shm` that the backup did not bring, otherwise the old log would be replayed into the restored file. Restore holds the study lock, so writes during it get the plain 503 "数据正在写入中，请稍候再试。".

Full export/import (`full_transfer_service.py`) no longer hold the lock for the whole operation: export locks only the table dump and revision read, and import extracts outside the lock and locks only the swap window.

## Runtime Home Resolution

`MEMORY_ANKI_HOME` wins when set. Otherwise the configured `local-config` `local_app_home` is used, and only as a last resort does resolution fall back to `%LOCALAPPDATA%\MemoryAnki`. Every entry point must agree on one live database: a bare `uvicorn`/tool launch that silently used the LocalAppData default would open a *stale* second database and write review progress to the wrong place. Startup logs the resolved `app_home` plus its `source` (`env` | `local-config` | `default`) and warns when an alternate database is detected.
