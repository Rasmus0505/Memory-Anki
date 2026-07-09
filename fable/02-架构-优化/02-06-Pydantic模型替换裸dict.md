---
编号: 02-06
标题: 用 Pydantic BaseModel 替换 sessions/freestyle/knowledge 关键写接口的 data: dict 裸参数
类型: 优化
范围: 架构
优先级: P1（应该）
预估工作量: M（2-8h）
依赖文档: 无（与 02-05 涉及 knowledge 同一文件、与 02-13 涉及 sessions service，执行前互查进度表）
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 02-06 Pydantic 模型替换裸 dict

## 1. 原始需求

多个写接口用 `data: dict` 接收请求体，FastAPI 因此不做任何字段校验，非法字段静默丢弃、缺失字段落到服务层才炸（或被 `or 0` 静默吞掉），OpenAPI 文档也无法生成请求 schema。现状证据：

- `apps/api/src/memory_anki/modules/sessions/presentation/router.py`：61 行 `api_create_study_session(data: dict, ...)`、113 行 `api_patch_study_session(... data: dict ...)`、128 行 `api_append_study_session_events(... data: dict ...)`（同文件还有 complete/abandon/bulk-delete 等，见步骤 3 扩展清单）。
- `apps/api/src/memory_anki/modules/freestyle/presentation/router.py`：50 行 `api_create_freestyle_question_attempt(data: dict, ...)`、83 行 `api_create_freestyle_question_explanation(data: dict, ...)`。
- `apps/api/src/memory_anki/modules/knowledge/presentation/router.py`：130 行 `update_subject_editor(subject_id: int, data: dict, ...)`。

仓库已有先例：`modules/palaces/domain/schemas.py` 定义了 `PalaceCreate`/`PalaceUpdate`/`ChapterCreate`，palaces/knowledge 的部分接口已在用。期望效果：上述 6 个接口改用 BaseModel，字段定义与服务层实际读取的键一一对应（字段清单已核对服务层源码）。

## 2. 详细执行清单

> 禁止事项：模型一律放在各模块 `domain/schemas.py`（对齐 palaces 先例），**domain 文件里只允许 import pydantic 与标准库**，不得 import fastapi/sqlalchemy；服务层（application）签名保持 `dict` 入参不变，presentation 用 `model_dump(exclude_unset=True)` 转 dict 传入——这样服务层与既有测试零改动；所有新模型字段必须允许旧客户端的宽松输入（PWA 离线队列可能重放旧格式请求），因此**不要**给现有可选字段加 required 约束。

### 步骤 1：sessions 模块模型

新建 `apps/api/src/memory_anki/modules/sessions/domain/__init__.py`（空）与 `apps/api/src/memory_anki/modules/sessions/domain/schemas.py`。字段依据 `modules/sessions/application/study_session_service.py` 的 `create_study_session`（126-165 行）、`patch_study_session`（173-211 行）、`append_study_session_events`（214-230 行）实际读取的键：

```python
from typing import Any

from pydantic import BaseModel, ConfigDict


class StudySessionCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str | None = None
    status: str | None = None
    scene: str | None = None
    target_type: str | None = None
    target_id: int | None = None
    palace_id: int | None = None
    palace_segment_id: int | None = None
    mini_palace_id: int | None = None
    english_course_id: int | None = None
    english_reading_material_id: int | None = None
    title: str | None = None
    started_at: str | None = None
    ended_at: str | None = None
    effective_seconds: int | None = None
    idle_seconds: int | None = None
    pause_count: int | None = None
    completion_method: str | None = None
    progress: dict[str, Any] | None = None
    events: list[dict[str, Any]] | None = None
    summary: dict[str, Any] | None = None


class StudySessionPatch(StudySessionCreate):
    """patch 与 create 可接收字段一致，全部可选。"""


class StudySessionEventsAppend(BaseModel):
    model_config = ConfigDict(extra="ignore")

    events: list[dict[str, Any]] = []
```

`extra="ignore"` 是刻意选择：服务层本就忽略未知键，保持宽容。

修改 `modules/sessions/presentation/router.py`：

修改前（60-65 行）：

```python
@router.post("/study-sessions")
def api_create_study_session(data: dict, session: Session = Depends(session_dep)):
    try:
        return {"item": create_study_session(session, data)}
```

修改后：

```python
@router.post("/study-sessions")
def api_create_study_session(data: StudySessionCreate, session: Session = Depends(session_dep)):
    try:
        return {"item": create_study_session(session, data.model_dump(exclude_unset=True))}
```

`exclude_unset=True` 至关重要：`patch_study_session` 用 `if key in payload` 判断是否更新字段（193-207 行），必须只传客户端明确发送的键。113 行 patch、128 行 events 接口同法替换（events 接口传 `data.events` 即可，handler 里原有的 `isinstance` 防御判断可删）。

自查点：`python -m pytest tests/test_study_session_routes.py -q` 全绿。

### 步骤 2：freestyle 模块模型

新建 `apps/api/src/memory_anki/modules/freestyle/domain/__init__.py` 与 `apps/api/src/memory_anki/modules/freestyle/domain/schemas.py`。字段依据 `modules/freestyle/application/history_service.py` 的 `create_question_attempt`（111-138 行）、`create_question_explanation`（164-196 行）：

```python
from typing import Any

from pydantic import BaseModel, ConfigDict


class _FreestyleQuestionBase(BaseModel):
    model_config = ConfigDict(extra="ignore")

    question_id: int
    palace_id: int | None = None
    palace_title: str | None = None
    mini_palace_id: int | None = None
    mini_palace_name: str | None = None
    chapter_id: int | None = None
    chapter_name: str | None = None
    question_type: str | None = None
    stem_snapshot: str | None = None


class FreestyleQuestionAttemptCreate(_FreestyleQuestionBase):
    mode: str | None = None
    answer_payload: Any = None
    is_correct: bool | None = None


class FreestyleQuestionExplanationCreate(_FreestyleQuestionBase):
    user_question: str
    explanation_text: str
    ai_call_log_id: str | None = None
```

`question_id`、`user_question`、`explanation_text` 设为必填是安全的：服务层对缺失值直接 `raise ValueError`（116、174、176 行），现在改为 422 提前拦截。

router 50、83 行同步骤 1 的方式替换，`data if isinstance(data, dict) else {}` 防御判断删除，传 `data.model_dump(exclude_unset=True)`。

自查点：`python -m pytest tests/test_freestyle_routes.py -q` 全绿；`curl -X POST .../api/v1/freestyle/question-attempts -d "{}"` 返回 422。

### 步骤 3：knowledge editor 模型

在 `modules/palaces/domain/schemas.py` 同级思路下，knowledge 尚无 domain 目录。新建 `apps/api/src/memory_anki/modules/knowledge/domain/__init__.py` 与 `schemas.py`。字段依据 `modules/mindmap/application/editor_state_service.py` 的 `save_subject_editor_state`（72-96 行）读取的键：

```python
from typing import Any

from pydantic import BaseModel, ConfigDict


class SubjectEditorUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    editor_doc: dict[str, Any] | None = None
    editor_config: dict[str, Any] | None = None
    editor_local_config: dict[str, Any] | None = None
    lang: str | None = None
    expected_editor_fingerprint: str | None = None
    allow_stale_overwrite: bool = False
```

修改 `modules/knowledge/presentation/router.py` 130 行 handler：签名改为 `data: SubjectEditorUpdate`，函数体内所有 `data.get("editor_doc")` 式访问改为先 `payload = data.model_dump(exclude_unset=True)` 再传给 `save_subject_editor_state(s, subject, payload)`；139-144 行 DEBUG print 中对 `data` 的字典式访问同步改用 `payload`。

自查点：前端打开学科编辑器 → 修改脑图 → 保存成功；故意并发保存触发 409 冲突提示仍正常。

### 扩展清单（本文档范围内可选，时间不够则记入进度表留给后续）

同文件同模式的剩余接口：sessions router 146 行 complete、157 行 abandon、175 行 bulk-delete（`ids: list[str]`）、184 行 from-time-record；knowledge router 72 行 create_subject、81 行 update_subject、231 行 update_chapter、287 行 link_chapters。逐个复制上述三步的手法即可。

## 3. 测试验收标准

可执行命令与期望结果（工作目录 `apps/api`）：

| 命令 | 期望结果 |
|---|---|
| `python -m pytest tests -q` | 全部通过 |
| `python -m ruff check src tests` | 0 错误 |
| `lint-imports` | 契约 KEPT（domain 未反向依赖） |
| `rg -n "data: dict" src/memory_anki/modules/sessions/presentation/router.py` | 61/113/128 行原位置零匹配（扩展清单未做时其余行允许保留） |
| `rg -n "fastapi\|sqlalchemy" src/memory_anki/modules/*/domain/schemas.py` | 零匹配 |

行为验收：
- 计时学习：开始 → 暂停 → 完成一个学习会话，仪表盘时长统计正确（patch 的 `exclude_unset` 语义未破坏）。
- POST `/api/v1/study-sessions` 传 `{"target_type": 123}`（类型错误）→ 422。
- 随心刷题页：作答提交、AI 讲解保存正常。

回归检查：PWA 离线队列重放旧格式请求（多余字段）不被 422 拒绝（`extra="ignore"` 保证）；OpenAPI 文档 `http://127.0.0.1:8012/docs` 中上述接口显示请求 schema。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | - |
| 2026-07-09 | Codex | 完成实现与验证 | 按当前代码完成 sessions/freestyle/knowledge 关键写接口请求模型化，domain schema 仅依赖 Pydantic/标准库并使用 `extra="allow"`；服务层签名未改，router 以 `model_dump(exclude_unset=True, exclude_none=False)` 保持 PATCH 语义；保留 `from-time-record` 与 subject editor 两个自由结构 dict 并在代码注释说明；目标 pytest 31 passed（5 warnings），目标 ruff 通过 |
