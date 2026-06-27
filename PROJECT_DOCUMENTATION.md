# Memory Anki — 完整项目复现文档

> 本文档是 Memory Anki 项目的"唯一真相源"工程说明书。一名具备 FastAPI + React 经验的编程 AI 仅凭本文档即可从零重建一个与当前实现行为完全一致的项目。文档涵盖仓库布局、运行时契约、后端分层、前端分层、数据模型、API 表面、迁移、构建/部署、AI 集成与所有架构约束。

---

## 1. 项目概述

**Memory Anki** 是一个单机、本地部署的"记忆宫殿 + 间隔重复"学习应用。

- **后端**：Python 3.12+ / FastAPI / SQLAlchemy 2.0 / SQLite（WAL 模式）。
- **前端**：React 19 + TypeScript + Vite 8（Feature-Sliced Design 分层）。
- **运行模型**：生产环境下，一个 FastAPI 进程同时对外提供 JSON API（`/api/v1/*`）和已构建的前端静态包（`/`），共用单一本地端口 `127.0.0.1:8012`。开发时前后端分进程，Vite 把 `/api` 反代到后端。
- **AI**：通过 OpenAI 兼容协议接入多家供应商（DashScope、Zhipu、SiliconFlow、DeepSeek），用于思维导图识别、题目生成、英语听力/阅读、语音教练等。
- **运行时数据**：永不入库。统一存放在 `MEMORY_ANKI_HOME`（Windows 默认 `%LOCALAPPDATA%\MemoryAnki`）。

### 1.1 核心能力域

| 域 | 说明 |
|---|---|
| 记忆宫殿（palaces） | 宫殿 / 挂钩（peg）/ 分段（segment）/ 迷你宫殿（mini-palace）/ 附件 / 版本快照 / 焦点节点 |
| 复习（reviews） | 艾宾浩斯间隔重复，三级粒度（宫殿 / 分段 / 迷你），队列、批改、进度 |
| 知识体系（knowledge） | 学科（subject）/ 章节（chapter）树 / 学科文档（PDF）/ 双向关联 / 自定义连线 |
| 测验（palace_quiz） | 选择题 / 简答题，AI 生成（图片/PDF/复习思维导图/章节大纲），按迷你宫殿归类 |
| 思维导图导入（mindmap_import） | 图片/批量图片/PDF → AI 识别为可编辑思维导图 → 应用为宫殿结构 |
| 英语听力（english） | 视频 → ASR → 句级翻译 → 打字练习，课程进度 |
| 英语阅读（english_reading） | 材料 → CEFR 难度版本生成 → 词典/句子翻译 → 阅读校准 |
| 语音教练（voice_coach） | TTS 事件播报（开始/里程碑/完成等） |
| 仪表盘（dashboard） | 今日复习、近况、时长统计 |
| 设置（settings） | 复习算法参数、AI 模型注册表、提示词模板、客户端偏好 |
| 时间记录（time_records） | 学习时长记录，可编辑/软删/迁移 |
| 备份（backups） | 周期/滚动/关闭备份、宫殿版本、数据库恢复 |

---

## 2. 仓库布局

```text
Memory Anki/
├── apps/
│   ├── api/                     FastAPI 后端（src layout：src/memory_anki）
│   ├── web/                     React + Vite 前端
│   └── shared/                  跨应用静态资源（english-reading-cefr.json 等）
├── tools/                       启动、备份、架构校验脚本
│   ├── check_architecture.py    可执行架构契约（CI 与本地都跑）
│   ├── start_supervisor.py      生产入口（被 start.bat 调用）
│   ├── runtime_supervisor.py    等价入口
│   ├── configure-shared-home.ps1
│   ├── create_startup_backup.py
│   └── ocr/render/merge_1000_*.py  一次性内容生产脚本（非核心）
├── docs/
│   └── architecture/README.md   架构意图唯一真相源
├── .github/workflows/ci.yml     GitHub Actions：后端 + 前端检查
├── README.md / CONTRIBUTING.md
├── .env.example / .gitignore / .editorconfig
└── start.bat                    Windows 生产启动
```

### 2.1 关键根级文件

- **`.gitignore`**：忽略 `/output/`、`/apps/web/dist/`、`node_modules`、`*.pyc`、`__pycache__`、`*.egg-info/`、`/runtime-data/`、`/data/**`（保留 `.gitkeep`/`README.md`）、`*.sqlite3`、`*.db`、各类 `*.log`、`.env`、`.vscode/`、`.tmp/`，以及 AI 工具产物（`.specstory/`、`.claude/`、`.reasonix/`、`.codegraph/`、`.playwright-mcp/`）。**注意**：不 blanket-ignore `*.png`，以免吞掉 docs 资源。
- **`.editorconfig`**：UTF-8 / LF / 末尾换行 / 去尾空格；Python 缩进 4 空格，其余 2 空格；`*.bat/*.cmd/*.ps1` 用 CRLF；`*.md` 不去尾空格。
- **`.env.example`**：`MEMORY_ANKI_HOME`、`MEMORY_ANKI_WEB_DIST`、`MEMORY_ANKI_CEFR_SOURCE`、`MEMORY_ANKI_RUN_MODE`，以及四家 AI 供应商的 `*_API_KEY` / `*_BASE_URL` / 模型名。复制为 `.env` 后按需填写，**永不提交真实密钥**。
- **`start.bat`**：`python "%~dp0tools\start_supervisor.py"`。

---

## 3. 运行环境与开发流程

### 3.1 依赖版本

- Python **3.12+**
- Node.js **24** + npm **11**（前端**仅**用 npm，`apps/web/package.json` 的 `packageManager` 字段锁定 `npm@11.11.0`，并提交 `package-lock.json` 作为唯一锁文件；`pnpm-lock.yaml` 等被禁止追踪）
- Git

### 3.2 首次安装

```powershell
# 后端
cd apps/api
python -m pip install -r requirements-dev.txt
python -m pip install -e .

# 前端
cd apps/web
npm ci
```

### 3.3 开发模式（双终端）

终端 1（后端）：

```powershell
cd apps/api
python -m uvicorn --app-dir src memory_anki.app.main:app --reload --port 8012
```

终端 2（前端）：

```powershell
cd apps/web
npm run dev
```

Vite dev server 把 `/api` 反代到 `127.0.0.1:8012`。**HMR 被刻意关闭**（`vite.config.ts` 中 `server.hmr: false`，并通过注入脚本拦截 Vite WebSocket 的 `update`/`full-reload` 消息），原因是思维导图编辑器对热更新不稳定；改动后需手动刷新。

### 3.4 生产启动

```powershell
.\start.bat
```

`start.bat` → `tools/start_supervisor.py` → `memory_anki.supervisor.runtime_supervisor.main(["--launch"])`。在"supervisor 运行模式"下会确保后台守护进程；否则走 `ensure_latest_workspace_runtime`（重建当前工作区前端、停掉占用 8012 的旧进程、从当前检出代码起后端）。

运行时数据默认落在 `%LOCALAPPDATA%\MemoryAnki`，可用 `MEMORY_ANKI_HOME` 覆盖；多个 worktree 共享一个 runtime home 用 `tools/configure-shared-home.ps1`。

### 3.5 检查命令（Definition of Done）

后端：

```powershell
cd apps/api
pytest
ruff check src tests
mypy
lint-imports
python ..\..\tools\check_architecture.py
```

前端：

```powershell
cd apps/web
npm run typecheck   # tsc -b --noEmit
npm run lint        # eslint .
npm run test        # vitest run
npm run build       # tsc -b && vite build
```

仓库卫生：`git ls-files -ci --exclude-standard` 必须无输出。

---

## 4. 后端架构（apps/api）

### 4.1 分层总则

源码在 `src/memory_anki`，采用 **DDD 风格的模块化分层**：

```text
memory_anki/
├── app/                       引导、DI 装配、路由注册、lifespan
│   ├── main.py                FastAPI app 实例与路由挂载
│   ├── startup_runtime.py     启动模式解析 + 运行时初始化
│   └── runtime_prepare.py     独立可执行的 prepare 入口
├── core/                      config / logging / time / migration / runtime / storage_layout / request_*
├── infrastructure/
│   ├── db/                    SQLAlchemy 引擎 + Base + 表模块 + 迁移
│   │   ├── _tables/_base.py   Base、engine（SQLite，WAL）、get_session、init_db
│   │   ├── _tables/palaces.py
│   │   ├── _tables/knowledge.py
│   │   ├── _tables/english.py
│   │   ├── _tables/english_reading.py
│   │   ├── _tables/misc.py    time_records / mindmap_import_jobs / ai_call_logs / config / ai_model_catalog
│   │   ├── models.py          向后兼容门面，re-export 全部 ORM 类
│   │   └── migrations.py      alembic upgrade head
│   └── llm/                   openai_compatible.py（urllib 实现的 OpenAI 兼容客户端）+ external_ai_call_logs + config_helpers
├── modules/                   业务模块（见 4.3）
└── supervisor/                runtime_supervisor*.py（生产发布/代理守护）
```

**强制约束**（由 `pyproject.toml` 的 `[tool.importlinter]` 契约与 `tools/check_architecture.py` 共同守护）：

- 模块形如 `modules/*/{domain,application,infrastructure,presentation}`。
- `application` **禁止** import `presentation`。
- `domain` **禁止** import `application` 或 `presentation`。
- `domain` 不得感知 FastAPI、SQLAlchemy session、文件路径、环境变量、时钟、外部 AI 网关。
- 跨模块读写必须走所属模块的公开 application service / contract / projection，**不得** import 别模块的 `infrastructure`/`presentation`/私有 repository/ORM 模型。
- 文件行数：后端单文件 ≤ 800 行，前端 ≤ 750 行。
- Alembic 迁移默认**只能向前兼容**（新增表/可空列/索引/回填）。破坏性操作（drop_column/alter_column/rename 等）必须显式标注 `memory-anki: allow-destructive-migration` 并附理由，否则 `check_architecture.py` 报错。

### 4.2 应用入口（`app/main.py`）

- `app = FastAPI(title="Memory Anki API", lifespan=lifespan)`。
- 中间件：`CORSMiddleware`（`allow_origins=["*"]`）+ 自定义 `RequestLoggingMiddleware` + 一个对非 `/api` 请求设置 `Cache-Control: no-cache` 的 http 中间件。
- 静态挂载：`/api/attachments` → `ATTACHMENTS_DIR`；若 `WEB_DIST_DIR` 存在，`/` → `SinglePageAppStaticFiles`（对无后缀的 GET/HEAD 路径回退到 `index.html`，实现 SPA 路由）。
- 路由全部挂在前缀 `/api/v1` 下：`palace_router`、`palace_quiz_router`、`review_router`、`sessions_router`、`settings_router`、`import_router`、`knowledge_router`、`bilink_router`、`time_records_router`、`english_router`、`english_reading_router`、`voice_coach_router`、`dashboard_router`。
- `lifespan`：
  1. `resolve_startup_mode()`（环境变量 `MEMORY_ANKI_STARTUP_MODE`，取值 `prepare`/`serve`/`healthcheck`）。
  2. `initialize_service_runtime(app, mode)`：配置日志、加载 runtime contract、`assert_runtime_compatible`、`ensure_legacy_repo_data_migrated`、`init_db`（alembic upgrade head）、构建 runtime info；`serve` 模式还会 `record_runtime_start`。
  3. `serve` 模式下：启动 runtime activity 心跳、`start_periodic_backup_loop()`。
  4. 关闭时：停备份循环、停心跳、`create_shutdown_backup()`（吞异常）。

### 4.3 业务模块清单

| 模块 | 路径 | 关键职责 |
|---|---|---|
| palaces | `modules/palaces` | 宫殿 CRUD、编辑器状态、分段、迷你宫殿、焦点节点、AI 拆分、导入导出、思维导图导入任务、标题/分组同步、复习进度投影 |
| palace_quiz | `modules/palace_quiz` | 题目 CRUD/批量/去重/分类、AI 生成（图片/PDF/复习导图/章节大纲）、简答反馈 |
| reviews | `modules/reviews` | 队列、提交、调度策略（艾宾浩斯/自定义/SM2→艾宾浩斯迁移）、指标、平滑逾期 |
| sessions | `modules/sessions` | 会话进度（practice/focus/segment/mini/review 等多 kind） |
| knowledge | `modules/knowledge` | 学科/章节树、学科文档、双向关联、自定义连线 |
| english | `modules/english` | 视频课程、ASR 任务、句级翻译、打字校验、进度 |
| english_reading | `modules/english_reading` | 阅读材料、CEFR 版本、词典/词法缓存、句子翻译、会话校准 |
| voice_coach | `modules/voice_coach` | TTS 事件合成与缓存 |
| dashboard | `modules/dashboard` | 聚合今日复习 + 近况 + 时长统计 |
| settings | `modules/settings` | 复习参数、AI 模型注册表/目录、提示词模板 |
| time_records | `modules/time_records` | 学习时长记录、阈值、遗留迁移、时区归一 |
| backups | `modules/backups` | 全量/滚动/关闭备份、宫殿版本、数据库恢复、git 快照恢复 |
| mindmap | `modules/mindmap` | 宫殿/学科共享的编辑器状态服务（editor_doc 持久化与树同步） |
| persistence | `modules/persistence` | 幂等响应（基于请求头 `X-Memory-Anki-Mutation-ID`） |

`palace_quiz/application` 体积最大，被拆成 ~150 个小文件（`question_*`、`quiz_generation_*`、`quiz_grouping_*` 等）；架构检查要求其 application 模块**不得**通过 `service.py` 门面互引，必须直引叶子模块。

### 4.4 配置（`core/config.py`）

- `EnvSettings`（pydantic-settings）：从 `.env` 读取四家 AI 供应商的 key/base_url/模型名；实例化为单例 `_env` 并把每个字段重新导出为模块常量（兼容 `from memory_anki.core.config import DASHSCOPE_API_KEY`）。
- 路径解析 `_resolve_app_home()`：优先 `MEMORY_ANKI_HOME` 环境变量；其次读取默认 home 下的 `shared-home.txt`（共享 home 配置）；最后回退到 `%LOCALAPPDATA%\MemoryAnki`（无 `LOCALAPPDATA` 时用 `~/AppData/Local/MemoryAnki`）。返回 `(APP_HOME, APP_HOME_SOURCE)`。
- 派生路径常量：`DATA_DIR`、`ATTACHMENTS_DIR`、`SUBJECT_DOCUMENTS_DIR`、`IMPORT_JOBS_DIR`、`AI_CALL_LOGS_DIR`、`VOICE_COACH_CACHE_DIR`、`ENGLISH_DIR`（含 `media`/`tasks`）、`ENGLISH_READING_DIR`（含 `lexicon`、`cefr.json`）、`BACKUPS_DIR`（`full`/`rescue`）、`DB_PATH`、`MIGRATION_STATE_PATH`、`DATABASE_URL = sqlite:///<DB_PATH>`、`WEB_DIST_DIR`（来自 `MEMORY_ANKI_WEB_DIST`）。
- `DEFAULTS`：一个巨大的字符串字典，作为 `config` 表的种子（复习算法、间隔、AI 场景模型映射 `scene_model_*`、思维导图拆分参数、语音教练参数等）。每个 AI 场景都有 `*_thinking_enabled` 配套布尔。
- `ensure_runtime_dirs()`：创建所有上述目录。

### 4.5 运行时契约（`core/runtime.py` + `apps/api/runtime-contract.json` + `storage-layout.json`）

- `runtime-contract.json`：`{ runtime_generation, min_supported_generation, max_supported_generation }`，当前都是 `1`。`assert_runtime_compatible` 比较 migration-state 里记录的共享 generation 与契约上下界，越界即 `RuntimeError`（防止旧版本写坏新数据 / 新版本读不懂旧数据）。
- `storage-layout.json`：声明受管理的存储项（`database`、`attachments`、`english`、`import_jobs`、`ai_call_logs`、`migration_state`），各自 `relative_path`/`kind`/`required`/`backup`，供备份与 supervisor 使用。
- `record_runtime_start`：把 channel（`MEMORY_ANKI_CHANNEL`，默认 `production`）、git commit、启动时间写入 `migration-state.json`。
- `build_runtime_info`：返回 channel/commit/short_commit/generation/app_home/storage 布局/活动实例/release id/前端入口 asset 与 bundle hash 等，供 `/api/v1/runtime-info`。

### 4.6 数据库与 ORM

引擎在 `_tables/_base.py` 创建：

```python
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False, "timeout": 30})
# connect 事件中设置 PRAGMA：foreign_keys=ON, busy_timeout=30000, synchronous=NORMAL, journal_mode=WAL
```

`Base(DeclarativeBase)` 为所有表共享。`init_db()` → `run_migrations()` → `alembic upgrade head`。`get_session()` 返回 `Session(engine)`。

**表清单（按域分文件）**：

`palaces.py`：`chapter_palaces`（关联表，含 `is_explicit`）、`Palace`、`Peg`（自引用树）、`Attachment`、`PalaceSegment`、`PalaceMiniPalace`、`ReviewSchedule`、`ReviewLog`、`PalaceSegmentReviewSchedule`、`PalaceSegmentReviewLog`、`PalaceMiniPalaceReviewSchedule`、`PalaceMiniPalaceReviewLog`、`SessionProgress`（多 kind，带 7 个部分唯一索引区分 practice/review/segment_*/mini_*/focus）、`PalaceVersion`、`PalaceGroup`、`PalaceQuizQuestion`（带 `ck_palace_quiz_questions_owner` check：`palace_id` 或 `source_chapter_id` 至少一个非空）。

`knowledge.py`：`Subject`、`SubjectDocument`、`Chapter`（自引用树）、`NodeConnection`（多态 source/target）。

`english.py`：`EnglishCourse`、`EnglishSentence`、`EnglishCourseProgress`、`EnglishGenerationTask`。

`english_reading.py`：`EnglishReadingProfile`、`EnglishReadingMaterial`、`EnglishReadingVersion`、`EnglishReadingSession`、`EnglishReadingLexiconCache`、`EnglishReadingDictionaryCache`。

`misc.py`：`TimeRecord`（主键为字符串 id）、`MindMapImportJob`、`ExternalAiCallLog`、`Config`（key/value）、`AiModelCatalog`。

`models.py` 是向后兼容门面，`from memory_anki.infrastructure.db.models import X` 仍可用；新代码应直接从域表模块 import。导入 `models` 会触发 `_tables` 包注册所有表到 `Base.metadata`。

#### 关键字段示例（Palace）

```
id, title, description, difficulty, review_mode, archived, mastered, needs_practice,
focus_node_uids_json, editor_doc, editor_config, editor_local_config,
created_at, updated_at, primary_chapter_id, group_id, group_sort_order,
title_mode(sync|manual), manual_title, grouping_mode(auto|manual),
manual_group_chapter_id, mini_review_mode(independent|mini_only)
```

#### SessionProgress 的 session_kind 枚举

`practice` / `focus_practice` / `segment_practice` / `mini_practice` / `review` / `segment_review` / `mini_review`，每种 kind 用一个部分唯一索引保证一实体一行。

### 4.7 Alembic 迁移

`alembic.ini`：`script_location = alembic`、`prepend_sys_path = src`、占位 `sqlalchemy.url`（`env.py` 运行时用 `DATABASE_URL` 覆盖）。

`alembic/env.py`：在线/离线模式，`target_metadata = Base.metadata`。

`alembic/versions/`：

| 文件 | 内容 |
|---|---|
| `0001_baseline.py` | `Base.metadata.create_all(checkfirst=True)`（建全部表） |
| `0002_legacy_schema_adjustments.py` | 用 `PRAGMA table_info` 幂等地为旧库补列/索引（subjects/palaces/chapter_palaces/time_records/palace_versions/palace_quiz_questions/各 review schedule/mindmap_import_jobs/session_progress 去重与重建部分唯一索引/ai_call_logs 索引），并把 running 的导入任务重置为 interrupted |
| `0003_reset_english_reading_dictionary_cache.py` | 清空词典缓存 |
| `0004_chapter_quiz_question_ownership.py` | 给 `palace_quiz_questions` 加 `source_chapter_id`/`classified_chapter_id` + 索引 |
| `0005_relax_palace_quiz_question_palace_owner.py` | 把 `palace_id` 放宽为可空（`batch_alter_table recreate="always"`），带 `memory-anki: allow-destructive-migration` 标注与理由 |

迁移默认 `downgrade` 为 no-op（SQLite 不回滚列）。

### 4.8 API 表面（前缀 `/api/v1`）

> 所有写操作建议带请求头 `X-Memory-Anki-Mutation-ID`（前端 `request()` 自动生成 `crypto.randomUUID()`），后端 `persistence.application.idempotency` 据此返回幂等响应（复习提交、时间记录创建）。

#### palaces（`palaces/presentation/router.py`，tags=["palaces"]）

```
GET    /palaces                              ?search
GET    /palaces/grouped                      ?search&subject_id
GET    /palaces/grouped-summary              ?search&subject_id
GET    /palaces/subjects                     ?search
GET    /palaces/{id}
POST   /palaces                              PalaceCreate → 建宫 + 触发首复习 + 滚动备份
PUT    /palaces/{id}                         PalaceUpdate
DELETE /palaces/{id}
PUT    /palaces/{id}/archive                 取消归档
GET    /palaces/{id}/review-plan
GET    /palaces/{id}/editor                  返回 palace + 编辑器状态
PUT    /palaces/{id}/editor                  保存编辑器状态（冲突 409）
GET    /palaces/{id}/focus-session
POST   /palaces/{id}/editor/ai-split         AI 拆分节点
GET    /palaces/{id}/segments
POST   /palaces/{id}/segments
PUT    /palace-segments/{seg_id}
PUT    /palace-segments/{seg_id}/review-progress
PUT    /palaces/{id}/default-segment/review-progress
PUT    /palaces/{id}/practice-flag
PUT    /palaces/{id}/mini-review-mode
PUT    /palaces/{id}/focus-nodes/{node_uid}  ?focused
GET    /palaces/{id}/mini-palaces
POST   /palaces/{id}/mini-palaces
GET    /palace-mini-palaces/{mp_id}
PUT    /palace-mini-palaces/{mp_id}
PUT    /palace-mini-palaces/{mp_id}/review-progress
DELETE /palace-mini-palaces/{mp_id}
DELETE /palace-segments/{seg_id}
GET    /palace-segments/{seg_id}
GET    /practice/session/{palace_id}         旧式 practice 进度
PUT    /practice/session/{palace_id}
DELETE /practice/session/{palace_id}
GET    /palaces/{id}/versions                含去重清理
GET    /palaces/{id}/versions/{vid}
POST   /palaces/{id}/restore-version
GET    /backups
POST   /backups/create                       ?reason
POST   /backups/restore-database             冲突 409
POST   /backups/recover-palaces              从 git 快照
POST   /backups/restore-palace-from-backup
POST   /backups/compare-palace-snapshots
POST   /palaces/{id}/upload                  附件上传（multipart）
GET    /attachments/{att_id}                 FileResponse
DELETE /attachments/{att_id}
```

#### 导入导出（`palaces/presentation/import_router.py`，tags=["import-export"]）

```
GET    /export/json                          下载 palaces.json
GET    /export/markdown                      下载 palaces.md
POST   /import                               ?format=json|markdown（multipart）
POST   /import/jobs/image                    建 image 导入 job（multipart + ai_options）
POST   /import/jobs/batch                    批量图片
POST   /import/jobs/pdf                      PDF job（JSON，含 subject_document_id/page_selection/pdf_mode/import_options/ai_options）
POST   /import/jobs/{job_id}/run             异步执行
POST   /import/jobs/{job_id}/pause
POST   /import/jobs/{job_id}/complete-from-preview
GET    /import/jobs/{job_id}
GET    /import/jobs                          ?entity_key
DELETE /import/jobs/{job_id}
POST   /import/preview-mindmap               兼容端点：建 job→run→wait
POST   /import/preview-mindmap-batch
POST   /import/preview-text
POST   /import/preview-mindmap-pdf           SSE 流式预览
POST   /import/preview-text-pdf
```

PDF 导入选项 `PdfImportOptions`：`quote_original_text_only`、`mount_on_original_leaf_only`、`preserve_emphasis_marks`、`semantic_split_long_paragraphs`、`preserve_line_breaks`（默认全 true）。PDF 模式常量 `PDF_IMPORT_MODE_DIRECT_GENERATION`。

#### palace_quiz（tags=["palace_quiz"]）

```
GET    /palaces/{id}/quiz-questions
GET    /palaces/{id}/aggregated-quiz-questions
GET    /chapters/{cid}/quiz-questions
POST   /palaces/{id}/quiz-questions
POST   /palaces/{id}/quiz-questions/batch
POST   /chapters/{cid}/quiz-questions/batch
PUT    /palace-quiz-questions/{qid}
DELETE /palace-quiz-questions/{qid}
POST   /palace-quiz-questions/batch-delete
POST   /palace-quiz-questions/{qid}/choice-attempts
POST   /palace-quiz-questions/{qid}/short-answer-feedback
POST   /palaces/{id}/quiz-generation/images            multipart
POST   /palaces/{id}/quiz-generation/pdf
POST   /palaces/{id}/quiz-generation/pdf/stream         SSE
POST   /palaces/{id}/quiz-generation/pdf/recover
POST   /palaces/{id}/quiz-generation/pdf/recover-and-save
POST   /palaces/{id}/quiz-generation/review-mindmap
POST   /chapters/{cid}/quiz-generation/outline
POST   /palaces/{id}/quiz-classification/mini-palaces
```

#### reviews（tags=["review"]）

```
GET    /review/overdue-count
GET    /segment-review/overdue-count
GET    /review/stats/weekly
POST   /review/spread-overdue                 ?days
GET    /review/queue
GET    /segment-review/queue
GET    /review/chapter/{cid}/queue
GET    /segment-review/chapter/{cid}/queue
GET    /review/session/{sid}
GET    /segment-review/session/{sid}           可回退到虚拟默认分段会话
GET    /mini-review/session/{sid}
POST   /segment-review/batch-session
GET    /review/session/{sid}/progress          (含 segment/mini 变体)
PUT    /review/session/{sid}/progress
DELETE /review/session/{sid}/progress
POST   /review/session/{sid}/submit            幂等；返回 next_id/mastered
POST   /segment-review/session/{sid}/submit
POST   /mini-review/session/{sid}/submit
POST   /segment-review/batch-session/submit
GET    /review                                 = /review/queue
GET    /review/{sid}                           = session
POST   /review/{sid}/submit                    = submit
```

#### sessions（tags=["sessions"]）

为每种 `session_kind` 暴露 `GET/PUT/DELETE /sessions/{kind}/{entity_id}/progress`：`practice/{palace_id}`、`focus-practice/{palace_id}`、`segment-practice/{seg_id}`、`mini-practice/{mp_id}`、`review/{sid}`、`segment-review/{sid}`、`mini-review/{sid}`。

#### settings（tags=["settings"]）

```
GET/PUT /settings                              读/写 DEFAULTS 中的键（PUT 支持 apply_to_pending=all 重算待复习调度）
GET/PUT /settings/review
GET/PUT /profile/review-settings
GET    /runtime-info                           build_runtime_info()
GET    /runtime-health
GET/PUT /profile/client-preferences            9 个 group（shortcuts/review_feedback/english_practice/timer_automation/timer_focus/dashboard_duration_filter/palace_list_view/palace_shelf_view/voice_coach）
GET/PUT /settings/ai-prompts
POST   /settings/ai-prompts/reset
GET/PUT /settings/ai-models                    支持 scene_updates/scenario_updates/category_updates/provider_updates，兼容旧 updates
POST   /settings/ai-models/models              upsert 目录项
GET    /settings/ai-models/models/{key}/impact
POST   /settings/ai-models/models/{key}/test
POST   /settings/ai-models/providers/{key}/test
DELETE /settings/ai-models/models/{key}
GET    /ai-call-logs                           ?job_id&palace_id&provider&model&feature&status&limit
GET    /ai-call-logs/{id}
GET    /ai-call-logs/{id}/artifacts/{name}     FileResponse
```

#### time_records（tags=["time-records"]）

```
GET    /time-records                           ?include_deleted&include_below_threshold
POST   /time-records                           幂等
PUT    /time-records/{id}
POST   /time-records/{id}/soft-delete
POST   /time-records/{id}/restore
GET/PUT /settings/time-recording-threshold
POST   /time-records/import-legacy
POST   /time-records/normalize-timezones
```

#### knowledge（tags=["knowledge"]）

学科/章节 CRUD、`/subjects/{id}/tree`、`/subjects/{id}/editor`（PUT 含详细调试日志，失败写 `output/subject-editor-debug.log`）、学科文档上传/列表/下载/分页图片渲染、章节面包屑、`/palaces/{id}/chapters` 双向关联（含 primary）、`/connections` 自定义连线。

#### english（tags=["english"]）

`/english`（workspace summary）、`/english/current-task`、`/english/tasks/{id}/stream`（SSE）、`/english/upload`（视频→ASR 任务）、retry/clear current-task、`/english/continue`、课程详情/进度/校验/媒体/删除。

#### english_reading（tags=["english-reading"]）

profile 读写、workspace、材料创建（paste 或文件）、版本生成（同步与 SSE 流）、材料 CRUD、版本查询、`/english-reading/dictionary?word=`、`/english-reading/sentence-translation`、`/materials/{id}/complete`（feedback/duration/hover/expand）。

#### voice_coach（tags=["voice-coach"]）

`POST /voice-coach/synthesize`（event ∈ `session_start/idle_nudge/edit_idle_nudge/milestone/all_clear_ready/session_complete`）、`GET /voice-coach/audio/{cache_key}`、`GET /voice-coach/templates`。错误细分 config(400)/protocol(502)/http(auth→502、rate→429)/network(502)。

#### dashboard（tags=["dashboard"]）

`GET /dashboard?duration_mode&month&start_date&end_date` → 今日复习组 + 近 5 个宫殿 + 今日新建 + 周统计 + 各时长口径（今日/周/月/全部/正式/英语课程）。

### 4.9 Pydantic 模式（`palaces/domain/schemas.py`）

`PegIn`、`PalaceCreate`、`PalaceUpdate`、`ReviewSubmit`、`ChapterCreate`、`ChapterUpdate`，以及输出模型 `PegOut`/`AttachmentOut`/`PalaceOut`/`ReviewScheduleOut`（`ConfigDict(from_attributes=True)`）。多数路由实际用 `dict` 直传给 application service。

### 4.10 LLM 网关（`infrastructure/llm/openai_compatible.py`）

纯 `urllib` 实现（无第三方 SDK），支持：

- `OpenAICompatibleChatConfig(api_key, base_url, model, temperature, timeout_seconds)`。
- `call_chat_completion_text(...)`（同步，可 `stream=True` 内部转流式累积）。
- `stream_chat_completion_text(...)` 生成器逐 token yield，结束时 `return` 累积全文。
- 解析 OpenAI 风格 `choices[0].delta.content` / `message.content`（支持 list 内容块、`output_text`/`text_delta`、`reasoning_content`）。
- 错误类层次：`OpenAICompatibleError` → `ProtocolError` / `HttpError`（含 `is_auth_error`/`is_rate_limited`）/ `NetworkError`。
- 调用日志落 `external_ai_call_logs` 表（`infrastructure/llm/external_ai_call_logs.py`），供恢复与可观测。

各业务模块（english 的 `dashscope_gateway`、palace_quiz 的 `ai_service*`、palaces 的 `mindmap_import/llm_gateway` 等）在此之上构建场景化调用。AI 运行时选项统一由 `settings/application/ai_model_registry.py` 的 `normalize_ai_runtime_options` 规范化，按"场景 → 模型/思考开关"解析。

### 4.11 生产 Supervisor（`supervisor/runtime_supervisor*.py`）

`RuntimeSupervisor` 是一个发布/代理守护：

- 计算源指纹（`apps/api/src`、`alembic`、`apps/web/src|public|dist`、各配置/锁文件、`start.bat`；忽略 `.git`/`node_modules`/各类缓存/`runtime-data`）。
- 发布流程：构建前端 bundle（`tsc -b` + `vite build`）→ 快照 release 目录（拷 api src/alembic + web dist + 配置文件）→ `MEMORY_ANKI_STARTUP_MODE=prepare` 跑 `memory_anki.app.runtime_prepare` → 起后端 uvicorn（内部端口）→ 轮询 `/api/v1/runtime-health` 直到 ok → 提升为 current/candidate。
- 代理：按请求选择 release（candidate 路由策略、会话粘滞、宽限退役）。
- runtime generation 变化时**阻断**自动热发布，要求手动维护发布。
- 状态持久化到 `runtime-data/supervisor-state.json`，日志到 `runtime-data/logs/`。

---

## 5. 前端架构（apps/web）

### 5.1 技术栈

- React 19.2、react-router-dom 7、TanStack Query 5（`staleTime: 30_000`）。
- Vite 8 + `@vitejs/plugin-react` + `@tailwindcss/vite`（Tailwind 4）。
- `@xyflow/react`（思维导图画布）、`recharts`（图表）、`motion`（动画）、`howler`（音频）、`canvas-confetti`（庆祝）、`sonner`（toast）、Radix UI primitives（dialog/dropdown/switch/tabs/tooltip）、`lucide-react`（图标）、`nprogress`（路由进度条）、`react-markdown`、`dagre`（布局）。
- 测试：Vitest 3 + Testing Library + jsdom + MSW。

### 5.2 入口与 Provider 链

`src/main.tsx` → `createRoot(#root).render(<StrictMode><App/></StrictMode>)`。

`src/app/App.tsx`：

```tsx
<AppProviders>
  <AppShell>
    <AppRouter />
  </AppShell>
</AppProviders>
```

`AppProviders`（`src/app/providers/AppProviders.tsx`）装配顺序（外→内）：

1. `useMutationQueueAutoSync()` / `usePendingTimeRecordRecoveryAutoSync()`：离线变更队列与时间记录恢复自动同步。
2. `useEffect`：迁移遗留时间记录到后端、清理过期 app 日志、注册 `window.onerror`/`unhandledrejection` → `logAppError`。
3. `QueryClientProvider`（queryClient，`staleTime: 30_000`）。
4. `BrowserRouter` + `RouteProgressBar`（nprogress）。
5. `GlobalFeedbackProvider` → `GlobalTimerProvider` → `QuizLauncherProvider` → children + `<Toaster position="bottom-right" richColors />`。

### 5.3 路由与"驻留"（Route Residency）

`AppRouter.tsx` 实现了一个 **LRU 路由缓存**：维护 `cachedLocations`（pathname → Location）与 `activationTimes`，上限 `MAX_CACHED_ENTRIES = 12`，超过时按最久未激活驱逐（`computeLruEvictions` 纯函数，有单测）。每个缓存条目用 `<div style={{display}}>` + `RouteResidencyProvider` 包裹，活动条目可见，其余 `display:none` 但保留组件状态——这是为思维导图编辑器等重状态页面在切换间不丢状态。

`appRoutes.tsx` 定义实际 `<Routes>`：

```
/                          DashboardPage（直接 import，非 lazy）
/palaces                   PalaceShelfPage
/palaces/list              PalaceListPage
/palaces/new               PalaceEditPage
/palaces/:id               PalaceViewPage（lazy，预加载 preloadPalaceViewPage）
/palaces/:id/edit          PalaceEditPage
/palaces/:id/quiz          PalaceQuizPage
/palaces/:id/practice      PalacePracticePage（app/router 内）
/palaces/:id/focus-practice PalaceFocusPracticePage
/segments/:id/practice     SegmentPracticePage
/mini-palaces/:id/practice MiniPalacePracticePage
/mini-review/session/:id   MiniReviewSessionPage
/review                    ReviewOverviewPage
/review/session/:id        ReviewSessionPage
/review/feedback-preview   ReviewFeedbackPreviewRoute
/segment-review/session/:id SegmentReviewSessionPage
/segment-review/batch      BatchSegmentReviewSessionPage
/knowledge                 KnowledgePage（lazy）
/english                   EnglishWorkspacePage
/english/courses/:id       EnglishCoursePage
/english-reading           EnglishReadingPage
/profile                   ProfilePage
/profile/feedback          ProfileFeedbackPage
/profile/ai                ProfileAiPage
/profile/ai-prompts        → /profile/ai?tab=prompts
/profile/ai-split          → /profile/ai?tab=config
/profile/voice-coach       → /profile/ai?tab=config
/profile/backups           ProfileBackupsPage
*                          RouteNotFound（resolveRouteFallbackTarget 回退）
```

`resolveRouteFallbackTarget` 用正则把未知路径映射到安全父路由。

### 5.4 AppShell（侧边栏 + 主区）

`app/shell/AppShell.tsx`：

- 7 个导航区：仪表盘 / 记忆宫殿 / 英语听力 / 英语阅读 / 知识大纲 / 复习 / 个人中心。每个区有 `matches(pathname)` 与 `rememberLastVisited`；记忆最近访问 URL；hover/focus 时 `warmNavSection`（预取 palace shelf/grouped-summary、dashboard）。
- 顶栏（移动端汉堡）+ 桌面固定圆角侧栏（可折叠 84px/250px）。
- `RuntimeChannelBadge`：根据 `runtime-info` 显示 Stable/Dev + short commit + generation + app_home。
- 右上角：日志抽屉（`AppLogDrawer`）、数据同步抽屉（`MutationQueueDrawer`，冲突/失败/手动 时高亮 `CloudAlert`）。
- 主区顶部 `BackgroundTaskBar` + `QuizGenerationBubbleLayer`（后台任务气泡）。
- 启动时拉 `getRuntimeInfoApi()`。

### 5.5 FSD 分层与边界（`eslint.config.js` + `tools/check_architecture.py`）

层：`app` > `features` > `entities` > `shared`，低层不得 import 高层。

`eslint-plugin-boundaries` 规则（`default: 'disallow'`）：

- `app` → features/entities/shared/app
- `features` → entities/shared/features
- `entities` → shared/entities
- `shared` → shared

架构检查额外强制（精选）：

- 禁止 `@/shared/api/client`、`@/shared/api/modules/*`、`@/app/` 被 features/entities/shared 引用。
- `shared/` 不得 import `@/app/` 或 `@/features/`。
- `shared/lib/localStorage.ts` 不得硬编码业务偏好键（`memory_anki_dashboard_total_duration_filter`、`palace_list_view_settings`、`palace_shelf_view_settings`），也不得存在 `shared/preferences/localPreferenceRegistry.ts`。
- 已删除的聚合 API 模块（`shared/api/modules/{aiLogs,dashboard,knowledge,palaces,profile,quizzes,reviews,runtime,voiceCoach}.ts`、`features/palace-quiz/api/quizApi.ts`、`features/mini-palace/api/miniPalaceApi.ts`、`features/palace-segments/api/palaceSegmentsApi.ts`、`entities/palace/api/structureApi.ts`）不得复活。
- 思维导图导入工作流必须集中在 `features/mindmap-import`，palace-edit/knowledge 不得自持其副本。
- 生产代码必须经公共 barrel 引入 entity API（如 `entities/palace/api`），不得深引内部文件（`catalogApi`/`editorApi`/`practiceApi`/`stateApi`/`miniPalaceApi`/`palaceSegmentsApi`）。
- `app/router` 不得驻留业务页面（`DashboardPage`/`PalaceListPage`/`PalaceShelfPage`/`palace-view-settings`/`palace-list/` 目录）。
- 配置契约：`package.json` 的 `openapi:types` 必须指向 `http://127.0.0.1:8012/openapi.json`、`typecheck` 必须是 `tsc -b --noEmit`、`build` 必须以 `tsc -b` 开头、`packageManager` 必须 `npm@`、`vite.config.ts` 的 `/api` 代理必须指向 `127.0.0.1:8012`。

### 5.6 数据层（`shared/api`）

- `http.ts`：`API_BASE = '/api/v1'`。核心 `request<T>(url, options)`：
  - 自动加 `Content-Type: application/json` 与 `X-Memory-Anki-Mutation-ID`（写请求）。
  - 非 GET 默认进入**变更队列**（`persistence: { resourceKey, coalesceKey?, description, replayMode: 'manual'|'auto' }`），失败（5xx 或冲突类：409 / 文本含 `冲突|fingerprint|stale|旧态|危险结构|覆盖当前`）时入队 `mutationQueue.ts`，供 `MutationQueueDrawer` 手动/自动重放；成功且带 `coalesceKey` 时丢弃同 key 旧队列项。
  - 错误消息抽取：`detail`（string 或 `{message}`）/`error`/`message`/纯文本；附 `X-Request-ID`。
  - 全程 `logAppError`（feature/stage/error/requestSummary/responseSummary/requestId/meta）。
  - `uploadWithFormData` / `fetchWithMutationQueue` 用于 multipart 上传。
- `jsonResponse.ts`：`readJsonResponse<T>`、`extractResponseMessage`、`attachRequestId`（把 `request_id` 注入返回对象）。
- `sse.ts`：`parseSseEventBlock` 解析 SSE 块（event + 多行 data 拼接）。
- `contracts/`：按域分文件的 TypeScript 类型（palace/review/quiz/knowledge/dashboard/english/englishReading/imports/mindmap/aiLogs/profile/runtime），`index.ts` 统一 re-export。
- `generated.ts`：`openapi-typescript` 从后端 `openapi.json` 生成（`npm run openapi:types`，需后端在 8012 运行）。

### 5.7 实体/特性 API 分布（owner 表）

| 前端 API | 后端 owner |
|---|---|
| `entities/palace/api/{catalogApi,editorApi,practiceApi,stateApi}`（barrel `index.ts`） | 宫殿列表/编辑器/练习/状态 |
| `entities/mini-palace/api/miniPalaceApi` | 迷你宫殿 |
| `entities/palace-segment/api/palaceSegmentsApi` | 分段 |
| `entities/knowledge-import/api/importApi` | 导入预览/job |
| `entities/knowledge/api/knowledgeApi` | 学科/章节/文档 |
| `entities/quiz/api/quizApi` | 题目与生成 |
| `entities/preferences/api/{aiModelSettingsApi,clientPreferencesApi,reviewSettingsApi}` | 设置/偏好 |
| `entities/session/api/time-records` + `entities/session/model/*` | 时间记录与遗留迁移 |
| `entities/runtime/api/runtimeApi` | runtime-info |
| `entities/ai-log/api/aiLogsApi` | AI 调用日志 |
| `entities/review/model/*` | 复习流树/揭示会话 |
| `features/dashboard/api/dashboardApi` | 仪表盘（prefetch 机制） |
| `features/review/api/reviewApi` | 复习队列/提交 |
| `features/profile/api/profileApi` | 个人中心 |
| `features/english/api/englishApi` | 英语听力 |
| `features/english-reading/api/englishReadingApi` | 英语阅读 |
| `features/voice-coach/api/voiceCoach` | 语音教练 |
| `features/bilink/api/bilink` | 双向关联 |
| `features/palace-quiz/api/palaceQuizApi` | 仅页面级组合 |

`catalogApi.ts` 示例模式：`warmedPalaceGetCache` 提供"预热即消费"的一次性预取（`prefetchPalacesGroupedApi` 等），`invalidatePalaceCatalogCache` 派发 `palace-catalog:invalidated` 事件。

### 5.8 重要前端子系统

- **思维导图宿主**（`shared/components/mindmap-host/`）：`MindMapFrame` 把思维导图编辑器隔离在 iframe/host 桥接中（`hostBridgeUtils`、`hostEventDispatcher`、`useHostSyncController`、`useMindMapFeedback`、`useMindMapFeedbackAudioCoordinator`、`toneProfiles`、`legacyWebAudio`）。`shared/components/mindmap/` 是画布实现（`MindMapCanvas`、`TreeRenderer`、`NodeCard`、`layout`、`branchColors`、`adapter`）。
- **会话计时器**（`shared/components/session/`）：`GlobalTimerProvider` + `globalTimerModel` + `SessionTimerBar` + `TimerAutomationDialog` + `timer-{celebration,focus,automation}-config` + `timer-overlay-layout`。配套 `shared/hooks/useTimedSession*`（浏览器副作用、模型、恢复、快照、存储）。
- **离线变更队列**（`shared/persistence/`）：`mutationQueue.ts`（IndexedDB/localStorage 持久化）、`useMutationQueue.ts`、`MutationQueueDrawer.tsx`。
- **反馈中心**（`shared/feedback/`）：`GlobalFeedbackProvider`、`celebrationEngine`、`feedbackCenter`、`globalFeedback{Model,Profiles}`、`reviewFeedbackSettings`、`toast`。
- **后台任务**（`shared/background-tasks/`）：`backgroundTaskRegistry`（按 section 计数）、`BackgroundTaskBar`、`QuizGenerationBubbleLayer`、`TaskSteps`。
- **路由进度**（`shared/components/route-progress/`）：nprogress。
- **日志**（`shared/logs/`）：`appLogs.ts`（前端错误采集，过期清理）、`AppLogDrawer`。
- **偏好**（`shared/preferences/`）：`clientPreferences.ts`、`persistentPreferenceStore.ts`（通用传输/缓存/迁移原语；具体 schema/默认/key 归 `entities/preferences/model`）。
- **快捷键**（`shared/keyboard/shortcutBindings.ts` + `features/shortcuts/`）。
- **UI 原子**（`shared/components/ui/`）：badge/button/card/chart/confirm-dialog/dialog/dropdown-menu/input/label/skeleton/switch/tabs/textarea/tooltip（cva + tailwind-merge + clsx）。

### 5.9 测试约定

- Vitest 配置：`environment: 'jsdom'`、`globals: true`、`setupFiles: ['./src/test/setup.ts']`，别名 `@` → src。
- 大量 `*.test-support.tsx` / `*.test-utils.tsx` 作为共享测试夹具（被架构检查识别为测试文件，豁免公共面深引规则）。
- MSW 用于 API mock。

---

## 6. 构建与部署

### 6.1 前端构建（`vite.config.ts`）

插件链：

1. `memory-anki-manual-refresh-guard`（serve）：向 `index.html` head 前置注入脚本，patch `window.WebSocket`，拦截 Vite HMR 的 `update`/`full-reload`/`vite:ws:disconnect`，提示手动刷新。
2. `react()`、`tailwindcss()`。
3. `memory-anki-stable-chunk-compat`（build）：对 `stableChunkNames = {'PalaceEditPage','useMindMapImport'}` 这类需稳定文件名的 chunk，在 `writeBundle` 时为旧哈希名生成 re-export 别名文件，保证外部引用不断。
4. `memory-anki-manual-out-dir-cleanup`（build）：`buildStart` 清空 outDir（因 `emptyOutDir: false`）。

`build.rollupOptions.output`：

- `chunkFileNames`：稳定 chunk 用 `assets/[name].js`，其余 `assets/[name]-[hash].js`。
- `manualChunks`：`@xyflow/react` → `mindmap-vendor`、`recharts` → `chart-vendor`、`react/react-dom/react-router-dom` → `react-vendor`。
- `server.hmr: false` + `/api` 代理 `127.0.0.1:8012`。
- 别名 `@` → `./src`。

### 6.2 TypeScript 配置

`tsconfig.json` 引用 `tsconfig.app.json` + `tsconfig.node.json`。`tsconfig.app.json`：target es2023、module esnext、`moduleResolution: bundler`、`jsx: react-jsx`、`allowImportingTsExtensions`、`noEmit`、`paths: {"@/*": ["./src/*"]}`、`types: ["vite/client","vitest/globals"]`。`tsconfig.node.json` 覆盖 vite/vitest/eslint 配置文件。

### 6.3 CI（`.github/workflows/ci.yml`）

两个 job（`ubuntu-latest`）：

- **backend**：Python 3.12、装 `requirements-dev.txt` + `pip install -e .`、跑 `pytest` / `ruff check src tests` / `mypy` / `lint-imports` / `python ../../tools/check_architecture.py`。
- **frontend**：Node 24、`npm ci`、`typecheck` / `lint` / `test` / `build`。

触发：PR + push 到 `main`。

### 6.4 运行时目录布局（`MEMORY_ANKI_HOME`）

```text
<APP_HOME>/
├── data/
│   ├── memory_palace.db           SQLite（WAL：.db-wal/.db-shm）
│   ├── attachments/               宫殿附件 + subjects/（学科 PDF）
│   └── backups/{full,rescue}/     周期/手动/紧急备份
├── english/{media,tasks}/         英语听力媒体与 ASR 任务
├── english_reading/lexicon/cefr.json
├── import_jobs/                   思维导图导入任务工件
├── ai_call_logs/                  外部 AI 调用工件
├── voice_coach/                   TTS 缓存
├── migration-state.json           共享 generation / 启动记录 / app 迁移标记
└── shared-home.txt                （可选）共享 home 指向
```

supervisor 另用 `runtime-data/`（仓库内，但被 gitignore）：`runtime/active-instances/*.json`、`logs/runtime-launcher.log`、`data/backups/full/*-periodic/`。

---

## 7. 架构契约速查（`docs/architecture/README.md` + `tools/check_architecture.py`）

### 7.1 原则

- 模块内高内聚、跨模块低耦合；运行时数据永不入库；行为经显式契约而非重复 DTO；前端只持久化 UI 局部临时态，业务态归后端；每个业务数据有唯一 owner；生成产物与工具缓存不是源。

### 7.2 关键规则

- Presentation 依赖 application + contracts，永不碰别模块 infrastructure。
- shared 必须行为无关。
- 新持久化数据需后端 owner + 测试。
- 新模块必须有 contracts、service 测试、边界安全 import。
- API 契约是前后端唯一真相，接口变更需同步后端 schema、前端契约/生成类型、契约测试。
- 文件按边界拆分（域策略 / 应用命令查询 / 表现 schema-router / 前端 model-hook-component），不得按行数硬切。
- 跨边界变更必须在 PR 描述显式列出（契约/存储/运行时/生成类型/架构规则）。
- 运行时/配置契约（`runtime-contract.json`、`storage-layout.json`、`package.json`、`vite.config.ts`、生成 API 契约）必须与 `check_architecture.py` 与聚焦测试同步变更。
- 重构必须清除被替代的门面/入口/重复 DTO/陈旧配置键/孤儿测试/生成产物；临时兼容 shim 需 owner、范围、移除条件、回归测试。

### 7.3 AI 协作提示词（文档原文）

> 编辑前先读 `docs/architecture/README.md`、`CONTRIBUTING.md` 与相关 owner 模块；保持后端模块归属、前端 FSD 分层、契约作为唯一真相；不得穿越别 owner 的私有内部、import 私有 infrastructure、为方便复制 DTO。需要共享时，把代码移到最窄合法 owner 或公开契约。若必须弯曲边界，说明原因、点名风险、加最小有用测试。先读 `git status`，保留他人并行工作，不要回滚别人改动。

---

## 8. 从零重建步骤（给重建者的操作清单）

1. **建仓库骨架**：按第 2 节创建目录与根文件（`.gitignore`/`.editorconfig`/`.env.example`/`README.md`/`CONTRIBUTING.md`/`start.bat`）。`.gitignore` 必须含 `/data/`、`*.db`、`*.sqlite3`、`*.log`、`*.egg-info/`。
2. **后端骨架**：
   - `apps/api/pyproject.toml`（setuptools、`package-dir = {"" = "src"}`、ruff `E,F,I,B,UP` 忽略 `B008,E501,E712`、mypy 含 sqlalchemy 插件、importlinter 两条 forbidden 契约、pytest `testpaths=["tests"] pythonpath=["src"]`）。
   - `requirements.txt`（fastapi 0.115、uvicorn[standard] 0.30.6、sqlalchemy 2.0.35、jinja2、python-multipart、markdown、aiofiles、alembic 1.16.4、PyMuPDF 1.26.4、pydantic-settings、python-dotenv、ruff、mypy、import-linter）+ `requirements-dev.txt`（`-r requirements.txt` + pytest 8.3.4 + httpx 0.27.2）。
   - `alembic.ini` + `alembic/env.py` + 5 个 versions（见 4.7）。
   - `runtime-contract.json`（generation 全 1）+ `storage-layout.json`（见 4.5）。
3. **core**：`config.py`（EnvSettings + 路径解析 + DEFAULTS 字典 + `ensure_runtime_dirs`）、`time.py`（UTC naive）、`runtime.py`、`storage_layout.py`、`migration.py`、`logging.py`、`request_context.py`、`request_logging.py`、`runtime_activity.py`、`prompt_text.py`。
4. **infrastructure**：`db/_tables/_base.py`（engine + Base + PRAGMA + get_session + init_db）、五个域表文件、`models.py` 门面、`migrations.py`、`llm/openai_compatible.py` + `external_ai_call_logs.py` + `config_helpers.py`。
5. **modules**：按 4.3 实现 13 个模块，严格遵守 domain/application/infrastructure/presentation 边界与跨模块公开 service 契约。路由按 4.8 注册。
6. **app**：`main.py`（lifespan + 中间件 + 路由挂载 + 静态）、`startup_runtime.py`（启动模式与初始化）、`runtime_prepare.py`。
7. **supervisor**：`runtime_supervisor.py` + `_lifecycle` + `_proxy` + `_support`。
8. **前端骨架**：`package.json`（依赖与脚本见 5.1/3.5）、`vite.config.ts`、`vitest.config.ts`、三份 tsconfig、`eslint.config.js`、`index.html`。
9. **前端源码**：按 5.2–5.8 实现 `main.tsx` → `app/{App,providers,router,shell}` → `entities/*/api|model` → `features/*` → `shared/{api,components,hooks,lib,feedback,persistence,preferences,background-tasks,logs,keyboard,routing}`。
10. **共享资源**：`apps/shared/english-reading-cefr.json`（CEFR 词表，~480KB）+ `english-token-vectors.json`。
11. **tools**：`check_architecture.py`（完整复制，它是可执行契约）、`start_supervisor.py`、`runtime_supervisor.py`、`configure-shared-home.ps1`、`create_startup_backup.py`。
12. **CI**：`.github/workflows/ci.yml`。
13. **验证**：分别跑后端 5 条 + 前端 4 条 + `git ls-files -ci --exclude-standard`（空）。

---

## 9. 备注与重建要点

- **单一端口模型**：生产时 FastAPI 既出 API 又出 SPA；`SinglePageAppStaticFiles` 是 SPA fallback 的关键（无后缀 GET/HEAD 404 → 回 index.html）。
- **HMR 关闭**：前端开发体验是"手动刷新"，由 vite 插件与 WebSocket patch 共同保证；重建时务必照搬，否则思维导图编辑器会出状态错乱。
- **变更队列**：所有写请求默认入队，是离线/冲突恢复的核心；重建 `request()` 时务必保留 mutation-id、coalesce、冲突判定（含中文关键词）与 5xx/409 入队逻辑。
- **迁移只进不退**：SQLite + 共享 runtime home 要求迁移尽量 additive；破坏性迁移必须带 `memory-anki: allow-destructive-migration` 标注。
- **AI 场景模型**：`DEFAULTS` 中 `scene_model_*` 与 `ai_model_*`/`flow_voice_*`/`mindmap_ai_split_*` 是 AI 行为的种子；`settings/ai_model_registry*` 提供目录、场景映射、provider 测试、思考开关。
- **OpenAPI 类型**：前端 `shared/api/generated.ts` 由 `npm run openapi:types` 从运行中的后端生成，非手写。
- **stable chunk**：`PalaceEditPage` 与 `useMindMapImport` 需稳定文件名（无哈希），因外部/host 桥接按名引用；vite 插件为其生成旧哈希别名。
- **运行时 generation**：升级破坏性数据格式时需 bump `runtime-contract.json` 的 `runtime_generation`，supervisor 据此阻断自动热发布、要求手动维护。
- **测试即契约**：大量 `*.test-support.tsx` 既是测试夹具也被架构检查豁免；删除/移动它们会触发边界规则。

---

*本文档与 `docs/architecture/README.md`、`CONTRIBUTING.md`、`tools/check_architecture.py` 一致；当实现与本文档冲突时，以代码与 `check_architecture.py` 为准，并同步更新本文档。*
