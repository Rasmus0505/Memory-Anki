# 备份上下文边界

Backups 负责存储快照、宫殿编辑器版本、还原操作、编辑器安全检查，以及本地完整归档传输。其他上下文可以编排这些能力，但不得直接导入 Backups 的应用模块。

## 公共入口

```text
content -> backups.api
quiz -> backups.api
settings -> backups.api
knowledge -> backups.api
```

`backups.api` 是唯一的跨上下文入口。它暴露显式的生命周期命令、宫殿版本操作、归档传输操作和结构安全谓词。Backups 的表现层可以在内部继续组合自己的应用服务。

该门面不引入云存储或远程服务。所有备份与传输行为都在本地进行，并遵循已配置的 Memory Anki 运行时存储根目录。


## 设置表现层契约

`ProfileBackupsPage` 呈现三个明确区域：备份/还原、迁移/导入导出，以及危险区。还原资格取决于 `has_database`，与快照类型是 `full`、`rolling` 还是 `rescue` 无关。安全导出和宫殿导入仍留在迁移区；完整 ZIP 替换仍只位于危险区，并且必须保留预览、schema 校验、破坏性确认、救援备份和刷新行为。

## 快照策略

自动、手动和关机快照都只包含数据库（`rolling`）。还原/导入前的救援快照同样只包含数据库。快照文件位于 `日志缓存/backups` 下。附件保留在 `学科附件` 中；英语媒体保留在 `学习数据` 中。这些目录树不得被复制进每个备份。`create_full_backup` 保留为显式/内部辅助函数，不在产品的创建/启动路径上。

## 写锁

应用级存储锁已不存在（`core.runtime_storage_lock` 和 `日志缓存/runtime-storage.lock` 已于 2026-10-11 移除；见 `storage-lock-contention.md`）。SQLite（WAL、`busy_timeout`）是唯一的写入串行化机制。暂时的 `database is locked` 会被应用错误处理器应答为可重试的 `503` + `Retry-After`。

`write_storage_backup` 使用 `sqlite3` 在线备份 API 按页分步捕获数据库（`_snapshot_databases`），然后复制其余项目；两个阶段都不会阻塞写入者。还原和完整导入会在无任何锁的情况下替换活动文件，因此请在没有学习会话正在写入时运行它们。

### 读路径不得写入

SQLite 只允许一个写入者。因此，一个会写入的*读*请求会让其他所有写入者停滞，超过 `busy_timeout` 的等待会返回 503——客户端会重试，从而给它们本就在等待的锁增加竞争。

`list_due_units` 过去正是这么做的：当宫殿哈希滞后时，它会在请求内调用 `reconcile_palace_units`（一次写入，因此会拿锁）。由于仪表盘和复习队列都通过它读取，仅仅打开一个页面就可能长时间持有锁，导致 `POST /review/units/{id}/sessions` 失败，而该请求正是构建评分栏所需 `encounter` 的环节。观察到的症状是评分栏按钮被静默禁用，队列卡在 "18/43"。

现在的规则：

- **只读调用方传入 `allow_reconcile=False`**（`GET /review/queue`、`get_review_queue_summary`，即仪表盘）。滞后的宫殿由 `unit_reconcile_scheduler.schedule_reconcile` 记录，其单元在本次读取中被跳过——因此队列会短暂偏短，而不是 API 停滞。
- **写路径调用方保留默认的 `allow_reconcile=True`**（随心轮次构建、会话开始），仍会就地修复，因为它们本就持有写事务。
- **延后是有界的，不是永久的。** `start_reconcile_worker` 会在守护线程的定时 tick（2 秒）中排空队列，启动预热也会排空一次，因此内容仍会收敛到最新——所有者明确选择了优先新鲜度而非“从不等待”，所以延后绝不能变成“永远陈旧”。
- **客户端把 503 视为繁忙，而非失败。** 变更队列会遵循 `Retry-After`，并在达到 `MAX_BUSY_ATTEMPTS` 后转入*可见的*手动重试状态，因此繁忙的服务器不再看起来像一个坏掉的按钮。

`test_unit_reconcile_deferral.py` 锁定这两部分：读路径不发出 `UPDATE`/`INSERT`/`DELETE`，而计划中的排空确实会修复宫殿。

编辑器保存不再写备份。`maybe_create_rolling_backup` 和 `request_rolling_backup` 保留为空操作，以便编辑调用点保持无害；唯一的自动备份是下文所述的每日启动快照。

## 备份绝不在学习路径中运行（2026-10-15）

学习绝不能等待备份。在学习期间复制同步盘上的数据库会拖慢每一次评分，因此自动备份被缩减为一个触发点：

- **每日启动快照（唯一的自动备份）。** `start_startup_backups()` 会在每种启动模式下运行，包括整天保持打开的桌面/PWA 健康检查进程。它会清理崩溃残留，等待 `DAILY_BACKUP_STARTUP_DELAY_SECONDS`（120 秒），使学习的头几分钟不与复制竞争，然后调用 `ensure_daily_backup()`。该检查使用机器的本地日期并在 `_BACKUP_LOCK` 下运行，因此即使两个触发点重叠，每个本地日也最多写入一个快照。
- **启动器钩子。** `start-all.bat`（通过 `tools/pwa_server.py:_request_daily_backup_check`）会在每次启动时调用 `POST /api/v1/backups/daily-check`，包括复用正在运行的服务时。关闭窗口不会停止服务，因此当窗口重新打开并连接到活动进程时，该检查也会运行。
- **编辑触发以及周期性/关机备份已移除。** `request_rolling_backup` 返回 False；周期性循环、关机 worker 和 `run_shutdown_backup_bounded` 已删除。只有显式的 `POST /backups/create` 按钮会按需写入备份。
- **宫殿版本保留。** 在今天的快照存在后，启动线程会清理早于 `VERSION_RETENTION`（7 天）的 `palace_versions`，按 `PRUNE_BATCH_SIZE` 分批删除。每个宫殿始终保留其最新版本，因此没有宫殿会失去最后一个还原点（`prune_expired_palace_versions`）。
- **回执清理在每种模式下运行。** `start_mutation_response_purge_loop` 不再依赖 serve 模式，因此过期的 `api_mutation.*` 回执也会从桌面/PWA 进程中清除。

暂存是隔离的：写了一半的备份位于 `backups/.staging/.backup-stage-*`，绝不会在 `rolling/` 内。`_latest_backup_in`、清理、列表和每日检查都会忽略点开头文件夹，因此崩溃不再会留下看起来像更新、但为空的备份的东西。`cleanup_stale_backup_staging` 会在启动时清理残留。

在线快照不获取学习锁，并且每 128 页让出一次。它在 120 秒后发出警告，并在 1200 秒后放弃（`BackupTooSlowError`），而不是在写入压力下永远重启。只有针对损坏源的原始复制回退会获取学习锁，并带有 5 秒预算，使（后台）备份失败而不是让写入者停滞。

还原会在换文件前释放连接池（`engine.dispose()`），并删除备份未带来的任何陈旧 `-wal`/`-shm`，否则旧日志会被重放进还原后的文件。还原会持有学习锁，因此在此期间发生的写入会收到单纯的 503 "数据正在写入中，请稍候再试。"。

完整导出/导入（`full_transfer_service.py`）不再在整个操作期间持有锁：导出只锁定表导出和修订读取，导入则在锁外解压，只锁定交换窗口。

## 运行时主目录解析

设置 `MEMORY_ANKI_HOME` 时以它为准。否则使用已配置的 `local-config` 中的 `local_app_home`，只有作为最后手段才回退到 `%LOCALAPPDATA%\MemoryAnki`。每个入口都必须就同一个活动数据库达成一致：一个裸 `uvicorn`/工具启动若静默使用 LocalAppData 默认值，会打开*过期的*第二个数据库，并把复习进度写到错误的位置。启动时会记录解析出的 `app_home` 及其 `source`（`env` | `local-config` | `default`），并在检测到备用数据库时发出警告。
