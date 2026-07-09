---
编号: 01-03
标题: 收敛 infrastructure/db/models.py 兼容门面，调用方渐进迁移到 _tables/ 子模块
类型: 删减
范围: 架构
优先级: P2
预估工作量: M（2-8h）
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 01-03 收敛 infrastructure/db/models.py 兼容门面

## 1. 原始需求

`apps/api/src/memory_anki/infrastructure/db/models.py` 共 97 行，是 ORM 表拆分后的向后兼容门面：
re-export `_tables/` 下 5 个领域子模块的全部 29 张表 + `Base`/`engine`/`get_session`/`init_db` 共 33 个符号。
文件头注释自称服务于 "86 existing call sites"，**实测引用量已增长到 124 个文件**
（`rg -l "from memory_anki.infrastructure.db.models import|from memory_anki.infrastructure.db import models"`：
src 107 个、tests 14 个、alembic 3 个）。

问题：(a) 注释里的引用计数已失真；(b) 双入口并存（`models` 与 `_tables.*`）导致新代码随机选择 import 路径；
(c) 124 个引用点意味着"一次性删除门面"风险极高。因此本文档给出**渐进收敛方案**：先收窄门面职责与文档口径、
冻结新增引用，再分批迁移，最后一批完成后才允许删除门面。本文档本身只要求完成阶段 A（低风险、可独立验收），
阶段 B/C 作为后续批次的操作手册。

## 2. 详细执行清单

### 符号 → 子模块对照表（迁移时照抄）

| 子模块（均在 `memory_anki.infrastructure.db._tables` 下） | 符号 |
|---|---|
| `_base` | `Base`, `engine`, `get_session`, `init_db` |
| `english` | `EnglishCourse`, `EnglishCourseProgress`, `EnglishGenerationTask`, `EnglishSentence` |
| `english_reading` | `EnglishReadingDictionaryCache`, `EnglishReadingLexiconCache`, `EnglishReadingMaterial`, `EnglishReadingProfile`, `EnglishReadingSession`, `EnglishReadingVersion` |
| `knowledge` | `Chapter`, `Subject` |
| `misc` | `AiModelCatalog`, `Config`, `ExternalAiCallLog`, `MindMapImportJob`, `StudySession` |
| `palaces` | `Attachment`, `FreestyleAiExplanation`, `FreestyleQuizAttempt`, `Palace`, `PalaceGroup`, `PalaceQuizOcrSource`, `PalaceMiniPalace`, `PalaceQuizQuestion`, `PalaceSegment`, `PalaceVersion`, `Peg`, `ReviewLog`, `ReviewSchedule`, `SessionProgress`, `chapter_palace_table` |

**关键机制提醒**：`models.py` 第 14 行 `from memory_anki.infrastructure.db import _tables  # noqa: F401`
负责把全部表注册进 `Base.metadata`（`init_db`/`create_all` 依赖）。任何"直接 import `_tables._base.init_db`"
的代码路径必须保证 `_tables` 包（其 `__init__.py` 会 import 全部领域子模块）已被加载。先打开
`apps/api/src/memory_anki/infrastructure/db/_tables/__init__.py` 确认它确实 import 了全部子模块，再开始迁移。

### 阶段 A（本文档验收范围）：修正门面口径 + 冻结增量

#### 步骤 A1：更新 models.py 文件头注释

打开 `apps/api/src/memory_anki/infrastructure/db/models.py`，把第 1-12 行 docstring 中的
`the 86 existing ... call sites` 一句改为如实描述，并注明门面已冻结。修改后示意：

```python
"""Public ORM entry point (backwards-compatible facade).

DEPRECATED for new code: import tables directly from
``memory_anki.infrastructure.db._tables.<domain>`` instead. This facade is
kept only until existing call sites (~124 files as of 2026-07) are migrated
per fable/01-架构-删减/01-03; do not add new imports of this module.

Importing this module also triggers registration of every table against
``Base.metadata`` (via the ``_tables`` package import), which is required for
``init_db`` / ``Base.metadata.create_all`` to build the full schema.
"""
```

- 只改 docstring 文本，不要改任何 import 行或 `__all__`。
- **自查点**：`python -m ruff check src/memory_anki/infrastructure/db/models.py` 通过。

#### 步骤 A2：迁移 app 层 3 个引用（示范批次，量小可回退）

逐个修改以下文件的 import（表符号按上方对照表定位）：

1. `apps/api/src/memory_anki/app/main.py` 第 28 行：

```python
# 修改前
from memory_anki.infrastructure.db.models import get_session as _get_session
# 修改后
from memory_anki.infrastructure.db._tables._base import get_session as _get_session
```

2. `apps/api/src/memory_anki/app/startup_runtime.py` 第 17 行：

```python
# 修改前
from memory_anki.infrastructure.db.models import Config, get_session, init_db
# 修改后
from memory_anki.infrastructure.db._tables import _tables_registered  # 见下方说明，如无此符号则改为下一行方案
```

实际推荐写法（无需新增符号，`_tables/__init__.py` 已注册全部表）：

```python
from memory_anki.infrastructure.db._tables._base import get_session, init_db
from memory_anki.infrastructure.db._tables.misc import Config
```

注意：`startup_runtime.run_prepare_runtime()`（第 83-106 行）调用 `init_db()` 建全库。
`_tables._base` 被 import 时，`_tables/__init__.py` 是否被执行取决于 Python 包机制——
`import a.b.c` 会先执行 `a.b` 的 `__init__.py`，所以 `from ..._tables._base import init_db`
一定会先执行 `_tables/__init__.py` 完成全表注册，`create_all` 不会漏表。此结论务必用步骤 A4 的冒烟脚本验证。

3. `apps/api/src/memory_anki/app/startup_warmup.py`（第 1-20 行内的 models import）：同样按对照表替换。

- **自查点**：`cd apps/api && python -m pytest tests/test_startup_runtime_and_supervisor.py` 通过。

#### 步骤 A3：迁移 infrastructure 层内部引用（2 个文件）

- `apps/api/src/memory_anki/infrastructure/db/maintenance.py`
- `apps/api/src/memory_anki/infrastructure/llm/external_ai_call_logs.py`、`infrastructure/llm/config_helpers.py`

打开每个文件，把 `from memory_anki.infrastructure.db.models import X, Y` 按对照表改为对应 `_tables.*` import。
基础设施层内部不应再绕道公共门面。

- **自查点**：`python -m pytest tests/test_external_ai_call_logs.py` 通过。

#### 步骤 A4：全表注册冒烟验证

```powershell
cd D:\322321\Memory-Anki\apps\api
python -c "from memory_anki.infrastructure.db._tables._base import Base; import memory_anki.infrastructure.db._tables; print(len(Base.metadata.tables))"
```

期望输出 29（当前全部表数量）。若小于 29，说明存在"绕过 `_tables/__init__.py` 导致漏注册"的路径，停止迁移并回退本批次。

### 阶段 B（后续批次手册，不在本文档验收内）：modules 按模块分批迁移

按模块为单位分批（每批一个 PR/一次提交，批间跑全量 pytest）：
`reviews` → `palaces` → `palace_quiz` → `english`/`english_reading` → `freestyle`/`dashboard`/`sessions`/`settings`/`knowledge`/`mindmap`/`backups`/`persistence`。
每个文件的机械操作：

1. 找到 `from memory_anki.infrastructure.db.models import (...)`。
2. 按对照表把符号分组到各子模块，写成多条 import。
3. 该文件内其他行一律不改。
4. 每改完一个模块跑 `python -m pytest` + `python -m ruff check src tests` + `lint-imports`。

### 阶段 C（最终批次手册）：tests、alembic 与删除门面

1. 迁移 `apps/api/tests/` 下 14 个文件（同机械操作）。
2. alembic 三处（`alembic/env.py`、`versions/0001_baseline.py`、`versions/0003_reset_english_reading_dictionary_cache.py`）：
   `env.py` import models 是为了拿 `Base.metadata` 做 autogenerate 目标，可改为
   `from memory_anki.infrastructure.db._tables._base import Base` + `import memory_anki.infrastructure.db._tables  # noqa: F401`。
   **历史迁移脚本（0001/0003）原则上不改**——它们只在旧库升级时执行；若保留它们对 models 的 import，则门面不能删除，
   替代方案是把 0001/0003 中的 import 一并改为 `_tables` 路径（迁移脚本只引用符号、不引用文件内容哈希，可安全修改）。
3. 确认 `rg -n "infrastructure.db.models" apps tools` 无匹配后，删除 `models.py`。
4. 检查 `tools/check_architecture.py` 与 `pyproject.toml` 是否引用 `infrastructure.db.models` 字符串，如有同步清理。

### 明确不要做的事

1. 阶段 A 不要迁移 modules/ 与 tests/ 下的任何文件（那是阶段 B/C 的事，分批降险）。
2. 不要移动/重命名 `_tables/` 下任何文件，不要合并子模块。
3. 不要修改任何表定义（列、索引、关系）。
4. 不要在迁移中"顺手"清理调用方文件里的其他 import 或代码。
5. 阶段 A/B 期间不要删除 `models.py`。

## 3. 测试验收标准

（以下针对阶段 A；阶段 B/C 每批次复用同一组命令）

### 可执行命令

| 命令 | 期望结果 |
|---|---|
| `cd apps/api && python -m pytest` | 全部通过 |
| `cd apps/api && python -m ruff check src tests` | 无报错 |
| `cd apps/api && lint-imports` | 契约通过 |
| `cd apps/api && python -c "from memory_anki.infrastructure.db._tables._base import Base; import memory_anki.infrastructure.db._tables; print(len(Base.metadata.tables))"` | 输出 `29` |
| `rg -n "infrastructure.db.models" apps/api/src/memory_anki/app apps/api/src/memory_anki/infrastructure` | 阶段 A 完成后无匹配 |

### 行为验收（人工）

1. 删除（或改名备份）本机 `APP_HOME/data/memory_palace.db` 前先做好备份，然后以 `MEMORY_ANKI_HOME` 指向临时目录启动后端 → `init_db` 能建出全部 29 张表（用任意 SQLite 工具核对表数量）。
2. 正常启动后端并打开前端首页/宫殿列表/复习队列 → 数据读取正常，无 500。

### 回归检查

- `Base.metadata.create_all` 建表数量不减少（29 张）。
- alembic 升级链（`alembic upgrade head`）不报 import 错误。
- 启动种子逻辑（`_seed_default_config_rows`，依赖 `Config` 表）不受影响。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；实测引用 124 个文件（src 107 / tests 14 / alembic 3），与 docstring 声称的 86 不符；制定 A/B/C 渐进方案 | - |
