# Memory Anki AI 项目上下文

> 本文档是 Memory Anki 给 AI 编程模型使用的主项目说明。目标不是从零复现全部实现细节，而是让新的 AI 会话能快速理解：这是个什么产品、仓库怎么分层、应该从哪里入手、哪些边界不能碰、改完要怎么验证。
>
> `PROJECT_DOCUMENTATION.md` 已被本文档替代。后续不要再创建或维护旧长文档。

---

## 1. 项目定位

Memory Anki 是一个自用的本地学习产品，核心是“记忆宫殿 + 间隔重复 + AI 辅助知识生产”。PWA 使用完整桌面端前端，默认入口是 `/freestyle`，不再维护单独移动端应用或 `/m` 功能面。

它不是公开 SaaS，不面向多用户，也不需要把数据上传到云服务。主要运行在两台 Windows 电脑上，运行时数据通过百度网盘同步空间跨设备同步；PWA 通过本机后端和 Tailscale 私有网络访问，不是独立后端或公网服务。因此代码修改时最重要的隐含约束是：**不能写出只能在当前电脑运行的路径、配置或数据假设**。

当前产品能力大致包括：

| 能力域 | 说明 |
|---|---|
| 记忆宫殿 `palaces` | 宫殿、挂钩、分段、迷你宫殿、附件、版本快照、焦点节点、结构编辑 |
| 复习 `reviews` | 艾宾浩斯/自定义间隔、宫殿/分段/迷你宫殿多粒度复习、队列与进度 |
| 测验 `palace_quiz` | 选择题、简答题、AI 生成、题目归类、答题反馈 |
| 思维导图导入 `mindmap_import` | 图片/文本等资料经 AI 识别后应用为宫殿结构 |
| 知识体系 `knowledge` | 学科、章节树、知识导入、章节与宫殿/题目联动 |
| 英语学习 `english` / `english_reading` | 听力、阅读材料、CEFR 版本、打字练习、词典与翻译 |
| 随心模式 `freestyle` | 面向当天训练的轻量学习流，也是 PWA 默认入口 |
| 学习会话 `sessions` | practice/focus/segment/mini/review 等会话进度 |
| 仪表盘 `dashboard` | 今日复习、近期状态、时长统计 |
| PWA `pwa` | 通过 Tailscale 访问完整桌面端前端，默认进入 `/freestyle` |
| 设置 `settings` | AI 模型注册、场景模型、提示词、复习参数、客户端偏好 |
| 备份 `backups` | 启动/关闭/周期备份、宫殿版本、数据库恢复 |

---

## 2. 技术栈与运行模型

### 2.1 后端

- Python 3.12+
- FastAPI
- SQLAlchemy 2.0
- SQLite WAL
- Alembic
- pydantic-settings
- pytest、ruff、mypy、import-linter

后端包位于 `apps/api/src/memory_anki`，采用 src layout。生产/本地运行时由 FastAPI 提供 `/api/v1/*` JSON API，并在前端构建产物存在时同时托管单页应用。

### 2.2 前端

- React 19
- TypeScript
- Vite 8
- React Router 7
- TanStack Query
- Radix UI
- Tailwind CSS 4
- lucide-react
- Vitest

前端位于 `apps/web`，只使用 npm。`apps/web/package.json` 中锁定 `packageManager: npm@11.11.0`，依赖锁文件是 `package-lock.json`。

### 2.3 运行端口与数据位置

- 后端默认端口：`127.0.0.1:8012`
- 开发模式：显式运行 Vite 时使用 `127.0.0.1:5173`，并将 `/api` 代理到 `127.0.0.1:8012`
- 生产/日常本地启动：Electron 桌面端和手机 PWA 共用 `127.0.0.1:8012`，后端同时服务 API 和已构建前端
- PWA 私有访问：Tailscale Serve 将当前设备的 HTTPS 地址转发到 `http://127.0.0.1:8012`，手机访问脚本输出的 HTTPS 地址并追加 `/freestyle`
- 运行时数据默认：`%LOCALAPPDATA%\MemoryAnki`
- 可用 `MEMORY_ANKI_HOME` 覆盖运行时数据目录
- 本地设备身份配置：`local-config/memory-anki.local.json`

运行时数据、真实密钥、数据库、日志、上传文件、生成文件等不要提交到 git。

---

## 3. 仓库结构

```text
Memory Anki/
├── AGENT.md                    给 AI/人类协作者的硬性项目规则
├── AI_PROJECT_CONTEXT.md       当前这份 AI 主上下文文档
├── .env.example                环境变量示例，真实 .env 不提交
├── start-desktop.bat           本地桌面启动脚本
├── start-pwa.bat               本地 PWA 启动脚本
├── apps/
│   ├── api/                    FastAPI 后端
│   ├── web/                    React + Vite 前端
│   ├── shared/                 跨应用静态数据
│   └── desktop-timer/          Electron 桌面计时器
├── tools/                      启动、停止、配置、自启、备份、迁移、架构检查、内容处理脚本
├── local-config/               每台电脑自己的本地配置
├── runtime-data/               本地运行数据目录，原则上不提交用户数据
├── ralph/                      Ralph 自动化代理使用的 PRD 数据
└── docx/                       产品想法、功能规划、执行清单、需求笔记（不在 git 仓库内，位于百度网盘同步盘）
```

重要提醒：

- `docx/` 里有大量产品笔记，适合理解功能意图，但不要把它当成已实现代码。
- `docx/移动端重构/` 与 `docx/移动端完善/` 是移动 PWA 的历史计划/交付记录，不能替代当前代码状态和 `PWA.md`。
- `runtime-data/` 和 `local-config/` 涉及设备和本地运行状态，改动要谨慎。
- 当前仓库经常有未提交的大量并行改动。任何任务开始前都要看 `git status`，不要覆盖别人的工作。

---

## 4. 后端结构

后端源码根目录：

```text
apps/api/src/memory_anki/
├── app/                  FastAPI app 装配、启动流程、运行时准备
├── core/                 配置、路径、日志、时间、运行时、文件同步
├── infrastructure/       数据库、ORM 表、迁移、LLM 网关等基础设施
├── modules/              业务模块
└── __init__.py
```

### 4.1 `app/`

常见入口：

- `main.py`：FastAPI app、路由挂载、中间件、静态文件回退
- `startup_runtime.py`：启动模式、运行时初始化
- `startup_warmup.py`：启动预热
- `runtime_prepare.py`：运行时准备入口

后端路由一般挂在 `/api/v1` 下。修改 API 表面时要同步前端 API contract/generated types 和最小测试。

### 4.2 `core/`

这里放跨业务模块的基础能力：

- `config.py`：环境变量、运行目录、默认配置、AI provider 配置
- `runtime.py` / `runtime_paths.py`：运行时信息与路径解析
- `file_sync.py`：文件同步相关能力
- `logging.py` / `request_logging.py`：日志与请求日志
- `time.py`：时间处理
- `migration.py`：迁移相关支持

新增运行时路径、持久化位置或环境变量时，必须写清跨设备影响，避免只在一台电脑可用。

### 4.3 `infrastructure/`

数据库相关主要在：

```text
apps/api/src/memory_anki/infrastructure/db/
├── _tables/               SQLAlchemy 表定义
├── models.py              兼容门面/re-export
└── migrations.py          Alembic upgrade 支持
```

LLM 相关主要在：

```text
apps/api/src/memory_anki/infrastructure/llm/
```

原则：

- ORM、外部服务、文件系统细节留在 infrastructure 或 application 边界附近。
- domain 层不要感知 FastAPI、SQLAlchemy session、环境变量、文件路径或外部 AI 网关。

### 4.4 `modules/`

业务模块通常按以下层次组织：

```text
modules/<feature>/
├── domain/             纯领域类型与规则
├── application/        用例编排、服务、端口、DTO
├── infrastructure/     仓储、外部依赖实现
└── presentation/       FastAPI router / HTTP 层
```

不是每个模块都有完整四层，但架构方向按这个模型理解。

常见后端模块：

| 模块 | 主要职责 |
|---|---|
| `palaces` | 宫殿、分段、迷你宫殿、导入导出、思维导图导入任务、标题同步 |
| `palace_quiz` | 题目、AI 出题、题目来源、生成历史、答题反馈 |
| `reviews` | 复习队列、提交结果、调度策略、进度投影 |
| `sessions` | 学习会话进度 |
| `knowledge` | 学科、章节、知识导入 |
| `mindmap` | 编辑器状态、思维导图文档同步 |
| `freestyle` | 随心训练 feed 与卡片 |
| `settings` | AI 模型注册表、提示词、复习设置 |
| `dashboard` | 聚合页面数据 |
| `english` | 英语听力/课程能力 |
| `english_reading` | 英语阅读、CEFR、词典/句子翻译 |
| `backups` | 启停备份、版本快照、恢复 |
| `persistence` | 幂等请求与持久化辅助 |

---

## 5. 前端结构

前端源码根目录：

```text
apps/web/src/
├── app/                 应用壳、Provider、路由装配
├── features/            用户可感知功能
├── entities/            领域实体 API/model
├── shared/              可复用基础能力
├── test/                测试 setup
├── main.tsx             前端入口
└── index.css            全局样式
```

### 5.1 `app/`

- `providers/`：全局 Provider 和客户端偏好初始化
- `router/`：路由装配、页面级 route wrapper
- `shell/`：应用壳、导航、布局

规则：`app/router` 尽量只做路由装配，不承载复杂业务逻辑。

### 5.2 `features/`

这里是前端主要业务页面和交互：

- `dashboard`
- `freestyle`
- `knowledge`
- `mindmap-import`
- `palace-catalog`
- `palace-edit`
- `palace-quiz`
- `profile`
- `review`
- `english`
- `english-reading`
- `timer-overlay`

修改功能时优先在对应 feature 内解决。只有真正复用或跨模块需要时才下沉到 `entities` 或 `shared`。

### 5.3 `entities/`

常见内容：

- API client
- contract 类型转换
- entity model
- 与后端领域对象对应的薄封装

例如：

- `entities/knowledge`
- `entities/palace`
- `entities/palace-segment`
- `entities/preferences`
- `entities/quiz`
- `entities/runtime`
- `entities/session`
- `entities/study-session`

### 5.4 `shared/`

只能放真正跨功能复用的基础能力：

- API helper、contracts、generated types
- 通用组件
- mind-map host
- feedback/toast/audio
- keyboard
- persistence
- preferences
- logs
- hooks

硬规则：`shared` 不依赖 `app`、`features`、`entities`。

---

## 6. 架构边界和修改原则

修改代码前先确认三类 owner：

- 数据 owner：哪张表、哪个 repository、哪个模块拥有数据
- API owner：哪个后端 router/application service 对外提供能力
- UI owner：哪个 feature/page/component 负责交互

默认只在 owner 内修改。跨 owner 时使用 public contract、barrel、port 或 application service，不要直接绕到别人模块的私有实现。

后端规则：

- router 不写业务流程，不直接堆 ORM 查询。
- application 编排用例，调用仓储/端口/服务。
- domain 不依赖 application 或 presentation。
- application 不依赖 presentation。
- 跨模块不要 import 对方的私有 repository、ORM 模型或 presentation。

前端规则：

- `shared` 不依赖 `app/features/entities`。
- `app/router` 只做路由装配。
- 页面逻辑优先放在 feature 内部 hook/model。
- API contract 变化要同步 `shared/api/contracts`、生成类型和调用方测试。

架构规则来源：

- `AGENT.md`
- `apps/api/pyproject.toml` 的 import-linter 配置
- `tools/check_architecture.py`
- 如果当前 checkout 中存在 `docs/architecture/`，架构性修改前必须阅读

当前工作区里 `docs/architecture/*` 可能正在被删除或重构，遇到这种状态不要擅自恢复或覆盖，先按 git status 判断是否属于当前任务。

---

## 7. 开发与运行命令

### 7.1 后端安装

```powershell
cd apps/api
python -m pip install -r requirements-dev.txt
python -m pip install -e .
```

### 7.2 前端安装

```powershell
cd apps/web
npm ci
```

### 7.3 开发模式

后端：

```powershell
cd apps/api
python -m uvicorn --app-dir src memory_anki.app.main:app --reload --port 8012
```

前端：

```powershell
cd apps/web
npm run dev
```

开发时 Vite 把 `/api` 代理到 `127.0.0.1:8012`。思维导图编辑器对热更新敏感，遇到状态异常优先手动刷新页面。

### 7.4 本地桌面启动

根目录：

```powershell
.\start-desktop.bat
```

桌面启动会短暂停止现有 PWA 服务，执行百度同步与数据库迁移，再重启共享的 `127.0.0.1:8012`。Electron 和手机 PWA 随后共用该服务；关闭 Electron 不会停止 PWA。`5173` 只用于显式前端开发。

停止：

```powershell
.\tools\stop.bat
```

### 7.5 个人 PWA 启动

PWA 使用完整桌面端前端，不单独部署公网服务。当前统一端口和访问方式见 `PWA.md`：

```powershell
.\start-pwa.bat
```

- 前端改动后直接运行 `.\start-pwa.bat`，启动入口会自动执行智能增量更新
- 本机检查：`http://127.0.0.1:8012/freestyle`
- 手机安装/访问：运行 `tools\configure-tailscale-pwa.bat` 后，使用脚本输出的 HTTPS Tailscale 地址并追加 `/freestyle`
- 停止服务：`.\tools\stop-pwa.bat`

---

## 8. 常用检查命令

按改动范围选择最小必要检查，不要盲目跑很重的全量检查。

后端：

```powershell
cd apps/api
python -m pytest
python -m ruff check src tests
python -m mypy
```

前端：

```powershell
cd apps/web
npm run test
npm run typecheck
npm run lint
npm run build
```

架构检查：

```powershell
python tools/check_architecture.py
```

API 类型生成：

```powershell
cd apps/web
npm run openapi:types
```

只有当后端 OpenAPI 表面发生变化时才需要重新生成类型。

---

## 9. Git 与协作注意事项

这个仓库经常有大量未提交改动，很多可能来自用户或其他 AI 会话。任何自动化或人工修改都必须遵守：

- 开始前执行 `git status --short --branch`。
- 不要 revert、checkout、reset 不属于当前任务的文件。
- 不要运行会批量重写无关文件的格式化命令。
- 提交时只 stage 当前任务明确相关的文件。
- 如果任务要求自动 commit，必须确认 staged diff 只包含目标文件。
- 不要把 runtime 数据、日志、数据库、真实密钥、本地设备路径提交。

当前本文档相关的期望：

- `AI_PROJECT_CONTEXT.md` 是新的主项目说明。
- `PROJECT_DOCUMENTATION.md` 已被替代，应删除，不再维护。
- 每日自动任务只维护并提交 `AI_PROJECT_CONTEXT.md` 的日常更新；它不负责提交业务代码。

---

## 10. AI 功能与配置线索

项目通过 OpenAI-compatible 协议接入多家模型供应商。常见供应商和配置在 `.env.example`、`core/config.py`、`settings` 模块、前端 AI 配置页面中体现。

AI 相关功能分布较广：

- 思维导图导入：`modules/palaces/application/mindmap_import`
- 题目生成：`modules/palace_quiz/application/quiz_generation_*`
- AI 模型注册表：`modules/settings/application/ai_model_registry_*`
- 前端模型配置：`features/profile`、`features/ai-config`
- AI 调用日志：`infrastructure/llm/external_ai_call_logs.py`

修改 AI 调用时要注意：

- 不要把 API key 写入代码或文档。
- 场景模型、thinking 开关、供应商 base URL 可能来自配置表或本地环境。
- 需要保留跨供应商兼容性，避免只适配某一家 provider。

---

## 11. 数据与运行时目录

关键原则：源码仓库和运行数据分离。

常见运行时内容：

- SQLite 数据库
- 附件
- 学科文档
- 导入任务产物
- AI 调用日志
- 英语媒体/任务文件
- 英语阅读词典/CEFR 数据
- 备份

这些路径通常由 `memory_anki.core.config` 派生，根目录来自 `MEMORY_ANKI_HOME` 或默认 `%LOCALAPPDATA%\MemoryAnki`。涉及新增路径时要考虑：

- 两台设备通过百度网盘同步时是否可用
- `.gitignore` 是否正确
- 是否需要迁移旧位置
- 是否需要备份/恢复支持
- 是否要同步 storage layout 或 runtime contract

---

## 12. 近期代码变化摘要

本节由每日 Codex 已安排任务维护。只记录会影响 AI 理解项目结构、边界、运行方式或主要能力的变化，不记录普通 bugfix 细节。

- 2026-07-05：新增 `AI_PROJECT_CONTEXT.md` 作为中文主项目上下文，替代旧的 `PROJECT_DOCUMENTATION.md`。
- 2026-07-06：PWA 恢复为完整桌面端入口，默认进入 `/freestyle`；不再维护单独移动端 `/m` 应用，PWA 端口统一为 `127.0.0.1:8012`。
- 2026-07-10：Electron 日常入口改为复用 PWA 的 `127.0.0.1:8012` 共享服务；桌面与 PWA 启动通过跨进程锁协调，`5173` 仅保留给显式前端开发。
- 2026-07-10：本机指纹驱动的智能增量更新已合并到 `start-desktop.bat` 与 `start-pwa.bat`，不再保留独立 `update.bat`；Desktop/PWA 共用单实例后台托盘。
