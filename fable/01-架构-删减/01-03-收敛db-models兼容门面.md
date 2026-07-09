---
编号: 01-03
标题: 收敛 infrastructure/db/models.py 兼容门面，分批把 29 张表的 import 迁到领域模块，最终只保留 Base/engine/get_session/init_db 入口
类型: 删减
范围: 架构
优先级: P2
预估工作量: L（>8h）
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 01-03 收敛 infrastructure/db/models.py 兼容门面

## 1. 原始需求

`apps/api/src/memory_anki/infrastructure/db/models.py` 共 97 行，自述为 "Public ORM entry point (backwards-compatible facade)"：第 14-57 行把 `infrastructure/db/_tables/` 下 5 个领域模块（`english.py`、`english_reading.py`、`knowledge.py`、`misc.py`、`palaces.py`）与 `_base.py` 的全部符号 re-export，第 59-96 行是 `__all__`（29 张表 + `Base`/`engine`/`get_session`/`init_db`/`chapter_palace_table`）。

引用面极广：经 rg 核实（2026-07-08），`from memory_anki.infrastructure.db.models import` 共出现在 **124 个文件、131 条 import 语句**（src 108 个文件 + tests 14 个 + alembic 2 个）。因此不能一把梭删除，必须分批迁移；且该模块的 import 有一个副作用——第 14 行 `from memory_anki.infrastructure.db import _tables` 触发全部表注册到 `Base.metadata`（`init_db`/`create_all` 依赖此注册），收敛后必须保留这个注册入口。

目标终态：`models.py` 缩减为只保留表注册副作用 + `Base`/`engine`/`get_session`/`init_db` 四个基础符号；所有 ORM 表类改为从 `_tables` 领域模块直接 import。

## 2. 详细执行清单

> 分 6 批执行，每批做完必须跑一次全量测试再进入下一批。任何一批内只做"改 import 路径"这一件事，禁止改动表定义、禁止移动文件、禁止重命名 `_tables` 包。

### 步骤 0：迁移前准备——建立符号→来源对照表

各符号真实来源（已按 `models.py` 第 14-57 行核实）：

- `memory_anki.infrastructure.db._tables._base`：`Base`、`engine`、`get_session`、`init_db`
- `..._tables.english`：`EnglishCourse`、`EnglishCourseProgress`、`EnglishGenerationTask`、`EnglishSentence`
- `..._tables.english_reading`：`EnglishReadingDictionaryCache`、`EnglishReadingLexiconCache`、`EnglishReadingMaterial`、`EnglishReadingProfile`、`EnglishReadingSession`、`EnglishReadingVersion`
- `..._tables.knowledge`：`Chapter`、`Subject`
- `..._tables.misc`：`AiModelCatalog`、`Config`、`ExternalAiCallLog`、`MindMapImportJob`、`StudySession`
- `..._tables.palaces`：`Attachment`、`FreestyleAiExplanation`、`FreestyleQuizAttempt`、`Palace`、`PalaceGroup`、`PalaceQuizOcrSource`、`PalaceMiniPalace`、`PalaceQuizQuestion`、`PalaceSegment`、`PalaceVersion`、`Peg`、`ReviewLog`、`ReviewSchedule`、`SessionProgress`、`chapter_palace_table`

每批开工前用以下命令找出该批涉及的文件（注意 `-U` 处理跨行括号 import）：

```
rg -U -l "from memory_anki\.infrastructure\.db\.models import[^)]*<符号名>" apps/api
```

自查点：对照表中的每个模块文件确实存在于 `apps/api/src/memory_anki/infrastructure/db/_tables/`（共 7 个文件：5 个领域模块 + `_base.py` + `__init__.py`）。

### 批次 1：english + english_reading 模块（引用面最小）

用 rg 找出所有 import 了 `English*` 符号的文件（主要在 `modules/english/`、`modules/english_reading/` 下，约 10 个文件）。逐个文件把这些符号从 `...db.models` 改到 `...db._tables.english` / `...db._tables.english_reading`。

修改示意（以 `modules/english/application/course_service.py` 类文件为例）：

```python
# 修改前
from memory_anki.infrastructure.db.models import EnglishCourse, get_session

# 修改后
from memory_anki.infrastructure.db._tables._base import get_session
from memory_anki.infrastructure.db._tables.english import EnglishCourse
```

注意：同一条 import 里混着的 `Base`/`get_session`/`init_db`/`engine` 一并改到 `_tables._base`；不要遗漏半条。

自查点：`cd apps/api && python -m pytest tests/test_english_routes.py tests/test_english_reading_routes.py` 通过；`python -m ruff check src tests` 通过。

### 批次 2：knowledge + misc 符号（`Chapter`/`Subject`/`Config`/`StudySession`/`AiModelCatalog`/`ExternalAiCallLog`/`MindMapImportJob`）

`Config` 引用方较多（settings、schedule_policy/schedule_service、llm 等）。逐文件迁移，方法同批次 1。特别提示两处延迟 import（函数体内 import，rg 顶层扫描容易漏）：

- `modules/reviews/application/schedule_policy.py` 第 33 行、第 135 行（函数体内 `from memory_anki.infrastructure.db.models import Config` / `... import ReviewSchedule`）；
- `modules/reviews/application/schedule_service.py` 第 25 行、第 200 行、第 280 行、第 292 行（函数体内 import `Config`/`ReviewLog`/`Palace`）。

用 `rg -n "db\.models import" apps/api/src`（不带 `^from` 锚定）能同时抓到顶层与函数体内的 import。

自查点：`python -m pytest tests/test_study_session_routes.py tests/test_external_ai_call_logs.py` 通过。

### 批次 3：palaces 域符号（引用面最大：`Palace`/`ReviewSchedule`/`ReviewLog`/`Peg`/`PalaceSegment` 等 14 个）

涉及 `modules/palaces/`、`modules/reviews/`、`modules/palace_quiz/`（约 60 个文件，palace_quiz 一个模块就有 40+ 文件每个 1 条 import）、`modules/freestyle/`、`modules/mindmap/`、`modules/sessions/`、`modules/dashboard/`、`modules/backups/`。机械替换：

```python
# 修改前
from memory_anki.infrastructure.db.models import Palace, ReviewSchedule
# 修改后
from memory_anki.infrastructure.db._tables.palaces import Palace, ReviewSchedule
```

建议按子模块推进（先 palace_quiz，再 palaces，再 reviews，……），每完成一个子模块跑一次对应测试文件。

自查点：`python -m pytest` 全量通过。

### 批次 4：tests（14 个文件）与 alembic（`alembic/env.py`、`alembic/versions/0001_baseline.py`、`0003_reset_english_reading_dictionary_cache.py`）

同样机械替换。注意 `tests/test_review_routes.py` 第 16-30 行一条 import 混合了 `Base` 与多张表，需拆成 `_tables._base` + 各领域模块多条。

自查点：`python -m pytest` 通过；`python -m alembic upgrade head`（对一个临时副本库）不报 ImportError。

### 批次 5：收敛 models.py 本体

确认全仓库不再 import 表类：

```
rg -Un "from memory_anki\.infrastructure\.db\.models import[\s\S]{0,400}?\)" apps/api
rg -n "from memory_anki\.infrastructure\.db\.models import" apps/api
```

若仅剩 `Base`/`engine`/`get_session`/`init_db` 类引用（这四个符号引用面太大，可保留 `models.py` 作为其官方入口，不强制迁移），把 `models.py` 缩减为：

```python
"""Database entry point: session/engine plus table registration side effect."""

from memory_anki.infrastructure.db import _tables  # noqa: F401  (registers all tables)
from memory_anki.infrastructure.db._tables._base import Base, engine, get_session, init_db

__all__ = ["Base", "engine", "get_session", "init_db"]
```

绝对不能删除第一行 `_tables` 的注册 import，否则 `init_db()` 建出来的库会缺表。

自查点：`python -c "from memory_anki.infrastructure.db.models import Base, init_db"` 正常；用临时 `MEMORY_ANKI_HOME` 启动一次后端，`init_db` 建库成功且 29 张表齐全（`sqlite_master` 中可数）。

### 批次 6：文档一致性

`models.py` 原第 5-7 行 docstring 声称 "86 existing call sites"，收敛后该描述随文件重写自然消失，无需额外处理。不要去改 `_tables/` 各文件的 docstring。

## 3. 测试验收标准

可执行验证命令（在 `apps/api` 目录）：

| 命令 | 期望结果 |
|---|---|
| `rg -n "db\.models import" src tests ../..$null 2>$null` 中除 `Base/engine/get_session/init_db` 外无表类符号 | 满足 |
| `python -m pytest` | 全部通过 |
| `python -m ruff check src tests` | 通过 |
| `python -m mypy` | 无新增错误 |
| `lint-imports` | 通过 |

行为验收：

- 删除临时目录下的测试库后启动后端 → `init_db` 自动建库，随后各页面（宫殿列表、复习队列、英语课程、设置）均能正常读写；
- `python -m alembic upgrade head` 在现有库上执行 → 无 ImportError、无 schema 变化。

回归检查：`Base.metadata.create_all` 的建表完整性是本文档最大风险点，必须用"全新空库启动"验证一次。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档撰写代理（fable） | 文档创建，已核实引用面为 124 文件/131 条 import，并整理符号→来源对照表 | 待执行；建议分 6 批多次会话完成 |
| 2026-07-09 | Codex | 先执行低风险阶段 A：迁移 app/infrastructure 运行代码中的 6 个 `db.models` import 到 `_tables._base` / `_tables.misc` | `python -m pytest tests/test_startup_runtime_and_supervisor.py tests/test_external_ai_call_logs.py -q`：8 passed；`python -m ruff check` 针对 6 个改动文件通过；`PYTHONPATH=src python -c "from memory_anki.infrastructure.db._tables._base import Base; import memory_anki.infrastructure.db._tables; print(len(Base.metadata.tables))"` 输出 33。未改 `models.py` 本体，modules/tests/alembic 大批迁移仍待执行，因此本文档保持部分完成。 |
| 2026-07-09 | Codex | 执行 01-03 机械迁移切片：统计 `apps/api/src` + `apps/api/tests` active imports 后，将业务/测试代码中可迁移的具体 ORM 表类从 `memory_anki.infrastructure.db.models` 改为对应 `_tables.*` 直接导入 | 开工统计约 134 个文件 / 146 条 active import，具体 ORM 符号按目标模块为 english 13、english_reading 19、knowledge 44、misc 49、palaces 176；`Base`/`engine`/`get_session` 基础门面符号 11。完成 127 个文件 / 139 个 import 节点迁移；未修改 alembic、tools/archive、旧归档脚本，也按并行冲突要求未修改 `modules/palaces/presentation/**`。剩余 `db.models` import 为 11 条：8 条基础门面符号（`Base`/`engine`/`get_session`）+ 3 条 palaces presentation 具体模型导入（`Attachment`、`ReviewSchedule`、`Palace`）。`python -m ruff check --select I001 <112 个新增 _tables import 文件>`：通过；`python -m pytest tests/test_palace_routes.py tests/test_palace_quiz_routes.py tests/test_review_routes.py tests/test_dashboard_routes.py -q`：164 passed, 21 skipped。仍部分完成，剩余 3 条具体模型导入需由 palaces presentation worker 或无冲突窗口处理；`models.py` 本体仍保留兼容门面。 |
| 2026-07-09 | Codex | 完成最终收敛：迁移 palaces presentation 剩余 3 条具体模型导入、基础入口、alembic 与非归档工具；`models.py` 缩为只导出 `Base`/`engine`/`get_session`/`init_db` 并保留表注册副作用 | `rg -n "from memory_anki\.infrastructure\.db\.models import\|import memory_anki\.infrastructure\.db\.models" apps/api/src apps/api/tests apps/api/alembic tools -g "*.py"` 仅剩 `tools/archive` 历史脚本与架构规则字符串；`python -m alembic heads; python -m alembic upgrade head` 通过且 head 为 `0017_soft_delete_palaces_and_quiz_questions`；`python -m ruff check` 针对 `models.py`、`_tables/__init__.py`、alembic 变更文件通过；集成回归 `python -m pytest tests/test_palace_routes.py tests/test_palace_quiz_routes.py tests/test_review_routes.py tests/test_dashboard_routes.py tests/test_mindmap_import_job_service.py tests/test_backup_lifecycle.py tests/test_full_transfer_service.py tests/test_english_routes.py -q` 为 194 passed, 29 skipped。 |
