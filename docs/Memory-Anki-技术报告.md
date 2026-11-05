# Memory Anki 技术报告

> 面向开发者、维护者和需要判断改动影响范围的人。
> 这是一份**总览**：讲清系统形态、技术栈、模块边界、运行链路和质量体系。
> 更细的专项报告：
> - 《[前端架构报告](Memory-Anki-前端架构报告.md)》
> - 《[复习调度与数据报告](Memory-Anki-复习调度与数据报告.md)》
> - 《[工程质量与运维报告](Memory-Anki-工程质量与运维报告.md)》
>
> 用户视角请看《[Memory Anki 用户视角介绍](Memory-Anki-用户视角介绍.md)》与《[前端布局](Memory-Anki-前端布局-用户视角.md)》。

---

## 1. 系统定位与技术约束

Memory Anki 是一个**本地优先、单用户、双设备**的 Windows 学习产品：

- 前端是同一套 React SPA，桌面端由 Electron 加载，手机 PWA 通过 Tailscale Serve 访问同一服务；
- 后端是一个本机 FastAPI 进程，同时提供 `/api/v1` JSON API 和已构建前端静态资源；
- 数据落在本机同步文件夹里的 SQLite（`memory_palace.db`）和附件目录；
- 跨设备同步完全在应用外完成，应用没有同步协议、同步配置或冲突合并逻辑；
- **同一时间只允许一台设备写 SQLite**，这是运行纪律，不是代码能完全兜住的事情。

这套约束决定了几乎所有技术选择：单进程、单写者、低运维、可离线、前端承担大量交互状态、后端只做权威账本。

---

## 2. 技术栈

### 2.1 后端

| 项 | 版本 / 选择 |
|---|---|
| Python | 3.12+ |
| Web 框架 | FastAPI 0.115 |
| ASGI 服务器 | Uvicorn 0.30（standard） |
| ORM | SQLAlchemy 2.0.35 |
| 数据库 | SQLite（WAL 模式） |
| 迁移 | Alembic 1.16（当前 85 个迁移文件，最新编号 0084） |
| 配置 | pydantic-settings + `.env` |
| 间隔重复 | `fsrs` 6.3.1（受控封装，不是裸用） |
| AI 接入 | OpenAI-compatible 协议；`dashscope` SDK 作为其中一种适配 |
| 文档处理 | PyMuPDF、pypdf、lxml、markdown |
| 测试/检查 | pytest、ruff、mypy、import-linter |

### 2.2 前端

| 项 | 版本 / 选择 |
|---|---|
| React | 19.2 |
| 构建 | Vite 8 + TypeScript 5.9 |
| 路由 | React Router 7.15 |
| 数据请求 | TanStack Query 5.100 |
| UI 基座 | Radix UI、Tailwind CSS 4.2、lucide-react |
| 思维导图 | `@xyflow/react` 12（懒加载） |
| 状态机 | XState 5.32（仅限 `application/workflows`） |
| 富文本/公式 | DOMPurify、marked、KaTeX、Turndown |
| 测试 | Vitest 3.2、Testing Library、Playwright 1.61 |
| 桌面壳 | Electron 39 |

### 2.3 运行端口

| 端口 | 用途 |
|---|---|
| `127.0.0.1:8012` | 日常唯一服务：API + 前端构建产物；Electron 和 PWA 共用 |
| `127.0.0.1:5173` | 仅显式前端开发（Vite dev server，`/api` 代理到 8012） |
| `127.0.0.1:4173` | Playwright 预览服务（封闭 E2E 专用） |

---

## 3. 仓库结构

```text
Memory Anki/
├── apps/
│   ├── api/                 FastAPI 后端（src layout）
│   ├── web/                 React SPA + PWA 资源 + E2E
│   └── desktop-timer/       Electron 壳（加载 8012，不内嵌业务）
├── tools/                   启动、构建、门禁、迁移、备份、内容处理
├── local-config/            每台机器自己的运行配置（gitignore）
├── runtime-data/            本地运行数据（原则上不提交）
├── docs/                    产品、架构、专项报告
├── start-all.bat            统一启动入口（PWA + 桌面 + 增量更新）
└── AI_PROJECT_CONTEXT.md    AI 会话的主上下文
```

`apps/api` 采用 `src/memory_anki` 布局；`apps/web` 只使用 npm，锁文件是 `package-lock.json`。

---

## 4. 运行时拓扑

```text
┌──────────────────────────────┐
│ Electron 窗口                 │
│   └─ loadURL(127.0.0.1:8012) │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐        ┌─────────────────────┐
│ FastAPI @ 127.0.0.1:8012     │◄───────┤ 手机 PWA            │
│  ├─ /api/v1/*                │ HTTPS  │ Tailscale Serve     │
│  ├─ 静态前端（dist）          │        │ （tailnet 私有）     │
│  └─ SSE /session/live/stream │        └─────────────────────┘
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│ SQLite WAL                   │
│ 学习数据/memory_palace.db     │
│ + 学科附件/ + 日志缓存/        │
└──────────────────────────────┘
```

要点：

- Electron 不打包前端，只加载本机服务；关闭 Electron 不会停掉 PWA 服务。
- Tailscale Serve 只做私有转发，禁止 Funnel 公网暴露。
- 前端和手机端通过进程内 **live room** 共享学习进度（SSE 推送），不写数据库、不跨设备同步。
- 启动脚本会做**指纹驱动的增量更新**：依赖、源码、迁移有变化才重建/迁移，否则复用现成服务。

---

## 5. 分层与依赖方向

### 5.1 后端

```text
presentation (FastAPI router)
      ↓
application (用例编排)
      ↓
domain (纯规则)  ←  ports  ←  infrastructure (适配器)
```

硬规则：

- `presentation` 不写业务流程、不直接堆 ORM 查询；
- `application` 不依赖 `presentation`；
- `domain` 不依赖 `application` / `presentation`；
- 跨模块只能走目标上下文声明的公共 `api` 入口；
- 事务归属显式：presentation 构造基础设施适配器，application 依赖 `UnitOfWork` 端口，只有适配器碰具体 ORM 事务。

这些方向由 `import-linter`（三条契约）、mypy 和 `tools/check_architecture.py`（约 80 个执行中的检查）共同强制。

### 5.2 前端

```text
app (壳/路由/Provider)
  → pages / widgets (页面组合)
    → modules/* (14 个运行时模块，统一 public.ts)
      → shared / platform / pwa
```

- `shared` 不依赖 `app` 或业务模块；
- 跨模块生产导入必须经 `public.ts`；
- 页面不直连后端 API，也不把领域逻辑写进 page；
- 业务模块之间不互相 import 私有实现。

---

## 6. 后端模块地图

后端当前有 **17 个有运行时代码的业务模块**，其中最大的几块：

| 模块 | Python 文件数 | 主要职责 |
|---|---:|---|
| `content` | 47 | 宫殿聚合、分段、导入导出、目录树、编辑器聚合保存 |
| `practice` | 45 | 随心 feed/轮次计划/评分命令、做题叠加层、轮次结算 |
| `quiz` | 37 | 题目增删改查、作答证据、题变体、绑定 |
| `memory` | 24 | 复习单元、排期、评分操作、FSRS 适配、到期投影 |
| `settings` | 23 | 模型注册表、提示词、复习参数、客户端偏好 |
| `reminders` | 20 | Bark 推送、定时投递、投递日志 |
| `exam` | 14 | 考期、星级权重、冲刺投影 |
| `backups` | 12 | 启停/周期备份、版本、恢复、校验 |
| `progression` | 10 | 经验/等级/委托/印章的只读投影（前端不展示） |
| `knowledge` | 9 | 学科、章节树、知识导入 |
| `produce` | 9 | JSON / Markdown / 整库导入导出 |
| `dashboard` | 8 | 仪表盘与进度读取模型 |
| `mindmap_document` | 6 | 纯文档规则、快照、序列化、指纹 |
| `session` | 6 | 学习会话与 live room |
| `search` | 5 | 全局搜索 |
| 其余 | — | 语言学习与查词等独立轨道（不参与宫殿排期） |

`mindmap_learning` 目录已退役（当前 0 个 Python 文件），不要重建。

后端挂载 **16 个 router**，全部在 `/api/v1` 下。

---

## 7. 前端模块地图

`apps/web/src/modules` 下有 **14 个运行时模块**，每个都有 `public.ts`：

`backup`、`content`、`dashboard`、`exam`、`english`、`english-lookup`、`memory`、`mindmap`、`practice`、`produce`、`quiz`、`search`、`session`、`settings`。

其中几个关键归属：

| 能力 | 前端归属 |
|---|---|
| 脑图文档规则 | `content/domain/mindmap-document-entity` |
| 通用画布 | `shared/ui/mindmap-canvas`（懒加载 xyflow） |
| 编辑器运行时 | `content/ui/mindmap-editor` |
| 随心轮次/卡片/评分 UI | `practice/ui/freestyle` |
| 复习排期读取与评分入口 | `memory` + `practice/ui/review` |
| 题目作答与做题窗口 | `quiz` |
| 路由元数据单一来源 | `shared/routing/routeManifest.ts` |
| 反馈导演 | `shared/fx` |

---

## 8. 数据与存储

### 8.1 规模

- 当前 **70 张表**；
- **85 个 Alembic 迁移文件**（最新编号 0084）；
- 主要表族：`palaces` / `palace_*`、`review_unit_*`、`freestyle_round_*`、`palace_quiz_*` / `quiz_*`、`knowledge` / `subjects` / `chapters`、`ai_*`、`batch_generation_*`、`reminders` / `reminder_deliveries`。

### 8.2 运行目录

`local_app_home` 下固定拆成三个根：

```text
学习数据/     SQLite、语言学习媒体、词表、语音教练
学科附件/     学科 PDF、资料库
日志缓存/     备份、AI 日志、OCR 缓存、导入/生成工作区、runtime 锁
```

路径由 `core/config.py` 派生；根目录来自 `local-config/memory-anki.local.json` 的 `local_app_home`，回退到 `MEMORY_ANKI_HOME` 或 `%LOCALAPPDATA%\MemoryAnki`。代码里不写死盘符。

### 8.3 SQLite 配置

- `journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`；
- `busy_timeout=10s`；
- 连接池 `pool_size=10`、`max_overflow=20`、`pool_timeout=5s`；
- 读请求 20s 超时；写请求默认不设传输超时，交给 mutation queue 保持客户端/服务端唯一权威；
- 唯一的写超时例外是随心会话启动（45s，且不入队），因为 UI 会重发同一个 encounter。

### 8.4 数据边界

- 应用不实现文件同步；
- 同一时间只允许一台设备写；
- WAL/SHM 文件必须一起同步，切换设备前先停服务并等待同步完成；
- 备份分 full / rolling / rescue 三类，并有校验报告；宫殿另有约 5 分钟节流的版本快照（最多 50 条）。

---

## 9. 关键机制

### 9.1 复习单元与排期

- 调度单位是**复习单元**（永久标记划分），身份是 `(anchor_uid, unit_kind)`；
- 新卡两段定锚：20 分钟 → 第 2 天 → 记得 +3 天 / 轻松 +5 天，然后移交受控 FSRS；
- 「困难」是通过，只允许缩短；「忘记」当天重练（10 分钟 / 1 小时 / 3 小时，最多 3 次）；
- 成熟卡忘记有恢复甲（原间隔 ≥14 天，隔夜通过后恢复 25% / 30% / 35%）；
- 学习日以凌晨 3 点为界。

细节见专项报告。

### 9.2 随心轮次

- 后端 `freestyle_round_states` 是轮次计划的唯一权威：`round_id`、配置快照、`plan_version`、卡片顺序、游标、完成/排除、重练 occurrence；
- 刷新、重启、切设备都不铸造新 `round_id`；只有显式「再来一轮」才创建下一轮；
- 评分、游标、离开卡片、结算压缩通过 `round_commands` 领域门面；
- 写入携带 `expected_version` + `operation_id`，过期设备收到 `conflict` 且不能覆盖新进度；
- 前端 reducer 应用乐观补丁，服务器确认后采用权威状态。

### 9.3 客户端写入可靠性

- 写请求带 `X-Memory-Anki-Mutation-ID` 和 `X-Request-ID`；
- 失败写入进入 IndexedDB mutation queue，可重放、可合并、可持久化；
- 读请求有 20s 超时，避免半开连接把页面永远留在骨架屏；
- 写请求默认不超时，避免「客户端以为失败、服务端其实成功」的分裂。

### 9.4 多端实时进度

- `GET /session/live/stream`（SSE）+ `POST /session/live/commands`；
- 投影只存在进程内存，不写 SQLite，不跨设备；
- `client_id` 忽略自己的回声，`operation_id` 防重试；
- 控制器租约 8s，断连宽限 5s；
- 设备保留自己的路由、当前卡片和翻卡状态，只共享进度。

### 9.5 脑图文档

- 前端：纯文档实体 → 通用画布 → 编辑器运行时 → 显式 capability → 业务宿主；
- 后端：纯文档模块 → 宫殿/知识聚合保存 → 独立学习投影；
- 编辑器自动保存：HTTP 约 800ms 防抖、单飞、在飞期间保留 pending；本地 IndexedDB 草稿；冲突显式选择；
- 复习/随心只读取投影，不自己推导第二套拓扑。

### 9.6 做题证据

- 题目作答是题目自己的证据，**不会**变成宫殿复习评分；
- 所有入口（工具栏、节点徽标、随心叠加层、随心做题卡）共享同一份题目进度；
- 刷新不清除已做；只有手动清空或结算页选择清空才清除；
- 题目发布状态已废除，所有未删除题目都可练习。

### 9.7 反馈与可视化

- `shared/fx`：`cue()` → 配方 → 声音 / 触感 / CSS 果冻 / DOM 小动效，按 owner 取消；
- 禁止粒子、canvas 特效（学习城市地平线的隔离 iframe 除外，见 `docs/architecture/city.md`）和业务代码直接 WebGL/WebAudio。

---

## 10. API 与契约

- 所有业务 API 在 `/api/v1`；
- 请求/响应使用显式 Pydantic 模型；
- 变更请求支持幂等：mutation id + operation id + replay store；
- 读取投影不修改业务状态；
- 前端类型由 OpenAPI 生成（`npm run openapi:types`），生成文件在 `shared/api/generated`；
- API 表面变化必须同步 contracts、生成类型和调用方测试。

---

## 11. 构建与运行链

### 11.1 启动

`start-all.bat` 负责：

1. 读取本机 `local_app_home`；
2. 按指纹判断是否需要安装依赖、构建前端、执行迁移；
3. 若 8012 已有健康服务则复用，否则启动 Uvicorn；
4. 后端同时托管 `dist`；
5. Electron（`--desktop`）或 PWA（默认）加载同一地址。

### 11.2 前端构建

- Vite 8 + React 插件 + Tailwind 4；
- 路由级懒加载；
- React/Radix/图标等 vendor 分组有明确白名单，**不做**会把 CJS interop 吸进首屏的强制分组；
- 构建写出 release manifest，`tools/clean_web_dist.py` 按清单保留最近产物；
- 对 `PalaceEditPage`、`useMindMapImport` 写稳定 chunk 兼容别名，避免滚动更新时旧页面引用已删除的 hash 文件；
- dev server 保留 HMR 通道，但拦截源码热更新触发的整页刷新，保持「改代码手动刷新」；依赖预构建的整页刷新必须放行，否则会出现两份 React；
- PWA 有 Service Worker、离线页和 manifest。

### 11.3 桌面壳

- Electron 只做窗口、重试加载、外链和少量 IPC；
- 目标地址 `MEMORY_ANKI_DESKTOP_URL` 默认 `http://127.0.0.1:8012/`；
- 不把前端或数据库打进安装包。

---

## 12. 质量体系（概览）

统一入口：

```bash
python tools/quality_gate.py
python tools/quality_gate.py --full
python tools/quality_gate.py --launchers
```

快速门禁包含：

- 架构检查 + 架构检查自身的测试；
- 数据完整性清单测试；
- 后端 ruff / mypy / import-linter；
- 前端 ESLint（零警告）+ TypeScript。

完整门禁再加：

- 后端 pytest；
- 前端 Vitest；
- 前端 build；
- Playwright 冒烟（桌面 Chromium + Pixel 7 + iPhone 15 三个 project）。

启动器冒烟会真的运行 `start-all.bat --smoke-test` 和 `--desktop`，验证 API/Electron 就绪后清理测试进程并恢复共享 PWA 服务。

测试规模（按文件数，不代表当前全绿）：

- 后端测试文件 128 个；
- 前端测试文件 393 个；
- E2E spec 10 个。

---

## 13. 现状、边界与风险

### 13.1 已经退役、不要重建的东西

- 宫殿焦点练习、迷你宫殿、独立 `/review` 页面、`/freestyle-2`；
- 节点级复习历史/掌握度投影；
- AI 出题、讲解、纠错、自由提问 HTTP 入口（返回 403）；
- 旧版诊断记录（v1）在首次加载时删除，不迁移；
- `mindmap_learning` 空模块。

### 13.2 主要技术风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 单写者 SQLite | 两台设备同时写会产生冲突副本 | 运行纪律 + 停服切换流程 + 备份/校验 |
| 同步盘延迟 | 外部设备改动会分批进入 | 应用不猜测、不回滚；以本地账本为准 |
| 前端体量大 | 随心/编辑器/布局状态复杂，超大文件有基线 | 750/800 行门禁 + baseline 只减不增 |
| 轮次协议复杂 | 评分、重练、结算、跨天复活互相影响 | 领域内核 + 大量不变量检查 + 回归测试 |
| PWA 旧包 | 构建失败会继续 serve 旧包 | 查 `logs/pwa-build.log`、index hash、重启后端 |
| AI 兼容层 | 多 provider、thinking 开关、base URL 差异 | 统一 runtime 端口 + 场景模型 + 调用日志 |
| 文档漂移 | 架构文档已收缩为最小门禁集 | `AI_PROJECT_CONTEXT.md` + 模块 `MODULE.md` + 检查脚本 |

### 13.3 值得继续投入的方向

1. 继续拆随心三个超大文件（轮次弹层、进度模型、评分 store），消化 baseline 例外；
2. 把 `modules → widgets` 的边界例外下沉为模块公共入口；
3. 把排期、轮次、评分的不变量继续从「文档 + 检查」收敛为更小的纯函数内核；
4. 为跨设备切换增加更明确的启动前检查（WAL 是否静止、是否存在冲突副本）；
5. 给备份恢复做定期演练，而不只是生成校验报告。

---

## 14. 关键文件索引

| 想知道什么 | 先看 |
|---|---|
| 产品与运行上下文 | `AI_PROJECT_CONTEXT.md` |
| 架构地图与依赖账本 | `docs/architecture/README.md`、`context-map.yaml` |
| 脑图架构 | `docs/architecture/mindmap.md` |
| 随心信息流不变量 | `docs/architecture/freestyle-immersive-feed.md` |
| 做题边界 | `docs/architecture/palace-quiz-boundary.md`、`quiz-frontend-boundary.md` |
| 多端 presence | `docs/architecture/live-study-presence.md` |
| 训练证据 | `docs/architecture/unified-training-evidence.md` |
| 诊断隐私 | `docs/architecture/session-recorder-privacy.md` |
| 排期实现 | `docs/复习排期设计.md` |
| 门禁 | `tools/quality_gate.py`、`tools/check_architecture.py` |
