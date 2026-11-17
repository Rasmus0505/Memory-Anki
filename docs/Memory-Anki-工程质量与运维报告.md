# Memory Anki 工程质量与运维报告

> 专项报告。总览见《[技术报告](Memory-Anki-技术报告.md)》。
> 本文讲**怎么判断一次改动能不能交付、出问题时看哪里、日常怎么运行和恢复**。

---

## 1. 统一门禁

所有本地开发、AI 修改和 CI 都走同一个入口：

```bash
python tools/quality_gate.py
```

完整交付：

```bash
python tools/quality_gate.py --full
```

启动器冒烟（改动运行时启动、打包、迁移、依赖、前端构建产物或启动脚本后必须跑）：

```bash
python tools/quality_gate.py --launchers
```

### 1.1 快速门禁包含什么

| 步骤 | 内容 |
|---|---|
| architecture | `python tools/check_architecture.py` |
| architecture tests | 架构检查脚本自身的测试 |
| data integrity tooling tests | 数据完整性清单工具测试 |
| backend ruff | `ruff check src tests` |
| backend mypy | 全包类型检查 |
| backend imports | `lint-imports`（import-linter 三条契约） |
| frontend lint | ESLint，`--max-warnings 0` |
| frontend typecheck | `tsc -b --noEmit` |

### 1.2 完整门禁再加什么

- 后端 `pytest`；
- 前端 `vitest run`；
- 前端 `npm run build`；
- Playwright E2E（`npm run e2e`）。

构建支持隔离输出目录：`MEMORY_ANKI_VALIDATION_OUT_DIR` 必须是相对路径且不能是 `dist`，避免验证构建覆盖正在服务的产物。

---

## 2. 架构门禁

`tools/check_architecture.py` 当前有 **107 个检查函数**，门禁中实际执行约 **79 个**。覆盖的不是「代码风格」，而是**结构不变量**：

### 2.1 依赖方向

- 后端 `application` 不得 import `presentation`；
- 后端 `domain` 不得 import `application` / `presentation`；
- 后端 `application` 不得 import `platform.persistence`；
- 前端跨模块只能经 `public.ts`；
- 前端生成 API 边界、共享门面、消费者上下文边界；
- `shared` 不依赖 `app` 或业务模块。

### 2.2 运行时与数据

- 运行数据目录必须被 `.gitignore` 覆盖；
- `storage-layout.json` 必须声明 `学习数据` / `学科附件` / `日志缓存` 三个根；
- 工具脚本不得写死个人绝对路径；
- 数据库连接池必须显式设置 `pool_timeout`，且小于所有客户端预算；
- 迁移必须向前兼容（upgrade 可重入、不依赖运行时数据形状）；
- 读取投影不得写状态。

### 2.3 随心/排期/测验

大量检查专门锁住产品不变量，例如：

- 轮次计划权威、评分身份、重练 occurrence、结算压缩、跨天复活；
- 进度条刻度可跳转、视图两/三种分组、已结算刻度不回来；
- 评分内核唯一、源 → 重练方向、空白重练不继承；
- 做题范围只有一个所有者、出题范围不扩大宫殿集合；
- 题目发布状态不是练习门槛；
- 题目进度跨入口共享。

### 2.4 反馈与可视化

- 业务代码不得直接实例化 WebGL / WebAudio；
- `shared/fx` 不得 import 主题；
- 音色默认值、主题注册、粒子/皮肤已移除。

### 2.5 文件规模

- 前端单文件上限 **750 行**；
- 后端单文件上限 **800 行**；
- 超限文件必须登记在 `BASELINE_OVERSIZED_FILES`；
- 基线必须「诚实」：已删除或已拆分的文件仍留在基线里会让门禁失败，逼迫清理。

---

## 3. 类型与静态检查

### 3.1 后端

- ruff：`E/F/I/B/UP/T20`，行宽 100，Python 3.12；
- mypy：全包检查，插件启用 SQLAlchemy；禁止整模块 `ignore_errors`；
- import-linter：三条禁止契约，跨上下文只能走已登记的公共入口；
- Pydantic 请求/响应模型是 API 边界。

### 3.2 前端

- ESLint 零警告；
- `eslint-plugin-boundaries` + TypeScript resolver 强制目录边界；
- TypeScript `tsc -b --noEmit`；
- 生成 API 类型由 OpenAPI 产出，调用方不得手写第二套契约。

---

## 4. 测试体系

### 4.1 规模

| 层 | 文件数 | 内容 |
|---|---:|---|
| 后端 pytest | 128 | 领域规则、应用用例、路由、迁移、并发 |
| 前端 Vitest | 393 | 模型、reducer、hook、组件、集成 |
| Playwright E2E | 10 个 spec | 三条浏览器 project：桌面 Chromium、Pixel 7、iPhone 15 |

### 4.2 后端测试重点

- 排期规则（定锚、FSRS 护栏、恢复、冲刺、跨天）；
- 轮次计划与评分命令（幂等、冲突、重练、结算）；
- 题目进度与清除墓碑；
- 迁移向前兼容；
- SQLite 锁与超时；
- 读写分离与投影纯度。

### 4.3 前端测试重点

- 纯领域模型（`unitProgressState`、`roundCompletion`、进度分段）；
- 评分 outbox、保存失败重试、冲突采用；
- 脑图文档 reducer、折叠、草稿、冲突；
- 布局与响应式契约；
- 做题答案与共享进度。

### 4.4 E2E 的封闭性

E2E 不是「连上真实服务点一遍」，而是**完全封闭**：

- 所有 spec 从 `apps/web/e2e/fixtures.ts` 导入 `test` / `expect`；
- 未 mock 的 `/api/**` 一律返回 503，应用走离线路径；
- Service Worker 被阻断；
- Playwright `webServer` 设置 `MEMORY_ANKI_E2E=1`，Vite 移除 `/api` 代理；
- `reuseExistingServer: false`，绝不复用可能代理到 8012 的预览；
- `check_e2e_hermetic` 会在架构门禁中拒绝任何绕过。

这条规则的目的很直接：**E2E 永远不能写入真实的同步数据库**。

---

## 5. 启动器冒烟

```bash
python tools/quality_gate.py --launchers
```

它会：

1. 真正运行 `start-all.bat --smoke-test`；
2. 等 `/openapi.json` 就绪；
3. 真正运行 `start-all.bat --desktop`；
4. 通过 `logs/launch-status/desktop.json` 判断 Electron 是否失败；
5. 清理测试桌面进程；
6. 恢复共享 PWA 服务。

这是破坏性的 Windows 冒烟，所以只在改到启动、打包、迁移、依赖、构建产物或启动脚本时跑。

---

## 6. 构建与发布卫生

### 6.1 前端产物

- 每次构建写 release manifest：`dist/releases/<releaseId>.json`；
- `tools/clean_web_dist.py` 按清单保留最近产物，避免历史资源无限累积；
- 对 `PalaceEditPage`、`useMindMapImport` 写稳定 chunk 兼容别名，滚动更新时旧页面不会 404；
- vendor 分组白名单化，避免把 CJS interop 吸进首屏；
- 构建失败时服务会继续 serve 旧包，所以**白屏先查 `logs/pwa-build.log` 和 index hash**。

### 6.2 PWA 服务

```bash
python tools/pwa_server.py --prepare
python tools/pwa_server.py --build
python tools/pwa_server.py --stop
```

- `--prepare` 负责依赖/构建检查；
- `--build` 重建前端；
- `--stop` 停共享服务；
- 后端源码改动后必须重启，否则新前端可能对着旧字段名。

### 6.3 CI

`.github/workflows/ci.yml` 在 `windows-latest` 上跑两段：

- **Backend**：架构门禁 + 架构测试、ruff、mypy、import-linter、pytest；
- **Frontend**：lint、typecheck、test、build、安装 Chromium、E2E。

CI 不跑 `--launchers`（需要真实 Windows 桌面交互），启动器冒烟留在本地交接前执行。

---

## 7. 数据完整性与备份

### 7.1 数据完整性清单

`tools/data_integrity_manifest.py` + 对应测试会检查：

- SQLite `integrity_check`；
- `foreign_key_check`；
- 每张表的行数；
- 运行数据文件清单（相对路径 + 大小 + SHA-256）；
- 清单可比较（用于迁移前后、备份前后的对照）。

### 7.2 备份

- full / rolling / rescue 三类；
- 启动、关闭、周期性备份；
- 宫殿版本快照约 5 分钟节流，最多 50 条；
- 备份校验报告写入 `日志缓存/backup-verify-reports`。

### 7.3 恢复演练

```bash
python tools/verify_backup.py
python tools/verify_backup.py <备份目录>
```

只读操作：

- 复制备份数据库到临时目录；
- `PRAGMA integrity_check`；
- `alembic_version` 与生产库核对；
- 关键表行数对比；
- 输出 PASS/FAIL 报告；
- **绝不改写生产库或备份目录**。

恢复本身是显式操作，不会自动用旧备份覆盖当前库。

---

## 8. 日志与诊断

### 8.1 关键日志

| 文件 | 内容 |
|---|---|
| `logs/pwa-build.log` | 前端构建输出 |
| `logs/pwa-api.log` | 共享 API 服务输出 |
| `logs/last-launch-error.log` | 启动失败原因 |
| `logs/launch-status/desktop.json` | Electron 启动状态 |
| `logs/api.log` | 后端运行日志 |
| `日志缓存/ai_call_logs/` | 外部 AI 调用日志 |

### 8.2 请求关联

- 前端每个请求带 `X-Request-ID`；
- 后端把 request id 写进每一行日志并回传；
- 前端错误对象保留 request id，复制诊断时可以直接和后端日志对上；
- mutation id 用于幂等和重放排查。

### 8.3 诊断简报（会话录制）

- 左上角「录制」启动；
- 只采集白名单元数据：固定动作/页面类别、HTTP 方法、有限状态码、失败类别、有界数量；
- **不保存**题目、答案、脑图标题/正文、原始错误、完整 URL、业务 ID、请求/响应体；
- 用户手写说明单独保存；
- 旧版诊断历史在首次加载时删除，不迁移。

---

## 9. 性能与容量预算

| 预算 | 值 | 目的 |
|---|---|---|
| DB pool checkout | 5s | 池耗尽快速失败，早于所有客户端超时 |
| SQLite busy_timeout | 10s | 锁等待可完成，不无限挂起 |
| 读请求超时 | 20s | 半开连接变成可重试错误 |
| 随心会话启动 | 45s | 高于 busy_timeout，避免二次写入 |
| Query staleTime | 30s | 本地读取足够新，又不频繁打后端 |
| 前端文件 | 750 行 | 单文件可维护性 |
| 后端文件 | 800 行 | 单模块可维护性 |
| 脑图布局 | `nodeSizeMemo` | 900 节点时单次布局约 15ms，必须缓存 |
| 翻卡动画 | 关闭布局弹簧 | 避免点击被动画吞掉 |

---

## 10. 交接检查清单

### 10.1 代码改动

- [ ] `git status` 确认没有覆盖无关改动；
- [ ] 只 stage 本任务文件；
- [ ] 新路由已在 `routeManifest` 登记；
- [ ] 新跨模块调用走 `public.ts`；
- [ ] 新写接口接 mutation queue 或说明例外；
- [ ] 异步实体操作带 owner/operation；
- [ ] 新反馈走 `cue()`。

### 10.2 验证

- [ ] `python tools/quality_gate.py` 通过；
- [ ] 涉及完整套件时 `--full` 通过；
- [ ] 涉及启动/构建/迁移时 `--launchers` 通过；
- [ ] 架构文档/模块 `MODULE.md` 已同步；
- [ ] 新架构规则已在 `check_architecture.py` 加回归。

### 10.3 事实核对

- [ ] 文档里的命令、端口、路径与当前代码一致；
- [ ] 没有把已退役功能写回文档；
- [ ] 没有把「已知预存失败」误判成自己引入的回归。

> 仓库存在一组已用 stash 验证过的预存失败基线。判断回归前先确认基线，不要顺手「修」无关红。

---

## 11. 常见运维场景

### 11.1 白屏 / 旧界面

1. 看 `logs/pwa-build.log` 是否构建失败；
2. 看 `index.html` 引用的 hash 是否更新；
3. 后端源码改动后是否重启了 8012；
4. 强刷/清 Service Worker；
5. 仍不行再 `pwa_server.py --stop` 后 `--build`。

### 11.2 数据库锁

- 确认没有第二个应用实例或第二台设备在写；
- 看请求是否卡在 `busy_timeout`；
- 不要直接删 `-wal` / `-shm`；
- 停服务后让 WAL 静止，再同步/备份。

### 11.3 同步冲突副本

- 不要用冲突副本覆盖主库；
- 先保留文件；
- 用 `verify_backup.py` 或数据完整性清单检查可读性；
- 确认哪份是最新、哪台设备最后写入，再人工决定。

### 11.4 启动失败

- 看 `logs/last-launch-error.log`；
- 确认 8012 是否被非 Memory Anki 进程占用；
- 确认 `local_app_home` 存在且可写；
- 确认迁移是否卡住。

---

## 12. 快速命令

```bash
python tools/quality_gate.py
```

```bash
python tools/quality_gate.py --full
```

```bash
python tools/quality_gate.py --launchers
```

```bash
python tools/check_architecture.py
```

```bash
cd apps/api && python -m pytest
```

```bash
cd apps/web && npm run test
```

```bash
cd apps/web && npm run e2e
```

```bash
python tools/verify_backup.py
```

```bash
python tools/pwa_server.py --stop
```

```bash
.\start-all.bat
```
