---
编号: 02-06
标题: 用 Pydantic 模型替换 sessions/freestyle/knowledge 路由的裸 dict 请求体
类型: 优化
范围: 架构
优先级: P1
预估工作量: M
依赖文档: [02-04]
状态: 未开始
负责代理: 无
完成时间: 无
---

# 02-06 用 Pydantic 模型替换裸 dict 请求体

## 1. 原始需求

多个 router 的写接口直接声明 `data: dict` 接收请求体：没有字段校验、没有 OpenAPI schema（前端 `openapi:types` 生成的类型是空对象）、非法输入要靠服务层的手工 `int()`/`str()` 转换兜底。已核实的清单：

- `modules/sessions/presentation/router.py`：第 61（POST /study-sessions）、113（PATCH）、128（events）、145（complete）、157（abandon）、175（bulk-delete）、184（from-time-record）行，另有 legacy 进度接口 7 处 PUT（207/219/251/287/323 行等）。
- `modules/freestyle/presentation/router.py`：第 50（POST /freestyle/question-attempts）、83（POST /freestyle/question-explanations）行。
- `modules/knowledge/presentation/router.py`：第 72（POST /subjects）、81（PUT /subjects/{id}）、130（PUT /subjects/{id}/editor）、231（PUT /chapters/{id}）、287（PUT /palaces/{id}/chapters）行。

目标：逐接口定义 Pydantic v2 模型，**保持字段名与可选性 100% 兼容**（前端不改也能通过），服务层入参暂保持 dict（用 `model_dump(exclude_unset=True)` 转换），本文档不改服务层签名。

## 2. 详细执行清单

> 硬约束：一次只改一个接口；模型一律 `extra="allow"` 起步（防止前端携带未知字段被 422 拒绝）；所有字段给默认值或 `| None`，不引入任何"新必填"；编辑器文档、events、progress、summary 这类自由结构字段保持 `dict`/`list` 宽类型，不要试图为其建模。不要动 palaces/settings 路由的 dict（palaces 面大另行处理；settings 的 data 是任意键值集合，建模无收益）。

### 步骤 1：sessions 模块建 schema 文件

sessions 模块没有 domain 目录。参照 palaces 的既有模式（pydantic 模型放 `modules/palaces/domain/schemas.py`），新建：

```
apps/api/src/memory_anki/modules/sessions/domain/__init__.py   （空）
apps/api/src/memory_anki/modules/sessions/domain/schemas.py
```

`schemas.py` 内容（字段名与 `study_session_service.create_study_session` 第 126–165 行读取的键一一对应，已核实）：

```python
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class StudySessionCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

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
    events: list[Any] | None = None
    summary: dict[str, Any] | None = None


class StudySessionPatch(StudySessionCreate):
    pass


class StudySessionEventsAppend(BaseModel):
    model_config = ConfigDict(extra="allow")

    events: list[Any] = []


class StudySessionBulkDelete(BaseModel):
    ids: list[str]


class PracticeProgressUpsert(BaseModel):
    model_config = ConfigDict(extra="allow")

    progress: dict[str, Any] | None = None
```

注意：pydantic 属于可在 domain 层使用的纯数据建模库（palaces.domain.schemas 已有先例），不违反"domain 不感知 FastAPI/SQLAlchemy"。

自查点：`python -c "from memory_anki.modules.sessions.domain.schemas import StudySessionCreate; print(StudySessionCreate(palace_id='3').palace_id)"` 输出 3（字符串数字被强转，与旧 `_int_or_none` 行为兼容）。

### 步骤 2：逐接口替换 sessions router（7+7 个接口，一次一个）

以 `POST /study-sessions`（第 60–65 行）为例：

```python
# 修改前
@router.post("/study-sessions")
def api_create_study_session(data: dict, session: Session = Depends(session_dep)):
    try:
        return {"item": create_study_session(session, data)}
# 修改后
@router.post("/study-sessions")
def api_create_study_session(data: StudySessionCreate, session: Session = Depends(session_dep)):
    try:
        return {"item": create_study_session(session, data.model_dump(exclude_unset=True, exclude_none=False))}
```

关键点：用 `exclude_unset=True`——PATCH 语义（第 110–122 行 `patch_study_session`）依赖"键不在 payload 里就不改"，`exclude_unset` 恰好保持该语义；`extra="allow"` 时未声明字段也会包含在 dump 里，兼容 `from-time-record` 接口的驼峰键（`pauseCount`/`completionMethod`/`sceneSegments`，服务层 341–383 行两种键名都读）。`from-time-record`（184 行）因驼峰键众多，**保持 `data: dict` 不动**并在代码旁加注释说明原因。bulk-delete（175 行）换用 `StudySessionBulkDelete` 后可删除路由内 `isinstance(raw_ids, list)` 手工校验（422 由框架返回，错误格式已由 02-04 统一）。

每改一个接口跑：`python -m pytest tests/test_study_session_routes.py -q`。

自查点：全部替换后 `rg "data: dict" apps/api/src/memory_anki/modules/sessions` 仅剩 from-time-record 一处。

### 步骤 3：freestyle 模块

新建 `modules/freestyle/domain/__init__.py` 与 `modules/freestyle/domain/schemas.py`。先打开 `modules/freestyle/application/history_service.py`，核实 `create_question_attempt`/`create_question_explanation` 从 payload 读取的确切键名，再据此定义模型（不得凭空猜键名），形如：

```python
class FreestyleQuestionAttemptCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    question_id: int | None = None
    palace_id: int | None = None
    mode: str | None = None
    # …… 以 history_service 实际读取的键为准补全
```

替换 router 第 48–56 行与 81–89 行的 `data: dict`，转换写法与步骤 2 相同（服务层继续收 dict）。原路由里 `data if isinstance(data, dict) else {}` 防御可删除。

自查点：`python -m pytest tests/test_freestyle_routes.py -q` 通过。

### 步骤 4：knowledge 模块

在 `modules/palaces/domain/schemas.py` 已有 `ChapterCreate`（create_chapter 路由已在用）。为保持模块归属清晰，knowledge 自己的模型放 `modules/knowledge/application/knowledge_service.py` 同级的 `modules/knowledge/domain/schemas.py`（新建），定义：

```python
class SubjectCreate(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str = ""
    color: str = "#6366f1"
    sort_order: int = 0


class SubjectUpdate(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str | None = None
    color: str | None = None
    sort_order: int | None = None


class ChapterUpdate(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str | None = None
    notes: str | None = None
    sort_order: int | None = None
    parent_id: int | None = None


class PalaceChapterLinks(BaseModel):
    model_config = ConfigDict(extra="allow")

    chapter_ids: list[int] = []
    primary_chapter_id: int | None = None
```

替换第 72/81/231/287 行四个接口。注意 update 类接口沿用"`key in data`才更新"的循环，替换后写 `data.model_dump(exclude_unset=True)` 保语义。**第 130 行 `PUT /subjects/{id}/editor` 保持 `data: dict` 不动**——editor_doc 是 Lexical 自由文档结构，建模有害无益（在代码旁注释说明）。

自查点：`python -m pytest tests/test_palace_chapter_binding.py -q` 通过；前端学科改名、章节改排序正常。

### 步骤 5：刷新前端 OpenAPI 类型（可选但建议）

`cd apps/web && npm run openapi:types`（需后端在 8012 端口运行）。仅重新生成 `generated` 类型文件，**不要**因生成结果去改前端业务代码。

自查点：`cd apps/web && npm run typecheck` 通过。

## 3. 测试验收标准

```
cd apps/api && python -m pytest                  # 期望：全部通过
cd apps/api && python -m ruff check src tests    # 期望：0 错误
cd apps/api && python -m mypy                    # 期望：不多于基线错误
python tools/check_architecture.py               # 期望：passed
cd apps/web && npm run typecheck                 # 期望：通过（若执行了步骤 5）
```

行为验收：

- 开始一次计时学习 → 暂停 → 完成：`POST /study-sessions`、`PATCH`、`/complete` 全链路正常，Dashboard 时长统计正确。
- `POST /api/v1/study-sessions/bulk-delete` 传 `{"ids": "oops"}` → 422（原为手写 400），前端删除记录功能正常。
- freestyle 页答一题 → 攻错记录出现在历史列表。
- 学科/章节改名与排序、宫殿章节关联保存正常。

回归检查：

- PATCH 局部更新语义：只传 `{"status": "paused"}` 时其他字段不被清空（`tests/test_study_session_routes.py` 覆盖，必须全绿）。
- `from-time-record` 与 editor 两个保持 dict 的接口行为完全不变。
- 前端不需要任何修改即可通过全部页面操作（extra="allow" + 全可选字段保证）。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 核实：sessions 61/113/128、freestyle 50/83、knowledge 130 行号全部吻合；另清点出 sessions legacy 进度 PUT 7 处与 knowledge 其余 4 处 dict 接口一并纳入；建议 editor 与 from-time-record 两接口保留 dict |
