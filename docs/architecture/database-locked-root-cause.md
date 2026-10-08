# `database is locked`: root cause and fix (2026-10-07)

> **Diagnosis superseded in one respect — read
> [../incidents/0001-review-session-locked.md](../incidents/0001-review-session-locked.md)
> for the corrected attribution.**
>
> The `no_autoflush` fix below is right and was worth making. But the watchdog
> evidence quoted in this document **cannot support the frames it names**: the
> original watchdog timed transactions from `after_begin` (so it counted
> read-only transactions as writes) and recorded the origin of *the request that
> was blocked*, so a **victim** of the lock was reported exactly like a
> **holder**. `_remember_operation` and `write_client_preferences:180` (the
> latter is the `session.commit()` line itself) cannot hold a transaction; they
> appear because that is where a blocked request tried to write. Proven by
> controlled experiment — see incident 0001 §3.1.
>
> The watchdog now reports `write transaction HELD …` and `blocked … WITHOUT
> ever acquiring …` as separate outcomes, so the next investigation can trust
> which is which. The holder at the root of the 50-second stalls is therefore
> **still unidentified**; treat this document's list of frames as leads, not
> findings.

Supersedes the analysis in `storage-lock-contention.md`, which described one
symptom (the app-level `StorageBusyError` → 503 path) but not the dominant
failure. That earlier fix is still correct and kept; it was simply insufficient.

## Symptom

During study the rating bar was unusable: every card showed
「复习会话仍在加载，评分暂不可用…」 and the client reported

```
网络请求失败：POST /api/v1/review/units/{id}/sessions
浏览器错误：请求超过 15 秒未响应
```

## Two locks, different failure modes

| Layer | Error | Count on 2026-10-07 | Budget |
| --- | --- | --- | --- |
| App runtime lock (`runtime_storage_lock`) | `storage busy` 503 | 314+ | 15 s |
| **SQLite file lock** | **`database is locked`** | **264** | 10 s |

The frozen rating bar came from the **second**.

## Root cause

SQLAlchemy autoflushes pending changes before a query. In a handler that stages
writes and then performs reads, the first read therefore opens a **SQLite write
transaction**, which stays open until the handler finally commits. SQLite (WAL)
allows many concurrent readers but exactly **one writer**, so every other writer
waits out `busy_timeout` (10 s) and then fails.

The decisive evidence, from the session watchdog added for this
(`OPEN_WRITE_TRANSACTION_WARN_SECONDS`):

```
POST /review/units/{id}/sessions -> 503 in 51302ms
  sql_count=27  sql_total_ms=21.4          # all the SQL took 21 ms
  write transaction held 51.30s opened at unit_review_service.py:156
                                        in _session_has_billable_progress

write transaction held 36.56s opened at round_state_service.py:148 in _latest_active_for_workspace
write transaction held 33.31s opened at round_state_service.py:733 in _remember_operation
write transaction held 27.38s opened at round_state_service.py:752 in _operation_seen
```

**27 statements, 21 ms of real SQL, 51 seconds holding the single write lock** —
while doing nothing with it.

Reproduced in isolation against the live database, one writer holding its
transaction for 12 s:

```
holder(持12秒): 成功 12003 ms
contender:     失败 OperationalError: database is locked  耗时 10962 ms
```

10962 ms matches the production 10927 ms exactly.

## Fix

Every one of these functions answers a question about **committed** state from
inside a write path, so the lookups are wrapped in `session.no_autoflush`. That
is correct on two counts:

1. A read no longer opens a write, so the write transaction opens at the commit
   (a millisecond window) instead of at the first incidental query.
2. It is semantically right: rows staged by the in-flight call must not change
   the answer. For `_operation_seen` this matters for correctness — counting a
   receipt staged by the same call would make a retry look like a duplicate and
   get it silently skipped.

The three helpers now live in
`modules/practice/application/round_read_lookups.py` and
`unit_review_service._session_has_billable_progress`, with the shared rationale
documented once in the module that owns it.

## Why an idle process could not diagnose this

Polling the live database while the app was idle returned **0/120 blocked** with
a worst-case acquisition of 1 ms, and `py-spy dump` showed only idle threads. The
failure is load-triggered and needs a concurrent study session. It was found only
after the watchdog instrumented the *transaction* (not the lock) and a real study
session reproduced it.

## Related defect fixed in the same pass: a 47-hour autosave livelock

`GET /palaces/40/editor` was hit by `PUT -> 409` every 30–60 s continuously for
**47 hours** (3,020 failures), starting 2026-10-05 13:03 and never stopping.

`shared/persistence/autosaveCoordinator.ts` retried a failed flush **forever**:
the failure branch rescheduled itself, the key stayed in `dirtyKeys` (only a
success removes it, line 77), and the attempt counter capped the *backoff* while
the delay settled at 30 s and kept firing. Nothing had a terminal state, and the
existing tests only covered "eventually succeeds" — never "always fails".

Fixed by stopping after `AUTO_SAVE_MAX_ATTEMPTS`, with `markDirty` restoring the
budget so a later genuine edit is still saved (without that reset, the fix would
strand the user's next edit — a worse bug). Pinned by two tests, one of which was
confirmed to fail against the old code.

The local draft already persists the edit, so stopping loses no work.

## Verification

- 898 backend tests pass; 2389 frontend tests pass.
- `tools/quality_gate.py`: all 8 stages pass.
- After restart, the previously constant lock errors stopped: **zero** slow
  transactions or lock failures in the first 100 s, against a prior baseline of
  one every 30 s.

## Remaining known issue

The 409 loop can only be cleared by reloading the open client — it is already
running the pre-fix bundle. After a page refresh the new build stops retrying.
