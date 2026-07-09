---
编号: 02-05
标题: 为 knowledge 模块补建 application 层（subject_service / chapter_service），router 瘦身为纯路由
类型: 优化
范围: 架构
优先级: P1（应该）
预估工作量: M（2-8h）
依赖文档: 无（建议在 02-04 的 knowledge 批次之后执行，避免同文件冲突；与 02-06、02-08 涉及同一文件，执行前互查进度表）
状态: 未开始
负责代理: 无
完成时间: 无
---

# 02-05 knowledge 补建 application 层

## 1. 原始需求

`apps/api/src/memory_anki/modules/knowledge/` 是全后端唯一没有 application 层的业务模块——只有 `presentation/router.py`（302 行）。学科/章节的业务逻辑（序列化、递归删除、树构建、面包屑、宫殿-章节关联）全部写在 handler 里，并直接借用 `mindmap` 的 `editor_state_service`（16-21 行 import）与 `palaces` 的 `title_sync_service`（22-26 行 import）。后果：这些逻辑无法被其他模块复用（例如 dashboard 若要统计章节数只能重复写 query）、无法脱离 FastAPI 单测、router 职责混杂。

期望效果：新建 `modules/knowledge/application/subject_service.py` 与 `chapter_service.py`，把纯业务函数下沉；`router.py` 瘦身为"解析请求 → 调 service → 返回/抛异常"，行数降到 150 行以内。

## 2. 详细执行清单

> 禁止事项：application 文件中**禁止 import 任何 fastapi 符号**（`JSONResponse`、`HTTPException`、`Depends` 都留在 presentation）——这是 import-linter 无法检查（它只查模块间方向）但 AGENT.md 明文要求的边界；不要改任何路由路径与响应 JSON 结构；跨模块借用 `mindmap`/`palaces` 的 application 函数可以保留（application→application 不违反契约），不要试图把它们也搬进 knowledge。

### 步骤 1：新建 subject_service.py

新建 `apps/api/src/memory_anki/modules/knowledge/application/__init__.py`（空文件）与 `apps/api/src/memory_anki/modules/knowledge/application/subject_service.py`。

从 `router.py` 迁入以下内容（函数体保持原逻辑）：

1. `subject_json(s)`（router 55-61 行）——原样搬入。
2. 新函数 `list_subjects(session)`：包裹 router 68 行的查询 `session.query(Subject).order_by(Subject.sort_order).all()`，返回 `[subject_json(sub) for sub in ...]`。
3. 新函数 `create_subject(session, name, color, sort_order)`：搬入 router 73-77 行逻辑（构造 Subject、add、commit、返回 subject_json）。
4. 新函数 `update_subject(session, subject_id, data) -> dict | None`：搬入 router 82-90 行；查不到返回 `None`（**不要**在 service 里返回 `{"error": ...}`）；保留对 `sync_subject_editor_root(sub)` 的调用（import 自 `memory_anki.modules.mindmap.application.editor_state_service`）。
5. 新函数 `delete_subject(session, subject_id) -> bool`：搬入 router 95-100 行，查不到返回 `False`。
6. 新函数 `get_subject_tree(session, subject_id) -> dict | None`：搬入 router 108-115 行（root_chapters 过滤 + 组装），`chapter_json` 从 chapter_service import。

文件头 import 只需要：`from sqlalchemy.orm import Session`、`from memory_anki.infrastructure.db.models import Subject`、mindmap 的 `sync_subject_editor_root`、以及 chapter_service 的 `chapter_json`。

自查点：`rg -n "fastapi" src/memory_anki/modules/knowledge/application/` 零匹配。

### 步骤 2：新建 chapter_service.py

新建 `apps/api/src/memory_anki/modules/knowledge/application/chapter_service.py`，迁入：

1. `chapter_json(c)`（router 41-52 行）。
2. 新函数 `get_chapter_detail(session, chapter_id) -> dict | None`：搬入 router 172-201 行（含 `palace_out` 内嵌函数与面包屑 while 循环），查不到返回 `None`。注意：若 02-08（N+1 修复）已完成，面包屑实现可能已改为一次性查询，以当时代码为准迁移。
3. 新函数 `create_chapter(session, subject_id, data: ChapterCreate) -> dict`：搬入 router 208-222 行的 Chapter 构造/flush/refresh/commit 逻辑；`maybe_create_rolling_backup` 的调用一并搬入（它来自 backups application，属于 application→application 合法依赖）；`print` 调试语句与 try/except-返回 JSONResponse 的部分**留在 presentation 或删除**（若 02-04 已完成，异常直接上抛）。
4. 新函数 `update_chapter(session, chapter_id, data: dict) -> dict | None`：搬入 router 232-240 行。
5. `_delete_recursive(chapter, session)`（router 243-247 行）与新函数 `delete_chapter(session, chapter_id) -> bool`：搬入 254-260 行逻辑。
6. 新函数 `get_palace_chapters(session, palace_id) -> list | None`：搬入 router 273-283 行（含 `reconcile_palace_chapter_binding`、`get_palace_explicit_chapter_ids` 调用）。
7. 新函数 `link_palace_chapters(session, palace_id, data: dict) -> dict | None`：搬入 router 289-299 行。

自查点：`python -c "from memory_anki.modules.knowledge.application import chapter_service, subject_service"` 无报错。

### 步骤 3：router.py 瘦身

逐个 handler 改为调 service。示意（`GET /chapters/{chapter_id}`，以 02-04 未完成的旧错误风格为例）：

修改前（169-201 行）：

```python
@router.get("/chapters/{chapter_id}")
def get_chapter(chapter_id: int, s: Session = Depends(session_dep)):
    c = s.query(Chapter).filter_by(id=chapter_id).first()
    if not c:
        return {"error": "not found"}
    ...30 行组装逻辑...
```

修改后：

```python
@router.get("/chapters/{chapter_id}")
def get_chapter(chapter_id: int, s: Session = Depends(session_dep)):
    detail = chapter_service.get_chapter_detail(s, chapter_id)
    if detail is None:
        return {"error": "not found"}   # 02-04 完成后应为 raise HTTPException(404)
    return detail
```

全部 13 个 handler 改完后：删除 router 顶部不再直接使用的 import（`Chapter`、`Palace`、`Subject`、`traceback`、mindmap/palaces 的函数——凡已被 service 接管的都删；`get_subject_editor_state`/`save_subject_editor_state` 相关的 editor 两个 handler 若逻辑简单可暂不下沉，保留其 import）。

自查点：`(Get-Content src/memory_anki/modules/knowledge/presentation/router.py).Count` ≤ 150；`python -m ruff check src/memory_anki/modules/knowledge` 0 错误。

### 步骤 4：更新受影响测试

`rg -n "knowledge" apps/api/tests -l` 找到相关测试（至少 `test_palace_chapter_binding.py` 23-30 行替换了 `knowledge_router.get_session`）。本改造不动 `get_session` 注入方式（那是 02-01 的事），但若测试直接 import 了 router 内的 `chapter_json` 等符号，需要改为从 application import。

## 3. 测试验收标准

可执行命令与期望结果（工作目录 `apps/api`）：

| 命令 | 期望结果 |
|---|---|
| `python -m pytest tests -q` | 全部通过 |
| `python -m ruff check src tests` | 0 错误 |
| `lint-imports` | 契约 KEPT |
| `rg -n "fastapi" src/memory_anki/modules/knowledge/application` | 零匹配 |
| `rg -n "s\.query\(" src/memory_anki/modules/knowledge/presentation/router.py` | 零匹配（查询全部下沉） |

行为验收：
- 前端"知识体系"页：新建学科 → 改名 → 建章节树（三层）→ 拖动排序 → 删除中间章节（级联）→ 每步界面表现与改造前一致。
- `curl http://127.0.0.1:8012/api/v1/subjects` 与改造前响应逐字段一致。
- 宫殿详情页"关联章节"读写正常（`GET/PUT /palaces/{id}/chapters`）。

回归检查：subject editor（`GET/PUT /subjects/{id}/editor`）保存与冲突检测（409）不受影响；章节删除的滚动备份（`maybe_create_rolling_backup`）仍被触发（删除章节后检查备份目录）。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | - |
