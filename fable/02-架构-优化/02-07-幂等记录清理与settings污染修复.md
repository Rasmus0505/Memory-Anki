---
编号: 02-07
标题: 为幂等记录增加 TTL 清理，并修复 GET /settings 返回 api_mutation.* 污染
类型: 优化
范围: 架构
优先级: P0
预估工作量: M
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 02-07 幂等记录清理与 settings 污染修复

## 1. 原始需求

两个互相放大的问题（均已核实）：

1. **幂等记录无限膨胀**：`modules/persistence/application/idempotency.py`（67 行）把每个带 `X-Memory-Anki-Mutation-ID` 头的 mutation 响应 JSON 存进 `config` 表（键前缀 `api_mutation.`，第 13 行 `CONFIG_PREFIX`），只写不删、无 TTL。调用方为 `modules/reviews/presentation/router.py`（get/save 各 2 处）。每提交一次复习就永久多一行含完整宫殿序列化 JSON 的 config 记录。
2. **GET /settings 返回全部 config**：`modules/settings/presentation/router.py` 的 `read_settings()`（第 69–88 行）执行 `session.query(Config).all()`，除一个小黑名单外**所有** config 行都进响应——包括所有 `api_mutation.*` 大 JSON 与 `client_preferences.*`。设置接口响应体随复习次数线性膨胀，前端每次读设置都拖全量幂等缓存。

目标：`read_settings` 改为白名单/前缀排除查询；为 `api_mutation.*` 增加 TTL 清理（启动时执行），双设备同步场景安全（清理是幂等的删除旧行，两台设备各自跑一遍无冲突）。

## 2. 详细执行清单

> 硬约束：只改 `idempotency.py`、`settings/presentation/router.py`、`app/startup_runtime.py` 三个文件；不要改 `config` 表结构（无需迁移）；不要改前端；不要动 reviews router 的幂等调用点。

### 步骤 1：read_settings 改为前缀排除 + DEFAULTS 白名单合并

打开 `modules/settings/presentation/router.py`，替换第 69–88 行：

```python
# 修改前
def read_settings(session: Session) -> dict:
    result = dict(DEFAULTS)
    for row in session.query(Config).all():
        if row.key in {
            "default_algorithm",
            ...  # 12 个黑名单键
        }:
            continue
        result[row.key] = row.value
    return result

# 修改后
_SETTINGS_EXCLUDED_KEYS = {
    "default_algorithm",
    "algorithm_change_scope",
    "custom_intervals",
    "time_recording_threshold_seconds",
    "flow_voice_api_key",
    "flow_voice_base_url",
    "flow_voice_model",
    "flow_voice_voice",
    "flow_voice_format",
    "flow_voice_sample_rate",
    "flow_voice_instruction",
    "flow_voice_thinking_enabled",
}
_SETTINGS_EXCLUDED_PREFIXES = (
    "api_mutation.",          # 幂等缓存（persistence 模块）
    "client_preferences.",    # 客户端偏好（走 /profile/client-preferences）
    "ai_model_catalog.",      # AI 模型目录（走 /settings/ai-models）
    "ai_prompt.",             # 提示词模板（走 /settings/ai-prompts）
)


def read_settings(session: Session) -> dict:
    result = dict(DEFAULTS)
    rows = session.query(Config).filter(
        *[Config.key.notlike(f"{prefix}%") for prefix in _SETTINGS_EXCLUDED_PREFIXES]
    ).all()
    for row in rows:
        if row.key in _SETTINGS_EXCLUDED_KEYS:
            continue
        result[row.key] = row.value
    return result
```

**执行前必须核实排除前缀**：跑一次 `sqlite3 <APP_HOME>/data/memory_palace.db "SELECT DISTINCT substr(key,1,instr(key,'.')) FROM config WHERE instr(key,'.')>0"`（或用 Python 脚本）列出实际存在的带点前缀；`ai_model_catalog.`/`ai_prompt.` 若实际键名不同（以 `modules/settings/application/ai_model_registry_catalog.py`、`ai_prompts.py` 中的真实前缀常量为准），改成真实值；不确定的前缀**宁可不排除**——本步骤的底线目标只是 `api_mutation.` 与 `client_preferences.` 两个已确认的污染源。

不要做：不要改成"只返回 DEFAULTS 白名单键"——现状 write_settings 只允许写 DEFAULTS 内的键（第 94–102 行），但历史库里可能存有其他顶层设置键，激进白名单有丢字段风险。

自查点：`GET /api/v1/settings` 响应中无任何 `api_mutation.` 与 `client_preferences.` 键；`ebbinghaus_intervals` 等常规键仍在；`python -m pytest tests/test_review_routes.py -q` 通过（该文件多处依赖 settings 路由）。

### 步骤 2：给幂等模块加清理函数

打开 `modules/persistence/application/idempotency.py`，文件末尾追加：

```python
IDEMPOTENCY_TTL_DAYS = 14


def purge_expired_idempotency_records(
    session: Session,
    *,
    ttl_days: int = IDEMPOTENCY_TTL_DAYS,
    now: datetime | None = None,
) -> int:
    """删除超过 TTL 的 api_mutation.* 行，返回删除数量。updated_at 为空的行视为过期。"""
    cutoff = (now or utc_now_naive()) - timedelta(days=ttl_days)
    query = session.query(Config).filter(
        Config.key.like(f"{CONFIG_PREFIX}%"),
        (Config.updated_at.is_(None)) | (Config.updated_at < cutoff),
    )
    deleted = query.delete(synchronize_session=False)
    session.commit()
    return int(deleted)
```

文件头部补充 import：`from datetime import datetime, timedelta`（`utc_now_naive` 第 9 行已有）。

依据（已核实）：`Config.updated_at` 列存在（`infrastructure/db/_tables/misc.py` 第 146 行，default=utc_now_naive），插入与更新幂等行时都会有值；`X-Memory-Anki-Mutation-ID` 的重试窗口是分钟级，14 天 TTL 极其保守。

自查点：`python -c "from memory_anki.modules.persistence.application.idempotency import purge_expired_idempotency_records"` 无报错。

### 步骤 3：启动时执行清理

打开 `app/startup_runtime.py`，在 `run_prepare_runtime()`（第 83–106 行）的 `session` 使用块内、`ensure_daily_backup()` 之前加一行调用；`initialize_service_runtime()` 不加（serve 模式启动前必然先跑 prepare；若本仓库存在直接 serve 不 prepare 的启动路径，则改为在 `initialize_service_runtime` 的 `init_db()` 之后新开 session 调用——执行者以 `tools/dev_server.py` 与打包脚本的真实启动顺序为准，两处都调用也无害）：

```python
        _seed_default_config_rows(session)
        session.commit()
        purge_expired_idempotency_records(session)   # ← 新增
        ensure_review_log_study_sessions(session)
```

import 区加：`from memory_anki.modules.persistence.application.idempotency import purge_expired_idempotency_records`。

跨设备说明（写进代码注释）：清理只删"自己库里"的过期行；两台 Windows 设备各自启动各自清理，语义幂等，无同步冲突。

自查点：向 config 表手工插一行 `api_mutation.test-old`（updated_at 置 30 天前），启动一次后端，该行被删除；再插一行 updated_at 为当前时间的 `api_mutation.test-new`，启动后仍在。验证完删除测试行。

### 步骤 4：补一个针对性测试（建议）

在 `apps/api/tests/` 新建 `test_idempotency_purge.py`（用与其他测试相同的内存 SQLite 模式），覆盖三个断言：过期行被删、未过期行保留、`read_settings` 不含 `api_mutation.*`/`client_preferences.*` 键。不要为此引入 conftest 重构（10-01 的事）。

自查点：`python -m pytest tests/test_idempotency_purge.py -q` 通过。

## 3. 测试验收标准

```
cd apps/api && python -m pytest                  # 期望：全部通过
cd apps/api && python -m ruff check src tests    # 期望：0 错误
cd apps/api && python -m mypy                    # 期望：不多于基线错误
python tools/check_architecture.py               # 期望：passed
```

行为验收：

- 提交一次复习（带幂等头）→ 立刻用相同 `X-Memory-Anki-Mutation-ID` 重放 → 返回缓存响应（幂等功能未破坏）。
- `GET /api/v1/settings` 响应体积恢复到 KB 级；响应键集合 = DEFAULTS 键 ∪ 少量顶层运行时键，无点前缀污染键。
- `GET /api/v1/profile/client-preferences` 正常返回各偏好组（排除前缀未误伤其读取路径——它按精确键查询，不经过 read_settings）。
- 重启后端 → 日志/手工查询确认过期 `api_mutation.*` 行数下降。

回归检查：

- `write_settings` 的 `apply_to_pending` 全量重排逻辑（第 106–117 行）依赖 read_settings 前后对比 `SCHEDULE_IMPACTING_KEYS`，这些键都是 DEFAULTS 顶层键，不受排除影响——修改设置里的艾宾浩斯间隔并选择"应用到未完成计划"仍生效。
- `/settings/review`、`/profile/review-settings` 两组路由复用 read_settings，行为一并修复且不破坏（`tests/test_review_routes.py` 1073/1093/1104 行附近用例必须全绿）。
- 双设备：A 设备清理不影响 B 设备正在使用的新幂等记录（TTL 14 天 >> 同步周期）。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 核实：idempotency.py 确为 67 行、前缀 api_mutation.、无 TTL；read_settings 确在 69–88 行做 query(Config).all()；幂等调用方目前仅 reviews router；Config.updated_at 列存在可作 TTL 依据 |
| 2026-07-09 | Codex | 实现 `purge_expired_idempotency_records()`，TTL 默认 14 天；`run_prepare_runtime()` seed 默认配置后执行清理；`read_settings()` 查询排除 `api_mutation.` 与 `client_preferences.` 前缀 | 保留 `startup_runtime.py` 既有 `_tables`/`backup_lifecycle` 改动；前缀匹配使用 escaped LIKE，避免 `_` 通配符误删/误过滤；未排除 `ai_prompt.`/`ai_model_catalog.`：当前代码中提示词 config 键为 `ai_prompt_...` 下划线形式，AI 模型目录为独立 `ai_model_catalog` 表；实际 DB 前缀探针未发现带点前缀 |
| 2026-07-09 | Codex | 新增 `apps/api/tests/test_idempotency_purge.py` | 覆盖过期 `api_mutation.*` 删除、未过期与普通 config 保留、相似非前缀键不被误伤、`read_settings` 不返回 `api_mutation.*`/`client_preferences.*` 且保留历史顶层键 |
| 2026-07-09 | Codex | 验证 | `python -m pytest tests/test_idempotency_purge.py tests/test_settings_routes.py tests/test_idempotency.py tests/test_review_routes.py -q`：97 passed, 42 skipped；相关文件 `ruff` passed；相关文件 `mypy` passed；项目级 `python -m mypy` 仍受既有 `missing py.typed marker` 阻断，`python tools/check_architecture.py` 仍受既有前端 shared/import、长文件、openapi 端口、destructive migration、个人绝对路径规则阻断 |
