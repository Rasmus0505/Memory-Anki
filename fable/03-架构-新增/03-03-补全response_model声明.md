---
编号: 03-03
标题: 为 palaces/reviews/settings 高价值路由群补全 pydantic response_model
类型: 新增
范围: 架构
优先级: P2
预估工作量: L
依赖文档: 无
状态: 已完成
负责代理: Codex 收尾代理
完成时间: 2026-07-09
---

# 03-03 补全 response_model 声明

## 1. 原始需求

后端路由几乎全部返回裸 `dict`，没有 `response_model` 声明（核实：`apps/api/src/memory_anki/modules/*/presentation/router.py` 中无一处 `response_model=`）。导致 `/openapi.json` 里所有响应都是空 schema，前端 `apps/web/package.json` 的 `openapi:types` 脚本（`openapi-typescript http://127.0.0.1:8012/openapi.json -o src/shared/api/generated.ts`）生成的 `apps/web/src/shared/api/generated.ts` 只有 5 行空壳（仅 `export {}`），前端只能在 `shared/api/contracts` 手写类型，后端改字段前端无感知。

目标：选择三个高价值路由群（palaces 目录、reviews 复习、settings 运行时），定义 pydantic 响应模型并挂到路由上，使 OpenAPI 产出可用的类型；对字段动态性强的载荷用宽松模型（`extra="allow"`）渐进覆盖。不追求全量覆盖所有路由（那是 L 级之后的持续工作）。

## 2. 详细执行清单

总原则：

- 模型统一 `model_config = ConfigDict(extra="allow")`，先声明"已知稳定字段"，允许多余字段透传，**绝不因为模型缺字段而丢数据**（pydantic 默认会按模型过滤响应，`extra="allow"` + 从 dict 构造可保留全部键）；
- 每个模块的模型放在该模块 `presentation/response_models.py` 新文件中，不放 domain 层（模板硬性约束：domain 不感知 FastAPI，但 presentation 可以用 pydantic）；
- 路由函数体**一行都不改**，只加装饰器参数。

### 步骤 1：settings 路由群（最简单，先做）

新建 `apps/api/src/memory_anki/modules/settings/presentation/response_models.py`：

```python
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class RuntimeHealthResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool
    startup_mode: str
    runtime_snapshot: str | None = None
    release_id: str | None = None
    started_at: str | None = None


class RuntimeInfoResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    channel: str | None = None
    commit: str | None = None


class SettingsResponse(BaseModel):
    # 设置是动态 key-value（core/config.py DEFAULTS 约 60 个键），
    # 用宽松模型仅声明少量核心键，其余透传。
    model_config = ConfigDict(extra="allow")

    default_review_mode: str | None = None
    ebbinghaus_intervals: str | None = None
    daily_max_reviews: str | None = None
```

字段依据：`apps/api/src/memory_anki/core/runtime.py` 第 165~179 行 `build_runtime_health` 返回 `ok/startup_mode/runtime_snapshot/release_id/started_at`；`read_settings`（settings router 第 69~88 行）返回 DEFAULTS 合并 Config 表。

修改 `apps/api/src/memory_anki/modules/settings/presentation/router.py`：

```python
# 修改前
@router.get("/settings")
def api_settings(s: Session = Depends(session_dep)):
    return read_settings(s)

@router.get("/runtime-health")
def api_runtime_health():
    ...

# 修改后（函数体不变，只加参数）
@router.get("/settings", response_model=SettingsResponse)
def api_settings(s: Session = Depends(session_dep)):
    return read_settings(s)

@router.get("/runtime-health", response_model=RuntimeHealthResponse)
def api_runtime_health():
    ...
```

同样给 `PUT /settings`、`GET/PUT /settings/review`、`GET/PUT /profile/review-settings` 挂 `SettingsResponse`，给 `GET /runtime-info` 挂 `RuntimeInfoResponse`。文件顶部加 `from memory_anki.modules.settings.presentation.response_models import (...)`。**不要**给 ai-models/ai-prompts/ai-call-logs 路由挂模型（结构复杂，留待后续）。

**自查点**：`cd apps/api && python -m pytest tests/test_runtime_info.py -q` 通过；启动服务后 `/openapi.json` 中 `/api/v1/runtime-health` 出现具名 schema。

### 步骤 2：reviews 路由群

新建 `apps/api/src/memory_anki/modules/reviews/presentation/response_models.py`：

```python
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class OverdueCountResponse(BaseModel):
    count: int


class ChapterInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int
    name: str
    subject_id: int | None = None


class ReviewScheduleItem(BaseModel):
    # 对应 router.py 第 65~94 行 schedule_json 的输出。
    model_config = ConfigDict(extra="allow")

    id: int
    palace_id: int
    scheduled_date: str
    interval_days: int | None = None
    algorithm_used: str | None = None
    completed: bool
    completed_at: str | None = None
    review_number: int | None = None
    review_type: str | None = None
    palace: dict | None = None  # palace_json 结构庞大，先以 dict 透传


class GroupedReviewScheduleItem(ReviewScheduleItem):
    schedule_count: int
    overdue_schedule_count: int
    next_due_date: str


class ReviewQueueResponse(BaseModel):
    # 对应 router.py 第 107~115 行 queue_payload_json。
    model_config = ConfigDict(extra="allow")

    due_count: int
    overdue_count: int
    smoothed_count: int
    stats: dict
    chapter: ChapterInfo | None = None
    reviews: list[GroupedReviewScheduleItem]


class SubmitReviewResponse(BaseModel):
    # 对应 router.py 第 210~216 行 submit 的响应。
    ok: bool
    completion_mode: str | None = None
    score: float | None = None
    next_id: int | None = None
    mastered: bool = False
```

修改 `apps/api/src/memory_anki/modules/reviews/presentation/router.py`，为以下路由加 `response_model`（逐路由清单）：

| 路由 | 行号（现状） | response_model |
|---|---|---|
| `GET /review/overdue-count` | 118 | `OverdueCountResponse` |
| `GET /review/queue` | 140 | `ReviewQueueResponse` |
| `GET /review/chapter/{chapter_id}/queue` | 145 | `ReviewQueueResponse` |
| `GET /review` | 223 | `ReviewQueueResponse` |
| `GET /review/session/{schedule_id}` | 150 | `ReviewScheduleItem` |
| `GET /review/{schedule_id}` | 228 | `ReviewScheduleItem` |
| `POST /review/session/{schedule_id}/submit` | 180 | `SubmitReviewResponse` |
| `POST /review/{schedule_id}/submit` | 233 | `SubmitReviewResponse` |

注意：submit 路由有幂等缓存返回（第 187~189 行直接 return 旧响应），`SubmitReviewResponse` 字段必须与缓存 JSON 兼容——以上字段就是缓存的字段，兼容。**不要**给 progress 相关路由挂模型（进度结构由前端主导，动态）。

**自查点**：`cd apps/api && python -m pytest tests/test_review_routes.py -q` 全绿（该测试文件近 4000 行、覆盖面大，任何响应字段被模型意外过滤都会在这里暴露）。

### 步骤 3：palaces 目录路由群

新建 `apps/api/src/memory_anki/modules/palaces/presentation/response_models.py`：

```python
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class PalaceListItem(BaseModel):
    # palace_json（application/palace_serializer.py）字段多且随功能演进，
    # 只声明目录页强依赖的稳定字段，其余 extra 透传。
    model_config = ConfigDict(extra="allow")

    id: int
    title: str
    description: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    archived: bool | None = None
    needs_practice: bool | None = None
    primary_chapter_id: int | None = None


class DeleteOkResponse(BaseModel):
    ok: bool
```

修改 `apps/api/src/memory_anki/modules/palaces/presentation/router.py`：

| 路由 | 行号（现状） | response_model |
|---|---|---|
| `GET /palaces` | 112 | `list[PalaceListItem]` |
| `GET /palaces/{palace_id}` | 149 | `PalaceListItem`（注意该路由 not found 时返回 `{"error": "not found"}`，需在模型中允许 extra，且 `id/title` 改为 `int | None = None`/`str | None = None`，或者更干净：顺路把该路由改为 404 —— **不要这么做**，行为变更超出本文档范围；采用全可选字段版本 `PalaceListItem` 的宽松变体 `PalaceDetailResponse`，所有字段可选） |
| `POST /palaces` | 155 | `PalaceListItem` |
| `PUT /palaces/{palace_id}` | 163 | 同 `GET /palaces/{palace_id}` 的宽松变体 |
| `DELETE /palaces/{palace_id}` | 177 | `DeleteOkResponse` |

在 `response_models.py` 中补充：

```python
class PalaceDetailResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: int | None = None
    title: str | None = None
    error: str | None = None
```

**自查点**：`cd apps/api && python -m pytest tests -k "palace and not quiz" -q` 无新增失败。

### 步骤 4：重新生成前端类型并接线

1. 启动后端：`cd apps/api && python -m uvicorn memory_anki.app.main:app --port 8012`（或用 `start-desktop.bat`）。
2. 生成：`cd apps/web && npm run openapi:types`。确认 `src/shared/api/generated.ts` 从 5 行空壳变为包含 `components["schemas"]["ReviewQueueResponse"]` 等类型的文件。
3. 按 `generated.ts` 头部注释的约定，**不要**让 feature 代码直接 import generated.ts；如需使用，在 `apps/web/src/shared/api/contracts.ts` 或 `shared/api/contracts/` 中 re-export 别名。本文档只要求生成成功，替换手写 contracts 属后续渐进工作。
4. `cd apps/web && npm run typecheck` 确认生成文件本身无类型错误。

**自查点**：`git diff --stat apps/web/src/shared/api/generated.ts` 显示大量新增行。

### 明确不要做什么

- 不给 english / english_reading / freestyle / dashboard / palace_quiz / import 路由挂模型（本文档只做 3 个路由群）；
- 不修改任何路由的函数体、状态码、错误返回习惯（如 `{"error": "not found"}`）；
- 不在 domain 层放 pydantic 响应模型；
- 不把 generated.ts 直接引入 feature 代码。

## 3. 测试验收标准

可执行命令：

- `cd apps/api && python -m pytest` → 全部通过（重点回归 `test_review_routes.py`、`test_palace_quiz_routes.py`）。
- `cd apps/web && npm run openapi:types && npm run typecheck` → 生成成功且类型检查通过。

行为验收：

1. 打开 `http://127.0.0.1:8012/docs` → `GET /api/v1/review/queue` 的 Response schema 显示 `due_count/overdue_count/reviews[]` 等字段而非空对象。
2. 复习一张卡并提交 → 前端行为与改前一致，响应 JSON 字段无缺失（对比改动前后同一请求的响应体）。
3. `GET /palaces` 响应中原有的全部字段（含未在模型中声明的动态字段）仍然存在。

回归检查：

- 幂等重放：对 `POST /review/session/{id}/submit` 用相同 `X-Memory-Anki-Mutation-ID` 重发，返回缓存响应且通过模型校验；
- 前端复习页、宫殿目录页、设置页数据展示无变化。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | fable 文档代理 | 文档创建 | 已核实 generated.ts 为 5 行空壳、openapi:types 脚本、reviews/settings 路由现状 |
| 2026-07-09 | fable Worker 13 | 首批补全 settings runtime GET response_model | 已给 `GET /runtime-info`、`GET /runtime-health` 挂载 `RuntimeInfoResponse`/`RuntimeHealthResponse`；未做清单：settings 读写路由、client-preferences、reviews、palaces 及前端 openapi 类型生成 |
| 2026-07-09 | Codex 收尾代理 | 收尾实现 | 已补齐 settings 读写/复习设置路由的 `SettingsResponse`，reviews 高价值路由的 `OverdueCountResponse`/`ReviewQueueResponse`/`ReviewScheduleItem`/`SubmitReviewResponse`，以及 palaces 目录 CRUD 的 `PalaceSummaryResponse`/`PalaceDetailResponse`/`DeleteOkResponse`；`GET /palaces` 因 03-02 分页要求使用裸列表或分页包联合模型。新增测试确认 OpenAPI 注册 `RuntimeHealthResponse`、`SettingsResponse`、`ReviewQueueResponse`、`PaginatedPalaceListResponse` 等 schema。按本次任务边界未触碰前端，未运行 `npm run openapi:types`/生成 `generated.ts`。验证命令：`python -m pytest tests/test_fable_pagination_response_models.py tests/test_study_session_routes.py -q`、`python -m pytest tests/test_review_routes.py -q`、`python -m pytest tests/test_palace_quiz_routes.py -q`、目标文件 `ruff check` 通过。 |
