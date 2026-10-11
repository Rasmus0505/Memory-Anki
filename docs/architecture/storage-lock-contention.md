# Storage write lock — removed (2026-10-11)

## What it was
`core/runtime_storage_lock.py` provided `storage_write_lock`: one process-wide `threading.Lock` plus an OS file lock on `日志缓存/runtime-storage.lock`. SQLAlchemy took it on `before_flush` and released it on `after_flush`. Its only purpose was keeping backup, restore, full import and raw file copies from observing a half-written state.

## Why it was removed
- SQLite (WAL, `busy_timeout`) already allows exactly one writer, so the lock added nothing for ordinary writes.
- The data directory lives on a removable USB drive. Every acquisition opened, locked and closed the lock file there, and any single write that stalled on that drive (10–25 s) queued every other writer, including freestyle ratings, behind it. Past 2 s the request failed with `storage_busy` 503, so each rating could take many seconds or fail while its SQL took milliseconds.
- Backup snapshots already use the SQLite online backup API and never needed the lock.

## What replaced it
Nothing. `StorageBusyError` and `handle_storage_busy` are gone. A transient SQLite `database is locked` is still reported as a retryable 503 + `Retry-After` by `handle_unexpected_error` (`infrastructure/db/lock_errors.py:is_sqlite_lock_error`).

## Trade-off accepted
Restore (`restore_storage_backup`), full import (`import_full_archive`) and the raw-copy fallback no longer exclude concurrent study writes. Run them while no one is studying.

## Guard
`tools/check_architecture.py:check_runtime_storage_lock` fails if `runtime_storage_lock` / `storage_write_lock` reappear under `apps/api/src`.

Related: `database-locked-root-cause.md` (SQLite-level contention), `backup-boundary.md`.
