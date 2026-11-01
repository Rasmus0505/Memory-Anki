# 存储写锁——已移除（2026-10-11）

## 它曾是什么
`core/runtime_storage_lock.py` 提供 `storage_write_lock`：一个进程级 `threading.Lock` 加上对 `日志缓存/runtime-storage.lock` 的 OS 文件锁。SQLAlchemy 在 `before_flush` 时获取它，在 `after_flush` 时释放。它唯一的用途是防止备份、恢复、完整导入和原始文件复制观察到写了一半的状态。

## 为什么移除
- SQLite（WAL、`busy_timeout`）本身已经只允许一个写入者，因此该锁对普通写入没有任何增益。
- 数据目录位于可移动 USB 驱动器上。每次获取都会在那里打开、锁定并关闭锁文件，任何一次在该驱动器上卡住（10–25 秒）的写入都会把所有其他写入者（包括随心评分）排在它后面。超过 2 秒请求就会以 `storage_busy` 503 失败，因此每次评分都可能耗时数秒或失败，而其 SQL 只耗时毫秒。
- 备份快照已经使用 SQLite 在线备份 API，从不需要该锁。

## 什么替代了它
没有。`StorageBusyError` 和 `handle_storage_busy` 已删除。临时的 SQLite `database is locked` 仍会由 `handle_unexpected_error`（`infrastructure/db/lock_errors.py:is_sqlite_lock_error`）作为可重试的 503 + `Retry-After` 报告。

## 接受的权衡
恢复（`restore_storage_backup`）、完整导入（`import_full_archive`）和原始复制回退不再排除并发的学习写入。请在无人学习时运行它们。

## 护栏
如果 `runtime_storage_lock` / `storage_write_lock` 在 `apps/api/src` 下重新出现，`tools/check_architecture.py:check_runtime_storage_lock` 会失败。

相关：`database-locked-root-cause.md`（SQLite 级争用）、`backup-boundary.md`。
