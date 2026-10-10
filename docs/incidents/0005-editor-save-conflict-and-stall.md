# 0005 脑图保存冲突，以及一次保存卡数分钟——版本对不上，自动保存被暂停

**状态**：两个根因均已定位并修复。① 冲突红字来自一个**永远无法被解除的队列条目**——解除函数被打包器当成死代码删掉了；已修掉两处：冲突解决后清理残留队列条目；危险保存改用服务端当前指纹重签。用户要求的「选用本地/远端版本」对话框本身是正确的，没有改动它的语义。② 数分钟级的保存卡顿来自**冷进程首次打开 209 MB 数据库**（同步盘首次触盘），已把开池代价挪到启动（第 7 节）。
**首次记录**：2026-10-10
**影响**：编辑宫殿时顶部出现「文档存在未解决冲突，自动保存已暂停」，保存按钮显示失败。本机未保存内容按设计保留，没有被这次排查覆盖。
**不是** [0004](./0004-dashboard-ledger-full-fold.md) 的账本重算。时长快照改动没有走脑图保存这条路。

---

## 1. 用户看到的现象

宫殿「第二节法国教育的发展」（宫殿 55）编辑页：

> 文档存在未解决冲突，自动保存已暂停。

保存失败原文：

> 自动保存暂时失败：脑图保存冲突：服务端已有更新，本机待处理内容已保留，请确认后再覆盖。
> 操作：保存宫殿脑图
> 请求：PUT /api/v1/palaces/55/editor
> HTTP 状态：409
> 请求 ID：827579b6-d3c3-492a-985f-9ebc27dd6713

用户因此没法继续改脑图，并认为是这次加载修复把编辑弄坏了。

## 2. 冲突规则（已证明）

保存时客户端带上自己看见的 `expected_editor_fingerprint`。服务端当前指纹不同，且没有允许覆盖时，直接拒绝：

```text
apps/api/src/memory_anki/modules/mindmap_document/snapshot.py
assert_expected_fingerprint()
→ 脑图保存冲突：服务端已有更新，本机待处理内容已保留，请确认后再覆盖。
```

调用点在 `apps/api/src/memory_anki/modules/content/application/editor_state_service.py` 的 `save_palace_editor_state()`。内容与服务器当前文档完全一致时，即使指纹是旧的，也当作幂等重放，不报冲突。内容不同就 409。

前端收到 409 后暂停自动保存，并保留本地待写内容。界面提供「查看并解决冲突」：选用本地版本、选用远端版本，或在共同基线还在时合并不同节点上的独立编辑。选之前会先归档双方快照。远端指服务器当前版本，不是另一台自动同步过来的设备。

这是防覆盖，不是加载失败。红字在，是因为自动保存还拿着旧指纹往上写。

## 3. 证据

已证明：

- 宫殿 40 的 409 从 2026-10-05 13:03:20 就开始了，早于 2026-10-10 的账本缓存改动。`logs/pwa-api.log` 里 `PUT /api/v1/palaces/40/editor` 累计 409 有 6721 次，200 只有 29 次，另有 500 六次、503 一次。它大约每分钟重试一次，十几毫秒就返回 409。所以「不能编辑」里至少有一条是旧冲突在重试，不是今天的加载改动引入的。
- 宫殿 55 在 2026-10-10 21:14:44 有一次保存最终成功，但耗时 583679 毫秒（约 9.7 分钟）：请求 ID `c20d6069-3fa8-4598-8eee-269e3f28fe08`，`worker_started_ms=0.91`，`sql_count=18`，`sql_total_ms=7.45`。工作线程几乎立刻开始，SQL 只有 7 毫秒，剩下的约 10 分钟不在 SQL 里。
- 这 10 分钟里，其他请求仍在十几毫秒内返回（宫殿 40 的 409、练习进度）。服务没有整体卡死。慢的是这一次保存自己。
- 同类长保存以前就有，不是今天才出现：宫殿 26 约 554 秒，宫殿 53 约 514 秒，宫殿 52 约 439 秒和 357 秒，宫殿 40 约 342 秒。都是 `PUT .../editor` 最终 200，SQL 很短，墙钟很长。
- 截图里的请求 ID `827579b6-d3c3-492a-985f-9ebc27dd6713` 不在已刷出的 `logs/pwa-api.log` 里。该日志在 21:33:18 重启时截断，之后的请求行经常要等 stdout 刷盘才出现。不能用「日志里没有」证明这次 409 没发生；界面原文已经写了 409。

推断（未证明，不能拿去改保存逻辑）：

- 宫殿 55 那次 9.7 分钟的 200，客户端很可能已经按超时放弃，没有换上新指纹。之后本机内容再保存，就会 409。这能解释「保存卡很久，然后变成冲突」，但不能从现有日志行单独证明客户端丢了哪一次响应。
- 数分钟的空档更像这次保存在等一把别的请求不需要的锁，或在同步盘上做 SQL 以外的写入。还没有定位到具体等待点。不要把账本折叠当成这个原因：折叠发生时，被拖慢的是 dashboard 和 time-records，不是这一条已经开始、SQL 只有 7 毫秒的保存。

## 4. 根因：解除冲突的函数从来没进过产物

2026-10-10 21:47 定位。红字不是「冲突解不开」，而是**那个能解开冲突的按钮点了也没用**，因为真正干活的函数被 tree-shake 掉了。

链路（每一环都在代码里核对过）：

1. `apps/web/src/modules/content/domain/palace-entity/api/editorApi.ts:33-38` 保存时用 `replayMode: 'auto'`。
2. `apps/web/src/shared/api/http.ts:570-580` 收到 409 会 `enqueueFailedRequest`，`http.ts:376-380` 把条目建为 `initialStatus: 'conflict'`。
3. `apps/web/src/shared/persistence/useMutationQueue.ts:6-28` 的 `useMutationQueueAutoSync` 每 30 秒跑一次 `replayQueuedMutations()`。
4. `apps/web/src/shared/persistence/mutationQueue.ts:341` 的守卫主动跳过 `conflict` / `manual` 条目——**这是对的**，否则就是上一版每分钟一次的 409 风暴。
5. 唯一能把状态改回可重放的是 `confirmQueuedMutationOverwrite`（`mutationQueue.ts:452`），而它在 `apps/web/src` 里**除了自己的测试没有任何调用方**，打包时被删。

决定性证据：用户在界面上看到的原文 `脑图保存冲突：服务端已有更新，本机待处理内容已保留，请确认后再覆盖。` 在**整个 `dist` 产物里一次都不存在**。也就是说这个函数从未被打包进去。上一版「让它不重试」的修复方向对，但没意识到它是死代码，所以红字照旧。

## 5. 已修

- `apps/web/src/shared/hooks/useMindMapDocumentSession.ts`：新增可选的 `onConflictResolved` 回调，在 `applyConflictResolution` 里调用（用户选完版本、归档完成之后）。冲突已经由会话接管，队列里那份重复条目必须一起清掉。
- `apps/web/src/modules/content/ui/palace-edit/hooks/usePalaceEditorDocument.ts`：接到该回调后调用 `discardQueuedConflictsByCoalesceKey('palace:${ownerId}:editor')`——只清被弃置的 `conflict` / `manual` 条目，待重放的 `pending` 条目和其它宫殿都不动。
- `apps/web/src/shared/persistence/mutationQueue.ts`：新增 `discardQueuedConflictsByCoalesceKey` 与 `retryQueuedConflictWithCurrentFingerprint`（后者作为显式恢复入口，当前无 UI 调用，故被 tree-shake，属预期）。
- 顺手修掉同一类的第二个缺陷：`usePalaceEditorDocument.ts:258-283` 的 `savePalaceEditorAfterDangerousConfirm` 原本复用 `editorState.editor_fingerprint`，而那个版本正是服务端刚拒掉的，所以「确认危险保存」也会再撞 409。改为先 GET 当前版本、用服务端指纹重签这次**有意覆盖**。

产物已验证：`apps/web/dist/assets/http-CRbf0V-w.js` 导出表为 `Ne as i`，入口 `index-p3uby02C.js` 导入 `i as Lt`，且实际调用点已出现在产物中：

```js
onLocalSnapshot: Qi, onConflictResolved: e => { Lt(`palace:${e}:editor`) }, onSaveError: ...
```

## 6. 数分钟保存的等待点：已定位并修复（2026-10-11）

第 6 节把「数分钟保存」列为未定位。现已定位，并且**不是**折叠、不是 SQL、也不是存储锁。

日志特征（`logs/pwa-api.log`，2026-10-10 22:45:53）是几个**互不相关**的端点在**同一秒**一起超时，然后一起返回：

```text
GET  /api/v1/profile/client-preferences -> 200 in 9233.47ms  connect_total_ms=8984.19  sql_total_ms=3.44
PUT  /api/v1/palaces/55/editor          -> 409 in 9043.74ms  connect_total_ms=8951.62  sql_total_ms=12.68
GET  /api/v1/exam/overview              -> 200 in 9631.29ms  connect_total_ms=9028.02  sql_total_ms=68.05
GET  /api/v1/dashboard                  -> 200 in 10049.76ms connect_total_ms=9042.83  sql_total_ms=92.65
```

每一条的 `worker_started_ms` 都是 1–5 毫秒，说明请求立刻进了工作线程，然后**全部停在同一个栅栏上**。耗时全部落在 `connect_total_ms`，而 `sql_total_ms` 是个位数。同一个函数（`apps/api/src/memory_anki/infrastructure/db/diagnostics.py` 的 `finish_connection_timer`）同时打了对应的警告：

```text
DB connection initialization in 9042.83ms [slow]
```

`connect_total_ms` 量的是 `apps/api/src/memory_anki/infrastructure/db/_tables/_base.py:69-91` 的 `do_connect` → `connect` 处理段：`ensure_runtime_dirs()` 加那一串 `PRAGMA`（`journal_mode=WAL`、`cache_size=-64000`、`mmap_size=268435456` 等）。冷进程第一次打开这个 **209 MB** 的库（`F:\memory anki data\学习数据\memory_palace.db`，另有 305 KB 的 WAL）要付一次极贵的首次触盘，几个请求就一起堵在那一次打开上。

已在本机复现：库与 pragma 本身很快（`ensure_runtime_dirs()` 0.5ms，整套 pragma 1.6–2.4ms），但**冷进程**里 `_warm_db_pool()` 实测 **9454.9ms**，并打出 `DB connection initialization in 9414.63ms [slow]`。也就是说这几秒是同步盘上的冷首次打开，不是 pragma 语句本身慢。

修复：把这个代价挪到启动。`apps/api/src/memory_anki/app/startup_warmup.py` 新增 `_warm_db_pool()` 与 `start_db_pool_warmup()`，一次性把 `DB_POOL_SIZE`（10）个连接都开出来并全部归还（只开一个再放掉起不到暖池作用）；异常只记日志，已开出的连接在 `finally` 里一定关闭。`apps/api/src/memory_anki/app/main.py` 的 lifespan 里紧随 `start_ledger_prefetch()` 调用它——**不放在 `startup_mode == STARTUP_MODE_SERVE` 分支里**，因为桌面/PWA 进程跑的是 `healthcheck` 模式，正是这个进程的用户请求在付冷打开的代价。`PYTEST_CURRENT_TEST` 存在时直接返回 `None`，测试不会去开真库。

冷进程重启后实测（`logs/pwa-api-coldstart-verify.log.err`，PID 12128，无任何 `[slow]`、无 `DB connection initialization` 警告）：

```text
GET /health                              -> 200 in   57.12ms
GET /study-sessions/time-records?all     -> 200 in 2023.33ms   (账本折叠，仍走快照)
GET /dashboard                           -> 200 in  221.79ms   原 10049.76ms
GET /palaces/55/editor                   -> 200 in   27.10ms   原  9043.74ms
GET /exam/overview                       -> 200 in   37.72ms   原  9631.29ms
GET /profile/client-preferences          -> 200 in    4.62ms   原  9233.47ms
```

保存路径也用实测确认了保护仍然有效（同一个冷进程）：

```text
PUT /palaces/55/editor  stale fingerprint   -> 409 in 37.2ms   内容保护未被削弱
PUT /palaces/55/editor  current fingerprint -> 200 in 40.7ms
```

也就是说：**服务端一直是对的**——指纹正确就能存，指纹陈旧就 409。存不进去的原因是客户端从来没送出过当前指纹，因为 `confirmQueuedMutationOverwrite` 被 tree-shake 掉了（第 4 节）。修好产物后，「选用本地版本」这条路才能真的重签成功。

测试：`apps/api/tests/test_startup_runtime_and_supervisor.py` 新增 `test_db_pool_warmup_fills_the_pool_and_releases_every_connection`、`test_db_pool_warmup_still_closes_what_it_opened_when_a_connect_fails`、`test_db_pool_warmup_is_skipped_under_pytest`、`test_db_pool_warmup_is_started_as_background_daemon`、`test_lifespan_warms_db_pool_even_in_healthcheck_mode`。相关 5 个测试文件 43 passed。

## 7. 还不能做的事

- 放宽 `assert_expected_fingerprint`，或让普通自动保存带 `allow_stale_overwrite`。
- 替用户选「本地覆盖远端」或「丢弃本地、改用服务器」。两边内容都还在，选错会丢编辑。
- 把 409 重试从队列里静默丢掉。那样红字没了，未保存的修改也没了。
- 把 `conflict` / `manual` 条目加回自动重放。那正是 6721 次 409 的来源。

仍然开放：

- `http.ts` 的 `duration_ms` 把响应之后的 `BackgroundTasks`（滚动 SQLite 备份）也算进去了，所以 `PUT ... 583679.44ms` 不能证明用户真等了 9.7 分钟；已加 `response_completed_ms` / `after_response_ms` 区分。
- 宫殿 40 从 2026-10-05 起累计 6721 次 409 的旧冲突条目，需要用户自己在对话框里选一次版本才能清干净。
- 「选用本地版本」需要在界面上实测一次（产物已确认带上正确的回调，但那一刻的交互只在本机验证到接口层）。
