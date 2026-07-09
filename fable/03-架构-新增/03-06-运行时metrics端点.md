---
编号: 03-06
标题: 新增 /api/v1/metrics 运行时指标端点（DB 大小/表行数/AI 调用/备份时间）
类型: 新增
范围: 架构
优先级: P2
预估工作量: M
依赖文档: 无
状态: 已完成
负责代理: fable Worker 23
完成时间: 2026-07-09
---

# 03-06 运行时 metrics 端点

## 1. 原始需求

当前可观测端点只有 `GET /runtime-info` 与 `GET /runtime-health`（`apps/api/src/memory_anki/modules/settings/presentation/router.py` 第 188~197 行，实现于 `core/runtime.py` 的 `build_runtime_info`/`build_runtime_health`），只覆盖版本/启动信息，没有任何数据规模与健康度指标。双设备经百度网盘同步运行时数据的架构下，用户需要快速确认"这台机器上的数据是不是最新且完整的"：数据库多大、关键表多少行、AI 最近调用是否大量失败、最近一次备份是什么时候。

核实基础能力：AI 调用记录在 `external_ai_call_logs` 表（`infrastructure/db/_tables/misc.py` 第 112 行，含 `status`/`created_at` 列；查询封装 `infrastructure/llm/external_ai_call_logs.py`，但只有按条件 list，没有聚合计数，需新写）；备份列表能力已有 `modules/backups/application/backup_lifecycle.py` 第 72~117 行 `list_backups()`（返回含 `created_at`/`kind`/`scope` 的字典列表）。

目标：新增 `GET /api/v1/metrics`，返回上述关键计数，供前端 profile 页（`apps/web/src/features/profile/ProfilePage.tsx` 等）后续展示。

## 2. 详细执行清单

### 步骤 1：新建指标聚合服务

新建文件 `apps/api/src/memory_anki/modules/settings/application/metrics_service.py`，完整内容：

```python
from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from memory_anki.core.config import DB_PATH
from memory_anki.core.time import utc_now_naive
from memory_anki.infrastructure.db.models import ExternalAiCallLog
from memory_anki.modules.backups.application.backup_lifecycle import list_backups

# 只统计对用户有意义的核心表；名称与 infrastructure/db/_tables/ 中
# __tablename__ 一一对应，新增表时按需追加。
METRIC_TABLES = [
    "subjects",
    "chapters",
    "palaces",
    "palace_segments",
    "palace_mini_palaces",
    "palace_quiz_questions",
    "review_schedules",
    "review_logs",
    "study_sessions",
    "external_ai_call_logs",
    "english_courses",
    "english_reading_materials",
]


def _database_size_bytes() -> int | None:
    try:
        return DB_PATH.stat().st_size
    except OSError:
        return None


def _table_row_counts(session: Session) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in METRIC_TABLES:
        try:
            row = session.execute(
                text(f"SELECT COUNT(*) FROM {table}")  # 表名来自白名单常量，无注入风险
            ).fetchone()
            counts[table] = int(row[0]) if row else 0
        except Exception:
            counts[table] = -1  # 表不存在（老库尚未迁移）时标记为 -1
    return counts


def _ai_calls_last_24h(session: Session) -> dict[str, int]:
    since = utc_now_naive() - timedelta(hours=24)
    base = session.query(ExternalAiCallLog).filter(ExternalAiCallLog.created_at >= since)
    total = base.count()
    failed = base.filter(ExternalAiCallLog.status == "error").count()
    return {"total": total, "failed": failed}


def _latest_backup() -> dict[str, Any] | None:
    backups = list_backups()
    if not backups:
        return None
    latest = max(backups, key=lambda item: str(item.get("created_at") or ""))
    return {
        "created_at": latest.get("created_at"),
        "kind": latest.get("kind"),
        "scope": latest.get("scope"),
        "name": latest.get("name"),
        "has_database": latest.get("has_database"),
    }


def build_metrics(session: Session) -> dict[str, Any]:
    return {
        "generated_at": utc_now_naive().isoformat(timespec="seconds"),
        "database": {
            "path": str(DB_PATH),
            "size_bytes": _database_size_bytes(),
        },
        "table_row_counts": _table_row_counts(session),
        "ai_calls_last_24h": _ai_calls_last_24h(session),
        "latest_backup": _latest_backup(),
    }
```

注意：`utc_now_naive` 的导入路径 `memory_anki.core.time` 与幂等模块（`modules/persistence/application/idempotency.py` 第 9 行）用法一致。不要在这里引入 FastAPI。

**自查点**：`cd apps/api && python -c "from memory_anki.modules.settings.application.metrics_service import build_metrics; print('ok')"` 输出 ok。

### 步骤 2：挂路由

打开 `apps/api/src/memory_anki/modules/settings/presentation/router.py`，在 `api_runtime_health`（第 193~197 行）之后新增：

```python
from memory_anki.modules.settings.application.metrics_service import build_metrics  # 加到顶部 import 区


@router.get("/metrics")
def api_metrics(s: Session = Depends(session_dep)):
    return build_metrics(s)
```

该 router 以 `prefix="/api/v1"` 注册（main.py 第 159 行），最终路径即 `GET /api/v1/metrics`。不要给它做缓存/后台刷新——单用户手动打开 profile 页时现算即可（全部是 COUNT 查询与一次 stat，毫秒级）。

**自查点**：启动服务后 `curl http://127.0.0.1:8012/api/v1/metrics` 返回含 `database.size_bytes`、`table_row_counts.palaces`、`ai_calls_last_24h.total`、`latest_backup` 的 JSON。

### 步骤 3：后端测试

新建 `apps/api/tests/test_metrics_endpoint.py`（参照既有测试对 session/engine 的用法，如 `tests/test_external_ai_call_logs.py`）：

```python
from memory_anki.modules.settings.application.metrics_service import build_metrics


def test_build_metrics_shape(db_session):  # db_session fixture 名以 tests/conftest.py 实际为准
    payload = build_metrics(db_session)
    assert "generated_at" in payload
    assert isinstance(payload["table_row_counts"], dict)
    assert "palaces" in payload["table_row_counts"]
    assert set(payload["ai_calls_last_24h"]) == {"total", "failed"}
    assert "latest_backup" in payload
```

执行前先打开 `apps/api/tests/` 下任一路由测试文件确认 fixture 组织方式（是否有 conftest 提供 session/TestClient），照抄其模式；没有统一 fixture 时按 `test_external_ai_call_logs.py` 的做法自建内存库。**不要**为了测试去修改生产代码。

**自查点**：`cd apps/api && python -m pytest tests/test_metrics_endpoint.py -q` 全绿。

### 步骤 4：前端 profile 页展示（最小接入）

4a. 在 `apps/web/src/features/profile/api/profileApi.ts` 追加：

```typescript
export interface RuntimeMetrics {
  generated_at: string
  database: { path: string; size_bytes: number | null }
  table_row_counts: Record<string, number>
  ai_calls_last_24h: { total: number; failed: number }
  latest_backup: {
    created_at: string | null
    kind: string
    scope: string
    name: string
    has_database: boolean
  } | null
}

export function getRuntimeMetricsApi() {
  return request<RuntimeMetrics>('/metrics')
}
```

（`request` 的 import 与该文件既有写法保持一致。）

4b. 在 `apps/web/src/features/profile/ProfilePage.tsx` 增加一个"数据概览"卡片：加载时调 `getRuntimeMetricsApi`，展示四项——数据库大小（MB，`size_bytes / 1024 / 1024` 保留 1 位小数）、宫殿数/题目数/复习计划数（取 `table_row_counts` 的 `palaces`/`palace_quiz_questions`/`review_schedules`）、近 24h AI 调用（`total` 与 `failed`，failed>0 时红色提示）、最近备份时间（`latest_backup.created_at`，超过 24h 显示黄色提示）。样式复用该页面既有卡片组件；执行时先读 `ProfilePage.tsx` 现有结构再插入，不要重排既有区块。行数为 -1 的表显示"未迁移"。

**自查点**：`cd apps/web && npm run typecheck && npm run test` 通过；本机打开 profile 页能看到数据概览卡片。

### 明确不要做什么

- 不引入 Prometheus/StatsD 等指标体系，纯 JSON 端点；
- 不做历史指标存储与图表（只有当前快照）；
- 不在 metrics 里返回任何 API key/令牌/文件列表等敏感明细（只有计数与路径）；
- 不改 `build_runtime_info`/`build_runtime_health` 的既有返回。

## 3. 测试验收标准

可执行命令：

- `cd apps/api && python -m pytest tests/test_metrics_endpoint.py -q` → 全绿。
- `cd apps/api && python -m pytest` → 无新增失败。
- `cd apps/web && npm run typecheck && npm run test` → 通过。

行为验收：

1. `curl http://127.0.0.1:8012/api/v1/metrics` → 各项数值合理（`palaces` 行数与宫殿列表页数量一致；`size_bytes` 与文件资源管理器中 `memory_palace.db` 大小一致）。
2. 触发一次手动备份（profile 备份页或 `POST /api/v1/backups/create`）后再请求 → `latest_backup.created_at` 更新为刚才的时间。
3. 触发一次 AI 生成后再请求 → `ai_calls_last_24h.total` 加 1。
4. profile 页展示卡片数值与接口一致，AI 失败数>0 时有红色提示。

回归检查：

- `/runtime-info`、`/runtime-health` 响应不变；
- 备份创建/恢复流程不受影响（metrics 只读 `list_backups()`）。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | fable 文档代理 | 文档创建 | 已核实 external_ai_call_logs 表结构、list_backups() 返回字段、settings router 挂载前缀 |
| 2026-07-09 | fable Worker 23 | 最小后端实现 | 新增 settings application metrics 聚合服务与 `GET /api/v1/metrics`，返回数据库大小、核心表行数、近 24h AI 调用和最近备份摘要；补充后端 shape/路由测试。 |
