# 0001 — 「复习会话仍在加载，评分暂不可用」：一个被测量工具带偏了三轮的故障

**状态**：已定位根因并修复仪器 + 止血；结构性预防见「防复发」一节
**首次记录**：2026-10-07
**影响**：随心模式无法评分；单日 398 次请求失败、284 次数据库写入被拒

---

## 1. 用户看到的现象（人话）

在随心模式里，卡片打开后底部一直显示：

> 复习会话仍在加载，评分暂不可用…

按 忘记/困难/记得/轻松 没有反应。有时等十几秒后弹出一大段红字，
例如（2026-10-07 13:09，宫殿 44「马克思和恩格斯」）：

```
服务器内部错误，请查看服务端日志。
请求：POST /api/v1/review/units/<unit>/sessions
HTTP 状态：500
```

同一张卡反复重试都失败，且**越等越久**。用户报告：「每次一到马克思恩格斯这里就要报错」。

## 2. 实际发生的机制

SQLite 在 WAL 模式下**允许多个读者、但只允许一个写者**。当第二个写请求到来时，
它会等待 `busy_timeout`（本项目 10 秒），然后抛出
`sqlite3.OperationalError: database is locked`。

关键点：**撞锁的请求本身没有任何问题**。日志证明它几乎不花时间做正事：

```
POST /review/units/e2ae647b.../sessions -> 500 in 51654.09ms
  sql_count=43  sql_total_ms=10871  sql_max_ms=10832
```

51.6 秒里有 10.8 秒是"等在锁上"，其余是重试与开销；真正属于这次请求的工作是毫秒级。

## 3. 为什么修了三轮还在（本文档的核心价值）

仓库里同时躺着两份**互相矛盾**的分析：
`storage-lock-contention.md`（2026-10-07）与
`database-locked-root-cause.md`（同日，开头写明"取代前一份"）。
三轮修复分别调整了等待时间、缩小了应用锁范围、给若干查询加了 `no_autoflush`——
**都在修"锁的表层"，没有一轮定位到"谁占着锁、占了多久"。**

### 3.1 测量工具本身是坏的（已用受控实验证明）

第一版看门狗在 `after_begin` 开始计时，把任何超过 3 秒的事务记为
`write transaction held ... opened at <frame>`。它有两个缺陷：

1. **把纯读取当成写入。** 在临时数据库上跑的探针显示：一个只执行 `SELECT 1`
   的会话也会启动计时器，且没有 origin，于是被记为
   `write transaction held ... opened at unknown`。生产日志里 `unknown` 出现 10 次。
2. **把受害者当成凶手。** 被锁阻塞的请求，其事务同样会"打开"并持续整整一个
   `busy_timeout`，而 origin 记录的是**它自己尝试写入的位置**。生产日志中：

```
DELETE ... failed=True after 10847ms
write transaction held 14.83s opened at ..._delete_open_unrated_encounters
```

——`failed=True` 说明这次 DELETE **没拿到锁**，却被报告成"持有 14.83 秒"。
同样地，`settings/presentation/router.py:180` 被点名为持有者，而那一行**就是
`session.commit()` 本身**；`_remember_operation` 是提交前的最后一步，紧接 commit。
它们按定义不可能"持有"。

**结论：前两轮修复是照着"受害者名单"去修的。** 这解释了为什么同一个毛病换一副面孔回来。

### 3.2 真正缺失的是因果链

后端**支持**接收并回显 `X-Request-ID`（`core/request_logging.py` 会把它写进每一行日志），
但 `apps/web/src` 里**没有任何地方发送它**。因此：

- 请求超时 → 浏览器**拿不到响应** → 拿不到服务端生成的 id；
- 用户复制给 AI 的那段红字里，**没有一把能与服务器日志对上号的钥匙**。

于是每次排查都只能靠时间戳猜。

### 3.3 一处真实的调用缺陷

`startFreestyleUnitReviewSessionApi` 的注释写着它"fails fast into its own retry path"，
但那条路径**是一个手动按钮**。该请求以 `persistence: false` 刻意不进重试队列
（合理：陈旧重放会重开用户已经翻过的 encounter），却因此**完全没有继承 503 重试行为**。
用户手动重试又会重新进入同一场争用——卡片看起来永久损坏。

## 4. 证据清单

| 证据 | 来源 |
|---|---|
| 单日 398 次失败、284 次 `database is locked` | `logs/pwa-api.log` |
| 51.6 秒失败 / 10.8 秒等待 / 毫秒级实际工作 | 同上 |
| 看门狗把 `unknown` 与被阻塞调用报为持有者 | 同上，2026-10-07 12:22–13:10 |
| 只读会话也会启动看门狗计时 | 受控实验（临时数据库，`SELECT 1`） |
| 前端从不发送 `X-Request-ID` | `apps/web/src` 全量检索，仅测试文件出现该字符串 |

## 5. 已做的修复

1. **修正仪器**（`infrastructure/db/_tables/_base.py`）
   - 只在会话真正暂存了写入时才计时（读路径完全不进入）；
   - 计时从**首次成功 flush** 开始，而不是 `after_begin`；
   - 明确区分两种结论：`write transaction HELD ...`（持有者）与
     `blocked ... WITHOUT ever acquiring ...`（受害者）。
   - 四条回归测试固化：读不被误报、持有者被点名、受害者被标为受害者、健康时静默
     （`tests/test_open_write_transaction_watchdog.py`）。

2. **补上因果链**（`shared/api/http.ts`）
   - 每个请求发送 `X-Request-ID`；调用方已指定时沿用，使**同一动作的重试共用一条线索**；
   - 重放请求保留原 id（`mutationQueue` 的 `buildReplayHeaders` 已透传）。

3. **止血：撞锁不再变成"服务器内部错误"**
   - `infrastructure/db/lock_errors.py`：精确识别锁竞争，且**只**识别锁竞争
     （`no such table` 等仍为 500，否则会诱导客户端无限重试）；
   - `app/error_handlers.py`：锁竞争按 503 + `Retry-After` 返回，与应用锁的行为一致；
   - `shared/api/busyRetry.ts`：会话开始 POST 在 503 时自动有界重试（3 次，共约 3 秒），
     完成后才诚实地报错。服务端按 `encounter_id` 幂等，重试安全。

4. **修掉最高价值的一处真实触发点**
   `settings/presentation/router.py::write_client_preferences`：循环内"先查后插"，
   第二次迭代会 flush 第一次暂存的行。这是日志里 46 条
   `Query-invoked autoflush` 的形状。已用 `no_autoflush` 修正，并把理由写成注释。

## 6. 防复发（构建期门禁，已验证"有牙齿"）

`tools/check_architecture.py::check_db_write_lock_hygiene` 新增三类**结构性**检查，
不是针对单个 bug 打补丁：

1. **自动刷写检测器**：扫描"暂存写入后又读数据库"的函数，并且**单独处理循环体**——
   循环里"读在前、写在后"的写法用线性扫描看不出来，而那正是
   `write_client_preferences` 的形状。检测器对每个函数最多报一处，因为可执行的修复
   单位是函数（加一次 `no_autoflush` 覆盖整个循环体）。
2. **前台路径禁做重活**：presentation 层不得触发 `checkpoint_sqlite_wal` /
   `analyze_database`。
3. **分类器必须精确**：`lock_errors.py` 必须按锁消息匹配，禁止按异常类型
   （`sqlite3.OperationalError` 也涵盖建表失败和 SQL 错误，那些不可重试）。

**已验证有效**：故意植入"线性先写后读"和"循环内先读后写"两种违规，门禁都会失败；
植入安全写法（read 在 stage 之前、commit 之后才读）不误报。

**基线机制**：引入时发现 8 处既有的同类写法（都在启动/管理路径，不在学习热路径），
登记在 `BASELINE_STAGED_THEN_READ`。其中 `write_client_preferences` 已在本轮修掉，
条目随即删除。任何条目若不再匹配实际代码，门禁会失败——所以这份清单**只会缩小**，
不会悄悄扩大，也不会继续豁免已经修好的位置。

## 6.1 一条关于"检测器本身"的教训

第一版检测器**静默失效**：它复用了仓库里既有的 `_extract_function_body`，
而那个函数只认 JavaScript 的 `function name(...) { }`，对 Python `def` 永远返回 `None`，
于是循环体为空、门禁无条件通过。

**这与第 3.1 节是同一个失败模式：坏掉的仪器看起来和通过一样。**
因此本轮所有门禁都用"故意植入违规，确认它会失败"来验证，而不是只看它通过。

## 7. 尚未修复的部分（诚实登记）

撞锁的**根因侧**——即"谁在长时间持有写事务"——本轮把仪器修好了，
但还没有拿到一次干净的现场读数。已知的**第二个独立冻结源**：

`write_storage_backup` 在 `storage_backup.py:220` 执行
`checkpoint_sqlite_wal(require_complete=True)`，而共享锁在 **229 行**才获取——
这个"整库 checkpoint"动作**跑在锁外面**，由每次编辑保存、每 5 分钟定时循环、
启动和关机触发，作用在 197 MB、位于 U 盘、Syncthing 正在同时读写的文件上。
它用 `engine.begin()`，本身就是一次写事务。

注意：上面第 2 类门禁只覆盖 **presentation 层**，而这条路径在 application 层 +
启动流程，因此**尚未被门禁覆盖**。这是下一步。

下一步：用 `tools/watch_lock_holder.py`（进程外观测，不依赖已知有偏的仪器）
在真实学习负载下抓一次现场，并把 checkpoint 从锁外挪进锁内、
由 `TRUNCATE` 降级为非阻塞模式。
