# `database is locked`：根因与修复（2026-10-07）

> **诊断有一处已被取代——请阅读
> [../incidents/0001-review-session-locked.md](../incidents/0001-review-session-locked.md)
> 了解更正后的归因。**
>
> 下文的 `no_autoflush` 修复是正确的，也值得做。但本文引用的看门狗
> 证据**无法支撑它所点名的调用帧**：原始看门狗从 `after_begin` 开始计时
> 事务（因此把只读事务也算作写入），并记录*被阻塞请求*的来源，所以锁的
> **受害者**会与**持有者**被完全同样地报告。`_remember_operation` 和
> `write_client_preferences:180`（后者就是 `session.commit()` 那一行）不可能
> 持有事务；它们出现是因为被阻塞的请求正是在那里尝试写入。已通过受控实验
> 证明——见 incident 0001 §3.1。
>
> 看门狗现在把 `write transaction HELD …` 和 `blocked … WITHOUT
> ever acquiring …` 报告为不同的结果，因此下一次调查可以信任哪个是哪个。
> 因此，50 秒停滞的根因持有者**仍未被识别**；请把本文的调用帧列表当作
> 线索，而不是结论。

取代 `storage-lock-contention.md` 中的分析，后者描述了一个症状（应用级 `StorageBusyError` → 503 路径），但没有描述主要故障。早先的修复仍然正确并保留；只是不够充分。

## 症状

学习期间评分栏无法使用：每张卡片都显示「复习会话仍在加载，评分暂不可用…」，客户端报告

```
网络请求失败：POST /api/v1/review/units/{id}/sessions
浏览器错误：请求超过 15 秒未响应
```

## 两把锁，不同的失败模式

| 层 | 错误 | 2026-10-07 的计数 | 预算 |
| --- | --- | --- | --- |
| 应用运行时锁（`runtime_storage_lock`） | `storage busy` 503 | 314+ | 15 s |
| **SQLite 文件锁** | **`database is locked`** | **264** | 10 s |

评分栏冻结来自**第二把**。

## 根因

SQLAlchemy 会在查询前自动 flush 待处理变更。因此，在一位先暂存写入、再执行读取的处理器中，第一次读取就会开启一个 **SQLite 写事务**，并一直保持打开，直到该处理器最终提交。SQLite（WAL）允许许多并发读者，但只允许**一个写入者**，所以其他每个写入者都要等满 `busy_timeout`（10 秒）然后失败。

决定性证据来自为此添加的会话看门狗（`OPEN_WRITE_TRANSACTION_WARN_SECONDS`）：

```
POST /review/units/{id}/sessions -> 503 in 51302ms
  sql_count=27  sql_total_ms=21.4          # all the SQL took 21 ms
  write transaction held 51.30s opened at unit_review_service.py:156
                                        in _session_has_billable_progress

write transaction held 36.56s opened at round_state_service.py:148 in _latest_active_for_workspace
write transaction held 33.31s opened at round_state_service.py:733 in _remember_operation
write transaction held 27.38s opened at round_state_service.py:752 in _operation_seen
```

**27 条语句、21 毫秒的真实 SQL、51 秒持有唯一的写锁**——期间却什么也没做。

针对活动数据库独立复现，一个写入者将其事务持有 12 秒：

```
holder(持12秒): 成功 12003 ms
contender:     失败 OperationalError: database is locked  耗时 10962 ms
```

10962 毫秒与生产环境的 10927 毫秒完全吻合。

## 修复

这些函数都在写路径内部回答关于**已提交**状态的问题，因此这些查询被包裹在 `session.no_autoflush` 中。这在两点上都是正确的：

1. 读取不再开启写入，因此写事务在提交时才开启（毫秒级窗口），而不是在第一次顺带的查询时开启。
2. 它在语义上也是对的：当前进行中的调用所暂存的行不得改变答案。对 `_operation_seen` 而言这关乎正确性——把同一次调用暂存的回执计算在内，会让一次重试看起来像重复，从而被静默跳过。

这三个辅助函数现在位于 `modules/practice/application/round_read_lookups.py` 和 `unit_review_service._session_has_billable_progress` 中，共同理由在拥有它的模块中记录一次。

## 为什么空闲进程无法诊断此问题

在应用空闲时轮询活动数据库返回 **0/120 被阻塞**，最坏获取耗时 1 毫秒，`py-spy dump` 只显示空闲线程。该故障由负载触发，需要并发的学习会话。只有在看门狗对*事务*（而非锁）进行插桩，并且一次真实的学习会话复现了它之后，才被找到。

## 同一轮修复的相关缺陷：47 小时的自动保存活锁

`GET /palaces/40/editor` 每 30–60 秒持续受到 `PUT -> 409` 冲击，长达 **47 小时**（3,020 次失败），从 2026-10-05 13:03 开始且从未停止。

`shared/persistence/autosaveCoordinator.ts` 会**永远**重试失败的 flush：失败分支会重新调度自己，该键留在 `dirtyKeys` 中（只有成功才会移除它，第 77 行），尝试次数计数器只限制*退避*，而延迟稳定在 30 秒并持续触发。没有任何终态，现有测试也只覆盖“最终成功”——从未覆盖“始终失败”。

修复方式是在 `AUTO_SAVE_MAX_ATTEMPTS` 后停止，并由 `markDirty` 恢复预算，使之后真正的编辑仍会被保存（如果没有该重置，修复会让用户的下一次编辑搁浅——那是更糟的 bug）。由两个测试锁定，其中之一已确认在旧代码上失败。

本地草稿已经持久化了该编辑，因此停止不会丢失任何工作。

## 验证

- 898 个后端测试通过；2389 个前端测试通过。
- `tools/quality_gate.py`：全部 8 个阶段通过。
- 重启后，先前持续不断的锁错误停止了：前 100 秒内**零**慢事务或锁失败，而此前基线是每 30 秒一次。

## 仍存在的已知问题

409 循环只能通过重新加载已打开的客户端来清除——它仍在运行修复前的构建产物。页面刷新后，新构建会停止重试。
