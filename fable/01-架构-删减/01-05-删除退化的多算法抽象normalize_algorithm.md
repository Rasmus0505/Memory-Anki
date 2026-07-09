---
编号: 01-05
标题: 删除退化的多算法抽象 normalize_algorithm 及贯穿复习调度链的无意义 algorithm 参数
类型: 删减
范围: 架构
优先级: P1
预估工作量: M（2-8h）
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 01-05 删除退化的多算法抽象 normalize_algorithm

## 1. 原始需求

复习调度历史上支持多算法（ebbinghaus / custom 等），后来收敛为单一 ebbinghaus，但抽象壳留了下来：

```27:28:apps/api/src/memory_anki/modules/reviews/application/schedule_policy.py
def normalize_algorithm(algorithm: str | None) -> str:
    return "ebbinghaus"
```

恒返回常量的"归一化"函数被 6 个文件 import；`algorithm` 参数贯穿
`schedule_policy.py` → `schedule_service.py` → `schedule_rebuild_service.py` → `review_execution_service.py`
→ `reviews/presentation/router.py` / `palaces/application/palace_serializer.py` 等整条链，但对任何分支都没有影响
（如 `get_algorithm_intervals_for_policy(policy, algorithm)` 的 `algorithm` 形参在函数体内根本未被使用）。
另有整批已无调用方的死函数（`compute_next_review`、`generate_schedule_for_palace`、`resolve_interval`、
`ebbinghaus_intervals`/`custom_intervals`、`resolve_interval_from_base_datetime`、`_default_algorithm`）。

**DB 列 `algorithm_used` 必须保留**：`apps/api/alembic/versions/0009_restore_review_schedule_algorithm_used.py`
曾专门恢复过该列（0008 误删后回滚），列定义在
`apps/api/src/memory_anki/infrastructure/db/_tables/palaces.py` 第 285 行
（`algorithm_used: Mapped[str] = mapped_column(String(30), default="ebbinghaus")`）。原因：
(a) SQLite 删列需重建整表，风险与收益不成比例；(b) 历史行已有数据，API 仍向前端输出该字段
（`reviews/presentation/router.py` 第 84 行、`dashboard/application/service.py` 第 125 行）；
(c) 双设备同步场景下删列迁移出错的代价远高于留一个恒为 "ebbinghaus" 的字符串列。
本文档只删逻辑：写入时一律写死 `"ebbinghaus"`，读取路径不再"探测算法"。

## 2. 详细执行清单

> 分四个阶段，**每个阶段结束都必须跑一遍 `cd apps/api && python -m pytest`，绿了才能进入下一阶段**。
> 全程只允许修改本清单点名的文件；`dashboard/application/service.py`、`palaces/domain/schemas.py`
> （第 88 行的 `algorithm_used: str` 输出 schema）、`_tables/palaces.py`、alembic、前端一律不碰。

### 阶段一：删除无调用方的死函数

#### 步骤 1.1：核实死函数确实无调用方

```powershell
cd D:\322321\Memory-Anki
rg -n "compute_next_review|generate_schedule_for_palace|resolve_interval\(|ebbinghaus_intervals\(|custom_intervals\(|resolve_interval_from_base_datetime\(|_default_algorithm" apps/api
```

期望：所有匹配都位于定义处或本清单点名的删除范围内（`schedule_service.py` / `schedule_policy.py` /
`schedule_rebuild_service.py`），没有 tests 或其他模块调用。若出现新调用方，把该调用方记入进度表并顺链处理。

#### 步骤 1.2：删 `schedule_service.py` 中的死函数

打开 `apps/api/src/memory_anki/modules/reviews/application/schedule_service.py`，删除以下函数（含空行）：

- 第 34-38 行 `def ebbinghaus_intervals(session)`（唯一调用方是下一个死函数）
- 第 41-42 行 `def custom_intervals(session)`
- 第 49-60 行 `def resolve_interval_from_base_datetime(...)`（wrapper，无调用方）
- 第 93-103 行 `def compute_next_review(...)`
- 第 195-196 行 `def generate_schedule_for_palace(...)`

同时从文件头 import（第 6-16 行）中删除因此不再使用的名字：`resolve_interval`、
`resolve_interval_from_base_datetime_for_policy`（若 schedule_display_datetime 等仍用到某个名字则保留，
以删完后 `python -m ruff check` 的 F401 报告为准逐个清理）。

- **自查点**：`python -m ruff check src/memory_anki/modules/reviews/application/schedule_service.py` 无 F401/F821。

#### 步骤 1.3：删 `schedule_rebuild_service.py` 第 315-316 行

```python
def _default_algorithm(session: Session) -> str:
    return "ebbinghaus"
```

整个函数删除（全仓无调用方）。

#### 步骤 1.4：删 `schedule_policy.py` 第 183-192 行 `def resolve_interval(...)`

唯一调用方 `compute_next_review` 已在步骤 1.2 删除。

- **自查点（阶段一收尾）**：`cd apps/api && python -m pytest && python -m ruff check src tests` 全绿。

### 阶段二：删除 normalize_algorithm 并常量化调用点

`normalize_algorithm` 的 import 方共 6 个文件。所有 `next((normalize_algorithm(x.algorithm_used) ...), "ebbinghaus")`
形式的"算法探测"表达式，由于 normalize 恒返回 `"ebbinghaus"`，整体等价于常量 `"ebbinghaus"`。

#### 步骤 2.1：`schedule_policy.py` 删除函数本体

删除第 27-28 行 `def normalize_algorithm(...)`。文件内 3 处调用（第 101、196、211 行的
`normalized_algorithm = normalize_algorithm(algorithm)`）在阶段三会随签名收敛一并消失，本步骤先把这三行改为
`normalized_algorithm = "ebbinghaus"`，保证阶段二结束时可运行。

#### 步骤 2.2：`schedule_service.py`

- 第 12 行 import 列表删除 `normalize_algorithm`。
- 第 199-211 行 `infer_completed_stage_count` 中，修改前：

```python
    algorithm = next(
        (
            normalize_algorithm(schedule.algorithm_used)
            for schedule in (palace.review_schedules or [])
            if schedule.algorithm_used
        ),
        "ebbinghaus",
    )
    intervals = get_algorithm_intervals(session, algorithm)
    initial_slot_count = max(1, get_initial_same_day_slot_count(session, algorithm))
```

修改后：

```python
    algorithm = "ebbinghaus"
    intervals = get_algorithm_intervals(session, algorithm)
    initial_slot_count = max(1, get_initial_same_day_slot_count(session, algorithm))
```

- 第 315-322 行（`ensure_current_review_schedule_model` 内）同样把 `algorithm = next((normalize_algorithm(...)...), "ebbinghaus")` 整块替换为 `algorithm = "ebbinghaus"`。

#### 步骤 2.3：`schedule_rebuild_service.py`

- 第 23 行 import 删除 `normalize_algorithm`。
- 第 74-87 行 `palace_algorithm` 函数体，修改前是 `next((normalize_algorithm(item.algorithm_used) ...), "ebbinghaus")`，修改后：

```python
def palace_algorithm(
    session: Session,
    palace: Palace,
    *,
    default_algorithm: str | None = None,
) -> str:
    return "ebbinghaus"
```

（签名暂不动，阶段四处理；`segment_algorithm` 第 65-71 行本来就是 `return "ebbinghaus"`，不改。）

#### 步骤 2.4：`review_execution_service.py`

- 第 29 行 import 删除 `normalize_algorithm`。
- 第 92 行 `algorithm = normalize_algorithm(schedule.algorithm_used)` 改为 `algorithm = "ebbinghaus"`。

#### 步骤 2.5：`reviews/presentation/router.py`

- 第 25-28 行 import，修改后只保留：

```python
from memory_anki.modules.reviews.application.schedule_service import (
    get_algorithm_stage_labels,
)
```

- 第 67-76 行（`schedule_json` 内），修改前：

```python
    if palace_data and session:
        algorithm = next(
            (
                normalize_algorithm(item.algorithm_used)
                for item in (schedule.palace.review_schedules or [])
                if item.algorithm_used
            ),
            "ebbinghaus",
        )
        stage_labels = get_algorithm_stage_labels(session, algorithm)
```

修改后：

```python
    if palace_data and session:
        stage_labels = get_algorithm_stage_labels(session, "ebbinghaus")
```

（第 84 行 `"algorithm_used": schedule.algorithm_used` 是 API 输出字段，**不要删**。）

#### 步骤 2.6：`palaces/application/palace_serializer.py`

- 第 33-37 行 import 删除 `normalize_algorithm`。
- 第 92-102 行与第 190-202 行两处相同模式：把 `current_algorithm = next((normalize_algorithm(...)...), "ebbinghaus")`
  整块删除，`stage_labels = get_algorithm_stage_labels(session, current_algorithm)` 改为
  `stage_labels = get_algorithm_stage_labels(session, "ebbinghaus")`。

#### 步骤 2.7：`palaces/application/segment_review_support.py` 清理两个未使用 import

核实发现该文件有两个**从未在函数体中使用**的 import，一并删除：

- 第 10-12 行 `from ...schedule_policy import (resolve_interval_from_base_date,)`
- 第 25 行 import 列表中的 `normalize_algorithm`（保留同一 import 中的 `get_algorithm_intervals`、`get_config_value`）

- **自查点（阶段二收尾）**：`rg -n "normalize_algorithm" apps/api` 无任何匹配；`python -m pytest` 全绿。

### 阶段三：收敛核心函数签名（去掉无意义的 algorithm 形参）

> 本阶段每改一个函数就同步改它的全部调用方；调用方清单已核实写死在下面，不要凭记忆。

#### 步骤 3.1：`schedule_policy.py`

| 函数 | 新签名 | 说明 |
|---|---|---|
| `get_algorithm_intervals_for_policy` | `(policy)` | 形参 `algorithm` 体内未用，直接删 |
| `get_initial_same_day_slot_count_for_policy` | `(policy)` | 内部调用同步去参 |
| `build_review_schedule_draft` | 关键字参数中删除 `algorithm: str` | 体内 `normalized_algorithm` 相关行删除 |
| `resolve_interval_from_base_date` | `(value, base_date)` | 返回 4 元组的最后一位直接写 `"ebbinghaus"` |
| `resolve_interval_from_base_datetime_for_policy` | `(policy, value, base_datetime)` | 同上 |

以 `resolve_interval_from_base_date` 为例，修改后：

```python
def resolve_interval_from_base_date(value: str, base_date: date) -> tuple[int, date, str, str]:
    if value == "1h":
        return 0, base_date, "1h", "ebbinghaus"
    if value == "sleep":
        return 0, base_date, "sleep", "ebbinghaus"
    days = int(value)
    return days, base_date + timedelta(days=days), "standard", "ebbinghaus"
```

返回元组形状（含 `algorithm_used` 位）**保持不变**，`ReviewScheduleDraft.algorithm_used` 字段保留。

#### 步骤 3.2：`schedule_service.py` 及其调用方

| 函数 | 新签名 | 已核实的调用方（全部要改） |
|---|---|---|
| `get_algorithm_intervals` | `(session)` | 本文件第 83、177、210、323 行；`review_execution_service.py` 第 93 行；`segment_review_support.py` 第 119、135 行；`segment_progress_service.py` 第 35 行 |
| `get_algorithm_stage_labels` | `(session)` | `reviews/presentation/router.py`（步骤 2.5 处）；`palace_serializer.py` 两处；`segment_review_projections.py` 第 183 行 |
| `get_initial_same_day_slot_count` | `(session)` | 本文件第 181、211 行；`review_execution_service.py` 第 49 行 |
| `create_review_schedule` | 删除关键字参数 `algorithm` | 仅本文件第 183 行（已核实无外部调用） |
| `create_initial_review_schedules` | `(session, palace_id, anchor_date=None)` | 本文件内部；`review_execution_service.py` 第 169 行改为 `create_initial_review_schedules(session, palace_id)` |
| `update_all_pending_schedules` | `(session)` | `settings/presentation/router.py` 第 113-116 行改为 `update_all_pending_schedules(session)` |

调用方修改示例——`segment_review_projections.py` 第 182-183 行，修改前：

```python
    algorithm = palace_review_algorithm(session, palace)
    stage_labels = get_algorithm_stage_labels(session, algorithm)
```

修改后（`algorithm` 变量随之无用则删除该行；若下文还有别的使用先保留）：

```python
    stage_labels = get_algorithm_stage_labels(session)
```

`segment_review_support.py` 第 114-127（`segment_stage_progress`）与 130-151（`palace_stage_progress`）中的
`algorithm = segment_review_algorithm(...)` / `algorithm = palace_review_algorithm(...)` 行同理：
`get_algorithm_intervals(session)` 去参后，若 `algorithm` 变量再无使用即删除该行。

#### 步骤 3.3：`schedule_rebuild_service.py` 内部调用点

- 第 113、283 行 `get_algorithm_intervals_for_policy(policy, algorithm)` → `get_algorithm_intervals_for_policy(policy)`；
  相邻的 `algorithm = "ebbinghaus"` 局部变量若再无使用则删除。
- 第 117 行 `get_initial_same_day_slot_count_for_policy(policy, algorithm)` → `(policy)`。
- 第 189-198、245-253 行两处 `build_review_schedule_draft(policy, review_number=..., algorithm=algorithm, ...)`
  删除 `algorithm=algorithm,` 一行。
- 第 92 行 `_resolve_completed_count_after_submit`？——不在本文件，见下一步。

#### 步骤 3.4：`review_execution_service.py`

- 第 37-52 行 `_resolve_completed_count_after_submit`：删除形参 `algorithm: str,`，第 49 行调用去参。
- 第 92-106 行：`algorithm = "ebbinghaus"` 行删除；`intervals = get_algorithm_intervals(session)`；
  `_resolve_completed_count_after_submit(session=session, schedule_review_type=..., ...)` 删除 `algorithm=algorithm,` 实参。

- **自查点（阶段三收尾）**：`python -m pytest && python -m ruff check src tests && lint-imports` 全绿；
  `rg -n "algorithm=" apps/api/src/memory_anki/modules/reviews` 只剩 `algorithm_used=` 相关行。

### 阶段四：删除外围死参数壳（algorithm_override / default_algorithm）

先 grep 确认调用方（`rg -n "algorithm_override|default_algorithm" apps/api`），当前已核实：

1. `schedule_rebuild_service.py`：`rebuild_palace_review_schedules`（第 109 行）与
   `rebuild_all_pending_review_schedules`（第 275 行）删除 `algorithm_override: str | None = None` 形参
   （体内第 112、282 行本就写死 `"ebbinghaus"`）；第 299-305 行内部调用删除 `algorithm_override=algorithm,` 实参。
2. `schedule_service.py` 第 347-353 行（`ensure_current_review_schedule_model` 内）调用
   `rebuild_palace_review_schedules(...)` 删除 `algorithm_override=algorithm,` 实参。
3. `segment_progress_service.py`：第 59-67 行包装函数与第 70-90 行 `rebuild_palace_default_segment_progress`
   删除 `algorithm_override` 形参与转发实参；第 30-34 行
   `algorithm = resolve_palace_review_algorithm(session, palace, default_algorithm="ebbinghaus")` 改为直接
   `intervals = get_algorithm_intervals(session)`（`algorithm` 变量删除，第 9-11 行的
   `palace_algorithm as resolve_palace_review_algorithm` import 若无其他使用一并删除）。
4. `schedule_rebuild_service.py` 的 `segment_algorithm` / `palace_algorithm` 删除 `default_algorithm` 形参；
   `segment_review_support.py` 第 76-99 行两个包装函数（`segment_review_algorithm`/`palace_review_algorithm`）
   同步删除 `default_algorithm` 形参及 `default_algorithm=... or default_segment_algorithm(session)` 转发。
   改完后若这两个包装函数/`default_segment_algorithm` 已无任何调用方
   （注意 `segment_review_service.py` 第 18-36 行以 `_segment_algorithm` 等别名 re-export，需先
   `rg -n "_segment_algorithm|_palace_algorithm|_default_segment_algorithm|segment_review_algorithm|palace_review_algorithm" apps/api`
   确认），无调用方则连同 re-export 一并删除；仍有调用方则只收签名、保留函数。

- **自查点（阶段四收尾）**：`rg -n "algorithm_override|default_algorithm" apps/api/src` 无匹配（`default_algorithm`
  作为遗留 Config 键的字符串仅出现在 `settings/presentation/router.py` 与 alembic 0008，属 01-10 范围，不算）。

### 明确不要做的事

1. 不要删除或改动 DB 列 `algorithm_used`（`_tables/palaces.py` 第 285 行）及任何 alembic 迁移。
2. 不要删除 API 响应中的 `algorithm_used` 字段（reviews router 第 84 行、dashboard service 第 125 行、
   `palaces/domain/schemas.py` 第 88 行）——前端契约保持不变。
3. 不要动 `ReviewScheduleDraft.algorithm_used` 字段与 `create_review_schedule_from_draft` 的写库行为。
4. 不要改前端 `apps/web` 任何文件。
5. 不要顺手重构 `schedule_rebuild_service.py` 里与算法无关的进度重建逻辑。

## 3. 测试验收标准

### 可执行命令

| 命令 | 期望结果 |
|---|---|
| `cd apps/api && python -m pytest` | 全部通过（每阶段结束各跑一次） |
| `cd apps/api && python -m ruff check src tests` | 无报错 |
| `cd apps/api && python -m mypy` | 与基线一致 |
| `cd apps/api && lint-imports` | 契约通过 |
| `rg -n "normalize_algorithm" apps/api` | 无匹配 |
| `rg -n "compute_next_review|generate_schedule_for_palace" apps/api` | 无匹配 |

### 行为验收（人工）

1. 前端新建一个宫殿并触发复习计划 → 生成的当日复习槽位（1h/睡前）与既往一致（`create_initial_review_schedules` 链路）。
2. 完成一次到期复习 → 下一轮复习日期按 `1h,sleep,1,2,4,7,15,30,60` 间隔推进（`submit_review` → `rebuild_palace_review_schedules` 链路）。
3. 设置页修改"艾宾浩斯间隔"并选择"应用到全部待复习" → 所有未完成计划按新间隔重建（`update_all_pending_schedules` 去参后仍工作）。
4. 用 SQLite 工具查看 `review_schedules` 表 → 新写入行的 `algorithm_used` 仍为 `ebbinghaus`。

### 回归检查

- `GET /api/v1/reviews/...` 队列/今日复习响应中 `algorithm_used`、`stage_labels`、`review_stages` 字段结构不变。
- 启动迁移 `run_review_schedule_repair_migration`（依赖 `repair_review_stage_progress` → `rebuild_all_pending_review_schedules`）正常执行。
- 分段复习进度（segment_review_projections / segment_progress_service）总数、已完成数、百分比数值与改前一致。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；核实 normalize_algorithm 位于 schedule_policy.py 27-28 行、6 个 import 方；另发现 7 个死函数与 2 处未使用 import（segment_review_support.py），一并纳入清单；确认 algorithm_used 列保留策略 | - |
