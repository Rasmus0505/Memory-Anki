# Memory Anki — 项目长期约定

## 超时预算（有意的分层，改任何一个都要一起看）
四层从内到外，必须保持「内层先失败」：
1. 服务端 SQLite 锁等待：`SQLITE_LOCK_WAIT_SECONDS = 10`（`infrastructure/db/_tables/_base.py`，
   同时喂给 `connect_args.timeout` 与 `PRAGMA busy_timeout`）。
2. 写请求传输超时（仅显式 opt-in）：`SESSION_START_TIMEOUT_MS = 15_000`
   （`modules/practice/ui/review/api/unitReviewApi.ts` 的会话启动 POST）。
3. 读请求传输超时：`GET_REQUEST_TIMEOUT_MS = 20_000`（`shared/api/http.ts`）。
4. 应用层兜底：`SESSION_LOAD_TIMEOUT_MS = 30_000`（`freestyle/model/freestyleUnitReviewSession.ts`）。

规则：**写请求默认不设传输超时**（`http.ts` 的 `PersistedRequestInit` 不传 `timeoutMs`），
让 mutation queue 保持唯一权威。唯一的例外是调用方自己重试、且显式 `persistence: false`
的写请求 —— 目前只有复习会话启动 POST。新增此类例外要同时改
`docs/architecture/freestyle-immersive-feed.md`。

**第 0 层（最容易漏，2026-10-05 因此炸过一次，当天已修）**：SQLAlchemy 连接池 checkout 超时。
`_base.py` 现在显式声明这五层，**从内到外必须保持递增**：

| 层 | 常量 | 值 |
|---|---|---|
| 池 checkout | `DB_POOL_TIMEOUT_SECONDS` | 5s |
| SQLite 写锁 | `SQLITE_LOCK_WAIT_SECONDS` | 10s |
| 会话启动 POST | `SESSION_START_TIMEOUT_MS` | 15s |
| 读请求 | `GET_REQUEST_TIMEOUT_MS` | 20s |
| 应用层兜底 | `SESSION_LOAD_TIMEOUT_MS` | 30s |

池容量：`DB_POOL_SIZE=10` + `DB_MAX_OVERFLOW=20`。池是**读并发预算**，
SQLite 靠 busy_timeout + WAL 自己串行化写，所以不需要靠池限流写者。

回归防护已就位：
- `apps/api/tests/test_database_performance_optimizations.py::
  test_engine_pool_checkout_timeout_is_innermost_budget`
- `tools/check_architecture.py::check_db_pool_budget`（挂进 main，
  改大 `DB_POOL_TIMEOUT_SECONDS` 会红）
- 文档：`docs/architecture/read-models.md` 的「Connection pool budget」

未修时症状：池最后一条连接等 SQLAlchemy 默认 30s 后抛 `sqlalchemy.exc.TimeoutError`，
所有并发请求集中在 30s 后返回 500（`in 30xxx ms`），少数请求 34s 后才 200，
而前端早在 15s 断开 → 客户端/服务端状态分歧。排查信号：
日志出现 `QueuePool limit of size 5 overflow 2 reached`。

## 前端并发读去重
`shared/api/inFlightRequest.ts`：`shareInFlightRequest(key, loader)` 把同 key 的并发读
合并成一次请求，settle 即释放（**不是**缓存，不会返回陈旧数据）。
与 `shared/api/promiseWarmupCache.ts` 的区别：后者是**一次性消费**语义
（`consumePrefetchedPromise` 会 delete），适合 prefetch；前者是**共享**语义，
适合「多个组件同 tick 各拉一次同一接口」。
mutation 必须调 `invalidateSharedRequest(key)`，key 由 API 模块统一导出
（如 `quizApi.ts::palaceQuizNodeBindingsCacheKey`），不要在调用点硬编码字符串。

## 随心「完成」按钮 seek 语义（b21abb7a 起）
- 唯一评分内核：`modules/practice/domain/unitProgressState.ts`。`完成` 的目标 = 
  `findUnscoredCompleteSeekIndices` → `unscoredOccurrenceIndices`（排除 hidden、plan `status==='excluded'`、
  黄提示 `review_hint:*`、Unit 级 removal shadow）。
- 循环：`resolveFreestyleCompleteSeek`。已在未评分卡上再点 → `pending[(at+1)%len]`（回绕）。
  `null` 表示无处可去（只剩一张且已在其上 / 已在结算槽 / 空 feed）。别把 `null` 误当"应结算"。
- 「移除本队列」= `useImmersiveQueue.excludePlanCards`（本地乐观 `hideCards` + 从 `cards` 物理过滤 +
  后台 `action:'exclude'` + `buildQueue(forceExcludedIds)`）。被移除卡**永不**是 `完成` 目标。
- 回归测试：`hooks/useFreestyleFeedNavigation.complete.test.tsx`（循环 + 移除/hidden/excluded 不参与）、
  `model/roundCompletion.test.ts`、`domain/unitProgressState.test.ts`。

## PWA 旧 bundle 坑（怀疑用户"改了没生效"时先查这个）
- `apps/web/dist/releases/*` + `release.json` 可能指向旧 build；`registerServiceWorker.ts` 的
  `announceReadyUpdate` 只在 controllerchange 且用户**空闲 30s** 才自动 reload，持续操作时永不切。
- 桌面端重启即换 bundle，故常出现"桌面好了、PWA 没好"。强刷：toast「立即刷新」、
  `/pwa-reset.html`、彻底关闭 PWA 重开。

## 后端日志配置
- `core/logging.py::configure_logging()` 可用 `force=True` 重复调用。
- **Alembic 每次启动都会 `fileConfig` 覆盖 root**（重置为 WARN + alembic 格式，
  默认还会 `disable_existing_loggers=True`）。因此 `app/startup_runtime.py` 必须在
  `init_db()` **之后**再调一次 `configure_logging()`；`alembic/env.py` 也必须显式传
  `disable_existing_loggers=False`。删掉任何一处，`logs/pwa-api.log` 就只剩启动日志。
- 请求日志在 `core/request_logging.py`，`memory_anki.request` logger，
  超过 `SLOW_REQUEST_THRESHOLD_MS = 3000` 升级 WARNING（`/stream` SSE 路径豁免）。

## 本机环境
- 后端测试/工具链用系统 Python 3.12：`C:/Users/Administrator/AppData/Local/Programs/Python/Python312/python.exe`
  （managed 3.13 未装项目依赖）。跑测试：`cd apps/api && PYTHONPATH=src <py> -m pytest`。
- 前端 vitest 用 `apps/web/node_modules/.bin/vitest run`。

## 已知基线红灯（非本次引入，改动前就存在）
- `ruff check src tests`：`modules/practice/domain/round_plan.py` 3 处 UP038（需 `--unsafe-fixes`）。
- `tools/check_architecture.py`：`round_plan.py` 867 行 > 800、`serverRoundPlan.ts` 755 行、
  `roundCompletion.test.ts` 805 行 > 750、`apps/web/pnpm-workspace.yaml` 存在（要求 npm-only）、
  `tools/pwa_server.py` 硬编码个人绝对路径。
- `apps/web/src/shared/components/ui/dialog.test.tsx` 有 1 个失败用例（居中 `top` 期望 300px 得 250px），
  属于进行中的弹窗居中改造。
- 故 `python tools/quality_gate.py` 在当前工作树上本来就是红的。
