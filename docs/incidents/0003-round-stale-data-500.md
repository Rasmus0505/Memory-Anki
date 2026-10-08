# 0003 「服务器内部错误」做题打不开——同一列上装了两把乐观锁

**状态**：根因已定位、已修复、有守护门禁。
**首次记录**：2026-10-08
**二次修订**：2026-10-09（第一次只修了一条写路径，且一个被掩盖的错误把 500 放大成 55 次 503，见第 9 节）
**影响**：做题弹窗直接报 500 打不开；评分、跳过、完成等轮次写入同样会失败。
一天日志里 **68 次** `StaleDataError`，波及 `/actions`、`/overlay-quiz/ensure`、
`/ratings`、`/review/units/.../sessions`。第二次触发时进一步导致**连续 55 次 503**
（进程级存储锁被永久卡死），用户看到「做题进度尚未同步」。

---

## 1. 用户看到的现象（人话）

打开做题，弹窗里直接一大段红字：

> 服务器内部错误，请查看服务端日志。操作：同步随心做题会话
> 请求：POST /api/v1/freestyle/rounds/5298ebf9…/overlay-quiz/ensure HTTP 状态：500

右上角同时弹一个红色 toast。做题完全用不了，而且重试也没用。

## 2. 实际发生的机制

`freestyle_round_states` 这张表上，**同一列 `version` 被两套乐观锁同时看管**：

| 谁 | 机制 | 输的时候做什么 |
|---|---|---|
| practice 模块 | `expected_version` + `operation_id` 幂等回执 | 返回 `conflict: true`，**前端已经会重试** |
| SQLAlchemy ORM | `__mapper_args__ = {"version_id_col": version}` | 在 flush 时抛 `StaleDataError` |

关键在于**两把锁的检查时机不同**。模块自己那套在读取时检查，通过之后才会走到提交；
而 ORM 那套在 `commit()` 时才发现版本已被别人改掉。中间这个窗口在真实使用中命中率很高：

- 学习中台心跳（`/session/live/commands`）**每隔几秒**就写一次这张表
- 手机与电脑通过 Syncthing 共用同一个库，两边都会写

于是正常时序是：

```
A: 读 row(version=135) → 模块检查通过 → 准备提交
B:              写 row(version=136) → commit          ← 心跳/另一台设备
A: commit → ORM 发现 version 已变 → raise StaleDataError → 无人捕获 → HTTP 500
```

**这不是异常情况，而是并发下的常见结果**——68 次/天。

更要命的是：**本项目的设计里，"输了"根本不是错误。** `conflict: true` 这个语义
在 practice 模块里到处都在用，前端也为它写好了重试：

- `useOverlayProgressPersistence.ts:90` —— `if (round.conflict && allowRetry)`
- `useImmersiveQueue.ts` 多处 —— `if (!round.conflict) break` 等

ORM 那一抛，等于**绕过了项目已经建好的优雅路径，把它降级成 500**。

## 3. 为什么不能简单地删掉 ORM 那把锁

第一版修复我直接删掉 `version_id_col`。结果：500 没了，但出现了**静默丢失更新**——
A 的过期写入覆盖了 B 刚提交的新计划（受控实验：B 提交的计划被 A 的
`'{"touched": true}'` 覆盖）。

所以 ORM 那把锁是**真正的数据保护**，不能删。它保护的是：
「一个会话拿着过期快照，不能悄悄盖掉别人更新的计划」。

正确修法是：**保留保护，但把"输"翻译成项目已有的语义**。

## 4. 修法

把提交收敛到一个边界函数 `round_commit.commit_operation`（8 条写路径全部经过它）：

```python
try:
    session.commit()
    return True
except StaleDataError:
    session.rollback()
    session.refresh(row)   # 重新加载赢家写下的真实版本
    return False
```

调用方拿到 `False` 就返回 `_payload(row, conflict=True)`。
`session.refresh` 很关键：回滚后实例过期，刷新才能让 payload 报告**赢家的真实版本**，
否则客户端会拿着自己的旧版本号无限重试。

同时把 `session.commit()` 从 `round_state_service` 里彻底移除（门禁强制），
让这类竞争只有一处出口。

**行为对照**：

| | 修复前 | 修复后 |
|---|---|---|
| 落后的写入 | 未捕获异常 → **500** | `conflict: true`，前端重试 |
| 过期数据覆盖新数据 | ORM 拦住（抛错） | 仍然拦住（回滚丢弃） |
| 客户端拿到 | 红字报错 | 真实最新版本，可继续 |

## 5. 证据清单

- 线上日志：`logs/pwa-api.log` 中 `StaleDataError` 共 68 次，最早 **2026-10-05 10:47**——
  早于本次相关改动（10-08），因此是**既有缺陷**，不是新引入的。
- 端点分布：`/actions` 30 次、`/overlay-quiz/ensure` 4 次，其余分散在
  `/ratings`、`/review/units/.../sessions`、`/rounds/active`、`/queue/build`、
  `/study-sessions/time-ledger`。
- 受控复现：`apps/api/tests/test_round_concurrent_write.py`
  - `test_losing_a_version_race_reports_conflict_instead_of_raising`
  - `test_conflict_payload_carries_the_winners_version`
  - `test_action_write_reports_conflict_instead_of_raising`（参数化）
  修复前第一个用例抛出的正是线上那条：
  `UPDATE statement on table 'freestyle_round_states' expected to update 1 row(s); 0 were matched.`
- 端到端：用真实库副本走 HTTP，截图里那个请求由 500 变为 **200**，题目池 165 题。

## 6. 防复发

`tools/check_architecture.py::check_freestyle_scope_quiz_overlay` 现在拒绝：

- 缺少 `round_commit.py` 提交边界；
- 提交边界里不再处理 `StaleDataError` / 不再 `rollback` + `refresh`；
- `round_state_service.py` 里重新出现裸 `session.commit()` 或不再走 `commit_operation`。

守护自身的回归测试：`test_lost_round_write_race_must_not_escape_as_stale_data`
（必须报错）与 `test_lost_race_guard_accepts_the_owned_shape`（不得误报）。

## 7. 教训

**同一个值上装两套并发控制，它们对"输了"的处理必须一致。**
这里两套锁各自的逻辑都没错，错在没人负责翻译：

- 模块说「输了就返回 conflict，客户端重试」
- ORM 说「输了就抛异常」

两者并存时，**后触发的那套（ORM）单方面决定了用户体验**，而它默认没人接。
判断这类问题的信号是：**同一列既出现在业务的 `expected_version` 里，
又出现在 ORM 的 `version_id_col` 里**。

## 8. 附带修正：题目范围不看日期

用户同时澄清了范围的根本原则：

> 队列里面的题目宫殿就是出现在上方进度条的那些宫殿……这是根本原则，
> 而不是看今天昨天。

核对结论：**代码本来就符合**，本次未改动。

- `round_plan.review_palace_ids` 与 `removed_review_palace_ids` 只遍历本轮计划里的
  `original_cards`，**完全不读日期字段**。
- 前端进度条读 `roundPlan.orderIds` / `cardsById`，与题目范围同一份数据。
- `roundPlan.today` 只用于在进度条上画「欠账 | 今天」的分隔线（`freestyleProgressSegments.ts:627`），
  **不参与任何范围过滤**。

已用真实数据复核：`随心 2` 的 15 座宫殿 = 进度条上的 15 座 = 题目来源的 15 座。

## 9. 第五次修订：修了一半 + 一个被掩盖的错误（2026-10-09）

用户发来截图：**「保存随心做题进度」500**，随后是 **「做题进度尚未同步」** 和一连串 503。

这次有**两个叠加的缺陷**，而且第二个把第一个的错误信息吃掉了。

### 9.1 缺陷一（我的遗漏）：只修了一条写路径

第 4 节的修法把提交收敛到 `round_commit.commit_operation`，但**只改了
`round_state_service.py`**。`round_overlay_service.py` 是**另一条独立写路径**
（做题 ensure / progress / 结算清理），它里面还有 **3 处直接 `session.commit()`**，
完全绕过那个边界。

所以 `做题 progress` 仍然会抛 `StaleDataError` → 500。
日志里被埋住的原始异常正是它：

```
sqlalchemy.orm.exc.StaleDataError: UPDATE statement on table
'freestyle_round_states' expected to update 1 row(s); 0 were matched.
```

**已修**：3 处全部改走 `_commit_operation`，失败时返回 `conflict: true`。
门禁从「只检查 `round_state_service`」扩展为**检查整个轮次写入面**
（`round_state_service` + `round_overlay_service`），任一处再出现裸
`session.commit()` 都会报错。

### 9.2 缺陷二（放大器）：锁跨线程释放，把错误掩盖并把锁卡死

原始异常的日志被这样一行取代了：

```
RuntimeError: cannot release un-acquired lock
    at core/runtime_storage_lock.py:112 in storage_write_lock
```

机制（已用受控实验证明，见下）：

1. 一次 flush **抛异常** → SQLAlchemy 把 ROLLBACK **推迟**到下次使用或 `close()`。
2. FastAPI 把同步端点和它的依赖清理**放在不同的线程池调用**里执行。
   于是那个推迟的 ROLLBACK 在**另一个线程**上触发
   `after_transaction_end` → 释放锁。
3. 锁是用 `threading.RLock` 实现的，**RLock 只能由持有它的线程释放**，
   于是抛出 `RuntimeError`。

这个 `RuntimeError` 造成两个后果，都很严重：

- **它替换了原始异常。** `finally` 里的异常会顶掉正在传播的异常，
  所以日志里看到的是锁的问题，而不是真正的 `StaleDataError`。
  排查时我被指向了完全错误的方向（去查备份/锁竞争）。
- **它让锁永久卡死。** `RuntimeError` 在 `finally` 里抛在 `lock.release()`
  **之前**，所以那把进程级锁再也没被释放。此后每个写者都等满预算然后失败：
  一次事件产生了**连续 55 个 `storage_busy` 503**，就是用户看到的
  「做题进度尚未同步，换设备前请确认同步完成」。

日志证据（同一天）：`cannot release un-acquired lock` 出现 **10 次**，
最早 **2026-10-07** —— 早于本次改动，是既有缺陷。
但 9.1 那个遗漏让它被高频触发：00:23:19 一个 500，之后 954 行日志里 **55 个 503**。

### 9.3 受控实验（先证明再改）

| 验证 | 结果 |
|---|---|
| `RLock` 跨线程释放 | `RuntimeError: cannot release un-acquired lock` |
| `Lock` 跨线程释放 | 正常释放 |
| 卡死后其他线程再取锁 | `StorageBusyError`（等满 0.52s） |
| 真实应用路径探针 | `acquire on MainThread` → `release on worker-B`（**跨线程确认**） |

第 4 项是决定性证据：用一个**会抛异常的 flush**（故意不填 NOT NULL 列）
复现了真实时序——`after_flush` 不触发，锁留在会话上，
最后由清理线程的 ROLLBACK 释放。

### 9.4 修法

**缺陷一**：`round_overlay_service` 的 3 处提交改走 `_commit_operation`。

**缺陷二**：把 `RLock` 换成 `threading.Lock`。这把锁是**互斥保护**，
不是**所有权令牌**：谁做完谁释放，跨线程是合法的。
重入不靠 RLock，改成**自己按线程计数**（`_state.held` 字典）：
嵌套调用只增加本线程的计数，最外层帧才真正释放。
另外 `finally` 里加了防御——释放异常不再吞掉正在传播的原始异常。

### 9.5 端到端验证（真实库副本）

| 检查 | 结果 |
|---|---|
| 截图那个请求 | **500 → 200** |
| 过期版本重放 | 200 + `conflict: true`（前端据此重试） |
| 连续 5 次写入 | 全部 200，**无 503** |
| 评分端点 | 200，57 题，只读（版本不变） |

### 9.6 教训

**1) 修「所有写路径」时，必须先枚举写路径。**
我上一轮只改了名字最像的那个文件（`round_state_service`），
而 `round_overlay_service` 是同一张表的第二条写路径。
判据不是「我改的函数对了吗」，而是「**这张表还有谁在写**」。
这次把门禁从单文件改成覆盖整个写入面。

**2) 清理阶段的异常会吃掉真正的错误。**
这次真正的原因（`StaleDataError`）在日志里完全看不到，
我一开始去查锁和备份，方向是错的。
`finally` / 上下文退出里的代码**绝不能抛异常**，
否则它会替换掉正在传播的异常，把一个可诊断的 bug 变成不可诊断的。
这条已写进修复注释。

**3) 「被掩盖的错误」本身也是缺陷，而且优先级更高。**
掩码错误把一次 500 放大成 55 次 503，
因为它破坏了系统恢复的能力（锁再也回不来）。
遇到 `cannot release ...` / `during handling of the above exception`
这类信号时，**先修掩盖，再修被掩盖的那个**。
