---
编号: 02-05
标题: 为 knowledge 模块补建 application 层（subject_service / chapter_service）
类型: 优化
范围: 架构
优先级: P1
预估工作量: M
依赖文档: [02-01]
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09 03:41 +08:00
---

# 02-05 为 knowledge 模块补建 application 层

## 0. 完成摘要

已与同编号主文档同步完成。当前实现没有采用旧稿建议的单文件 `knowledge_service.py`，而是按实际代码职责拆为：

- `apps/api/src/memory_anki/modules/knowledge/application/subject_service.py`
- `apps/api/src/memory_anki/modules/knowledge/application/chapter_service.py`
- `apps/api/src/memory_anki/modules/knowledge/application/__init__.py`

迁移内容包括 subject 序列化/CRUD/树/编辑器状态、chapter 序列化/详情/CRUD/递归删除/删除影响统计、宫殿章节绑定读写。`presentation/router.py` 仅保留请求解析、幂等入口、`HTTPException`/`JSONResponse` 兼容和 service 调用；基于 02-04 之后的当前行为实现，保留 404、force 删除 409、分页、幂等写入和内部错误兼容响应。

验收结果：

- `python -m pytest tests/test_knowledge_routes.py tests/test_palace_chapter_binding.py tests/test_mini_palace_routes.py -q`：24 passed, 1 skipped
- `python -m ruff check src/memory_anki/modules/knowledge tests/test_knowledge_routes.py tests/test_palace_chapter_binding.py`：All checks passed
- `rg -n "fastapi" src/memory_anki/modules/knowledge/application`：零匹配
- `rg -n "s\.query\(" src/memory_anki/modules/knowledge/presentation/router.py`：零匹配

说明：当前 router 因保留分页、幂等和错误兼容包装，收敛为 193 行，未强行压到旧稿预估的 150 行以内。

## 1. 原始需求

`modules/knowledge/` 是全后端唯一没有 application 层的业务模块——目录下仅有 `presentation/router.py`（301 行）一个文件。路由函数直接做 ORM 查询（`s.query(Subject)`、`s.query(Chapter)`）、直接借用 mindmap 模块（`editor_state_service` 的 get/save/sync）与 palaces 模块（`title_sync_service` 的绑定协调）的应用服务，序列化函数 `chapter_json`/`subject_json`（第 41–61 行）也长在 presentation 里，其他模块无法复用。目标：新建 `modules/knowledge/application/knowledge_service.py`，把查询、树构建、面包屑、级联删除、宫殿章节关联等业务逻辑抽入，router 收敛为"解析请求 → 调服务 → 返回"。

核实到的路由清单（`presentation/router.py`）：学科 CRUD（66–100 行）、章节树 `GET /subjects/{id}/tree`（105）、学科编辑器 GET/PUT（118/129）、章节详情+面包屑 `GET /chapters/{id}`（169–201）、章节 CRUD（204–265，含 `_delete_recursive` 递归删除）、宫殿章节关联 GET/PUT（270–299）。

## 2. 详细执行清单

> 硬约束：本文档是纯"搬运抽层"，不修任何 bug、不改任何响应 JSON 的键与值；N+1 修复归 02-08，错误风格归 02-04，print 调试清理归 01-06——都不要在这里做。改动范围限于 `modules/knowledge/` 内的新增文件与 `presentation/router.py`。

### 步骤 1：建包骨架

新建空文件：

```
apps/api/src/memory_anki/modules/knowledge/__init__.py        （若不存在）
apps/api/src/memory_anki/modules/knowledge/application/__init__.py
```

自查点：`python -c "import memory_anki.modules.knowledge.application"` 成功。

### 步骤 2：抽序列化函数

新建 `apps/api/src/memory_anki/modules/knowledge/application/knowledge_serializers.py`，把 router 第 41–61 行的 `chapter_json`、`subject_json` **原样搬入**（含递归与 `palace_count` 逻辑），文件头 import：

```python
from memory_anki.infrastructure.db.models import Chapter, Subject
```

router 中删除这两个函数，改为 `from memory_anki.modules.knowledge.application.knowledge_serializers import chapter_json, subject_json`。

自查点：`python -m pytest tests/test_palace_chapter_binding.py -q` 通过（该文件覆盖 knowledge 相关路由）。

### 步骤 3：新建 knowledge_service.py 并逐路由搬运

新建 `apps/api/src/memory_anki/modules/knowledge/application/knowledge_service.py`。按下表把每个路由函数体中"除请求解析与响应组装外"的逻辑搬为服务函数（**一次搬一个路由，搬完立即跑测试**）：

| 服务函数（建议签名） | 来源路由（行号） | 搬运内容 |
|---|---|---|
| `list_subjects(s) -> list[Subject]` | 66 | query+order_by |
| `create_subject(s, name, color, sort_order) -> Subject` | 71 | 构造+add+commit |
| `update_subject(s, subject_id, fields: dict) -> Subject \| None` | 80 | 查询、setattr、`sync_subject_editor_root`、commit |
| `delete_subject(s, subject_id) -> bool` | 93 | 查询+delete+commit |
| `get_subject_tree(s, subject_id) -> dict \| None` | 105 | 查询+根章节过滤+组装 |
| `get_subject_editor_payload(s, subject_id) -> dict \| None` | 118 | 查询+`get_subject_editor_state` |
| `save_subject_editor(s, subject_id, data) -> dict` | 129 | 查询+`save_subject_editor_state`+rolling backup（`EditorStateConflictError` 不捕获，向上抛，由 router 转 409） |
| `get_chapter_detail(s, chapter_id) -> dict \| None` | 169 | palace_out、面包屑 while 循环、组装 |
| `create_chapter(s, subject_id, data: ChapterCreate) -> dict` | 204 | 构造+flush+refresh+commit+rolling backup |
| `update_chapter(s, chapter_id, fields: dict) -> dict \| None` | 230 | setattr+commit+rolling backup |
| `delete_chapter_cascade(s, chapter_id) -> None` | 243/250 | `_delete_recursive` 整个函数一并搬入（改为服务内私有函数） |
| `get_palace_chapters(s, palace_id) -> list[dict] \| None` | 270 | reconcile+explicit_ids+组装 |
| `link_palace_chapters(s, palace_id, chapter_ids, primary_chapter_id) -> dict \| None` | 286 | set_links+reconcile+commit+rolling backup |

服务文件头部 import（从 router 现有 import 平移）：

```python
from sqlalchemy.orm import Session

from memory_anki.infrastructure.db.models import Chapter, Palace, Subject
from memory_anki.modules.backups.application.backup_service import maybe_create_rolling_backup
from memory_anki.modules.mindmap.application.editor_state_service import (
    get_subject_editor_state,
    save_subject_editor_state,
    sync_subject_editor_root,
)
from memory_anki.modules.palaces.application.title_sync_service import (
    get_palace_explicit_chapter_ids,
    reconcile_palace_chapter_binding,
    set_palace_chapter_links,
)
from memory_anki.modules.knowledge.application.knowledge_serializers import chapter_json, subject_json
```

搬运注意事项（"不要做什么"）：

- 路由里的 `print(f"[DEBUG] ...")` 与 `DEBUG_LOG_PATH` 写文件逻辑**留在 router**（后续 01-06 统一删除），不要搬进 application——application 不应写 presentation 的调试文件。
- `try/except Exception` + `JSONResponse(500)` 的兜底**留在 router**，服务函数直接让异常上抛。
- `EditorStateConflictError` 的 409 转换留在 router。
- commit/rollback 归属：本次保持"服务函数内 commit"的现状语义（与 palaces 模块的 palace_service 一致），不要引入 unit-of-work 之类新抽象。

改造后 router 函数示例（update_subject）：

```python
@router.put("/subjects/{subject_id}")
def update_subject_route(subject_id: int, data: dict, s: Session = Depends(session_dep)):
    sub = knowledge_service.update_subject(s, subject_id, data)
    if not sub:
        return {"error": "not found"}
    return subject_json(sub)
```

（保持 `{"error": "not found"}` 现状返回，收敛归 02-04。）

自查点（每搬一个路由后）：`python -m pytest tests/test_palace_chapter_binding.py tests/test_mini_palace_routes.py -q` 通过；对应接口 curl 一次响应 JSON 与改前一致。

### 步骤 4：收尾核查 router 的 import

搬运完成后 `presentation/router.py` 应不再直接 import `editor_state_service`、`title_sync_service`、`backup_service`、`Chapter/Palace/Subject` 模型（`session_dep` 从 02-01 的 deps 模块来）。删除多余 import，router 预计缩到 150 行以内。

自查点：`python -m ruff check src` 无 F401；`rg "s\.query\(" apps/api/src/memory_anki/modules/knowledge/presentation` 无结果。

## 3. 测试验收标准

```
cd apps/api && python -m pytest                  # 期望：全部通过
cd apps/api && python -m ruff check src tests    # 期望：0 错误
cd apps/api && python -m mypy                    # 期望：不多于基线错误
python tools/check_architecture.py               # 期望：passed（knowledge/presentation/router.py 在 ORM 基线内，抽层后更不应触发）
lint-imports                                     # 期望：契约通过（application 未反向依赖 presentation）
```

行为验收（启动后端 + 前端）：

- 学科管理页：新建学科 → 建三层章节树 → 树形展示正确、palace_count 正确。
- 打开学科编辑器 → 修改 → 保存成功；并发冲突场景仍返回 409。
- 章节详情页：面包屑层级正确；删除中间层章节 → 其子孙一并删除。
- 宫殿详情：关联/解除关联章节 → `GET /palaces/{id}/chapters` 的 `is_explicit` 标记正确。

回归检查：`tests/test_palace_chapter_binding.py`（章节绑定语义）必须全绿；mindmap 编辑器保存（palaces 侧）不受影响；响应 JSON 结构逐字段与改前一致（可各抓一次改前/改后响应 diff）。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 核实：knowledge 模块确实只有 presentation/router.py（301 行，描述"302 行"basically 吻合）；无 application/domain 目录；pyproject mypy 豁免里引用的 knowledge.application.bilink_service 并不存在（死配置，见 01-04） |
| 2026-07-09 03:41 +08:00 | Codex | 同步主文档实际方案 | 采用 `subject_service.py` + `chapter_service.py`，未采用旧稿 `knowledge_service.py`；指定测试、ruff 与 fastapi 零匹配检查通过 |
