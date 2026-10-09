# Runtime Storage Lock Contention

Status: root-cause analysis, 2026-10-07. Fix design pending owner approval.

## Symptom

During ordinary study the rating bar becomes unusable: pressing 忘记/困难/简单
either does nothing or surfaces a long red error block. The bottom bar reads
「复习会话仍在加载，评分暂不可用…」 because the review-session POST that builds
the encounter never succeeded.

Measured on the owner's machine (`logs/pwa-api.log`, 2026-10-07):

| endpoint | count |
| --- | --- |
| `POST /freestyle/rounds/{id}/actions` | 221 |
| `POST /freestyle/rounds/{id}/actions` (other round) | 45 |
| `POST /freestyle/rounds/active` | 9 |
| `POST /review/units/{id}/sessions` | 17 |
| `POST /freestyle/rounds/{id}/ratings` | 8 |
| others (`from-time-record`, `client-preferences`, `encounters/.../cancel`) | 14 |
| **total** | **314** |

This is chronic, not exceptional: the owner reports it several times per study
session.

## Root cause

Every one of those 314 responses is the same shape:

```
storage busy on POST /api/v1/freestyle/rounds/{id}/ratings after 15.0s wait
POST .../ratings -> 503 in 15051.6ms [slow] worker_started_ms=2.65
                                     sql_count=8 sql_total_ms=28.4
```

Read the instrumentation: the handler spent **28 ms** doing SQL, then waited
**15 000 ms** for the lock. The work is trivial; the wait is everything.

The lock itself is fine. What is wrong is **who holds it**.

`infrastructure/db/_tables/_base.py` acquires the shared runtime storage lock in
the SQLAlchemy `before_flush` hook and releases it only when the **outermost
transaction ends**:

```python
@event.listens_for(Session, "before_flush")
def _acquire_storage_lock(session, _flush_context, _instances):
    ...
    lock = storage_write_lock()
    lock.__enter__()                       # acquired at first flush
    session.info["_storage_write_lock"] = lock

@event.listens_for(Session, "after_transaction_end")
def _release_storage_lock_after_transaction(session, transaction):
    if getattr(transaction, "parent", None) is not None:
        return
    _release_storage_lock(session)          # released at commit/rollback only
```

The lock is therefore held across *everything the handler does between its first
flush and its commit* — not merely across the SQL write. Any handler that flushes
early and then performs slow non-SQL work holds the single global lock for that
whole duration, and every other writer in the product blocks behind it.

Three properties make this a chronic, self-amplifying failure rather than an
occasional hiccup:

1. **It is one process-wide lock.** Database writes, backup snapshots and
   file-backed writers all serialize on it. There is no reader/writer split.
2. **The wait budget is 15 s** (`_WAIT_SECONDS`) while the client's own budgets
   are 20 s for reads and 15 s for session-start POSTs. A starved request
   therefore burns the full 15 s and returns 503 right at the edge of the
   client's patience.
3. **503 is retried.** `mutationQueue.ts` treats 503 as "busy, retry", and the
   freestyle client additionally re-POSTs `/ratings` with a fresh `operation_id`
   when `item` comes back null. Retries arrive while the holder still holds, so
   each retry re-queues behind the same lock. That is the lock convoy visible in
   the log: 503s cluster for 11:20 → 11:22, one request slips through at
   11:21:52, then the burst resumes.

### Why the backup work is a contributing, not primary, cause

`storage_backup.py` was already fixed once (commit `0b7939da`) so the bulk copy
runs outside the lock. Only the database snapshot remains inside it. On this
machine that snapshot is **not** milliseconds: the database is 197 MB on a USB
volume (`F:`, `vol:MemoryAnki/memory anki data`) that Syncthing is actively
working. A plain 197 MB copy measured 9.5 s on an otherwise idle drive, and the
recorded rolling snapshots show far worse while syncing:

| backup dir | DB snapshot mtime | lock held |
| --- | --- | --- |
| `20261007-000121-rolling-editor-save` | 00:03:34 | ~2m13s |
| `20261007-050338-rolling-editor-save` | 05:12:38 | ~9m00s |
| `20261007-054643-rolling-editor-save` | 05:53:07 | ~6m24s |

Any snapshot overlapping study guarantees 503s for its whole duration. This is
the "occasional long stall" half of the problem; the transaction-scoped hold is
the "constant background" half that produces 314 events.

Later change: the database snapshot no longer takes the study lock. SQLite's
online backup API copies committed pages in steps while writers continue. The
2026-10-09 overlay-progress 503 (15s wait, then `storage_busy`) was this same
snapshot still holding the lock on a ~200 MB synced-drive database.

## Requirements for a fix

The owner's stated preferences, from the 2026-10-07 product interview:

- **Plain language only.** One sentence plus one button. Error text must not lead
  with request paths, HTTP codes or request IDs.
- **A 「复制诊断信息」 button** so the technical detail is still available for
  diagnosis, without being shown by default.
- **Fix the structure, not the symptom.** The owner explicitly chose "一次修到底：
  把这把锁的结构问题解决，所有操作都不再互相拖累" over a targeted patch.
- High frequency means the fix must remove recurrence, not soften the message.

## Fix direction (to be implemented)

1. **Narrow the lock to the commit, not the transaction.** The `before_flush`
   acquisition is the structural defect: it converts any slow handler into a
   global stall. Holding the lock only across the actual SQLite write — the
   thing a backup snapshot must not interleave with — removes the entire class of
   convoy while preserving the backup/mutation mutual-exclusion the lock exists
   for.
2. **Never let a foreground request burn 15 s to fail.** A starved writer should
   fail fast with a retryable signal, and callers must be able to distinguish
   "busy, safe to retry" from "broken".
3. **Make the retry path not re-enter the same contention.** The client already
   honours `Retry-After`; the current convoy shows retries arriving faster than
   the holder can drain.
4. **User-facing copy**: replace the wall of technical detail with one plain
   sentence, plus a 「复制诊断信息」 action that copies the full context.

## Regression context

`test_unit_reconcile_deferral.py` already pins the read-path half of an earlier
incident in this same area (a read that wrote, holding the lock inside a GET).
The transaction-scoped hold is the same defect one layer down and needs its own
guard: a handler that flushes early must not block unrelated writers for the

## The lock must be releasable from another thread

Separate from *how long* the lock is held (above) is *who* may release it. The
lock is a **mutual-exclusion guard, not an ownership token**: it is released
wherever the work finishes, and that is legitimately a different thread from the
one that took it.

FastAPI runs a sync endpoint and its generator-dependency teardown in separate
threadpool calls. When a flush raises, SQLAlchemy defers the ROLLBACK to the next
use or to `close()`, so `after_transaction_end` fires on the **teardown thread**.
The lock registry originally used `threading.RLock`, which only its owning thread
may release, so that raised:

    RuntimeError: cannot release un-acquired lock

Two consequences, both worse than the original fault:

1. The `RuntimeError` **replaced the original exception** (an exception raised in
   a `finally` supersedes the one propagating), so the log blamed the lock
   instead of naming the real cause.
2. It aborted the `finally` before `lock.release()`, **wedging the process-wide
   lock**. Every later writer waited out its budget and failed: one event
   produced 55 consecutive `storage_busy` 503s.

The registry therefore uses `threading.Lock`, and reentrancy is tracked
explicitly per thread (`_state.held` counts nesting depth; only the outermost
frame releases). Verified with a probe on the real application path:
`acquire on MainThread` → `release on worker-B`.

Guards: `check_runtime_storage_lock` rejects `threading.RLock()` in
`core/runtime_storage_lock.py`, and
`test_runtime_storage_lock_cross_thread.py` pins both the cross-thread release and
the starvation it used to cause. See `docs/incidents/0003-round-stale-data-500.md`
§9 for the full evidence.
duration of its non-SQL work.
