---
编号: 02-09
标题: 渐进整理 core/config.py：修正 import 顺序、收敛 import 副作用、冻结环境常量再导出
类型: 优化
范围: 架构
优先级: P1（应该）
预估工作量: M（2-8h）
依赖文档: 无
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 02-09 整理 core/config.py

## 1. 原始需求

`apps/api/src/memory_anki/core/config.py`（227 行）是全后端的配置枢纽，存在三类问题：

1. **import 位置违例**：第 32 行 `from pydantic_settings import BaseSettings` 出现在两个函数定义（`_fallback_load_dotenv`、`load_dotenv`）**之后**，属于 PEP 8 / ruff E402 违例，阅读时容易漏看依赖。
2. **环境设置被再导出为模块级常量**：44-88 行定义 `EnvSettings` 并在 import 时实例化单例 `_env`（72 行），再把 13 个字段逐一 re-export 为模块常量（76-88 行 `DASHSCOPE_API_KEY = _env.DASHSCOPE_API_KEY` 等）；加上 110-133 行的 20 余个路径常量与 140-196 行的 `DEFAULTS` 大字典，模块级名字数量庞大，新增一个环境变量要改 3 处（类字段、re-export、调用点）。
3. **import 即副作用**：第 37 行 `load_dotenv()` 在 import 时执行；更严重的是 `apps/api/src/memory_anki/infrastructure/db/_tables/_base.py` 第 19 行在 **import 时**执行 `ensure_runtime_dirs()`（在磁盘上创建十几个目录）并在 20-23 行急切创建 engine——任何工具脚本只要 import 到 models 就会在当前环境写盘，测试也无法在设置环境变量前拦截。

期望效果：**渐进整理、禁止大爆炸重构**（几十个文件 import 这些常量，一次性改动风险不可控）。分四个独立小批次，每批独立可验收、可回滚。

## 2. 详细执行清单

> 禁止事项：不要一次性删除任何被引用的模块级常量（先 `rg` 确认引用数为 0 才能删）；不要改变 `APP_HOME` 的解析逻辑（102-107 行，跨设备可用性依赖它）；不要把 `DEFAULTS` 拆走（多个模块依赖，且 02-07 依赖其语义）；四个批次必须按序独立提交，禁止合并成一个大改动。

### 批次 1：修正 import 顺序（纯移动，零行为变化）

打开 `apps/api/src/memory_anki/core/config.py`，把第 32 行 `from pydantic_settings import BaseSettings` 上移到第 4 行 `from pathlib import Path` 之后（即与其他第三方 import 并列，位于 try/except dotenv 块之前）。其余一字不动。

自查点：`python -m ruff check src/memory_anki/core/config.py` 通过；`python -c "import memory_anki.core.config"` 无报错。

### 批次 2：把 dotenv 兼容层挪出主文件

`_fallback_load_dotenv` 与 `load_dotenv` 包装（12-31 行）是纯兼容工具，与配置本身无关。新建 `apps/api/src/memory_anki/core/dotenv_compat.py`，把 6-31 行整体迁入（含 try/except import）；`config.py` 顶部改为 `from memory_anki.core.dotenv_compat import load_dotenv`，37 行 `load_dotenv()` 调用保持原位（**此批不消除该副作用**，import 时机语义不变）。

执行前先 `rg -n "from memory_anki.core.config import load_dotenv" apps/api` 检查是否有外部引用；若有，在 config.py 保留 `load_dotenv` 的 re-export 一行。

自查点：`python -m pytest tests -q` 全绿；`.env` 中的 key 仍能生效（临时在 `.env` 加 `DASHSCOPE_TEXT_MODEL=test-model`，`python -c "from memory_anki.core.config import DASHSCOPE_TEXT_MODEL; print(DASHSCOPE_TEXT_MODEL)"` 输出 `test-model`，然后撤销）。

### 批次 3：冻结环境常量再导出 + 提供访问器

目标：不再让"新增环境变量"要求新增 re-export。做法：

1. 在 `EnvSettings` 单例（72 行）之后新增访问器：

```python
def get_env_settings() -> EnvSettings:
    """推荐入口：新代码一律用 get_env_settings().<FIELD>，不要再新增模块级 re-export。"""
    return _env
```

2. 在 74-75 行的注释块中追加一行中文说明：`# 【冻结】以下 re-export 仅为兼容存量 import，禁止新增条目；新字段经 get_env_settings() 访问。`
3. **不删除**现有 13 个 re-export（76-88 行）——`rg -n "from memory_anki.core.config import" apps/api/src | rg "DASHSCOPE|ZHIPU|SILICONFLOW|DEEPSEEK|ENGLISH_TRANSLATION"` 会列出所有存量引用点，逐个迁移属于后续独立任务，本批只立规矩。

自查点：`python -c "from memory_anki.core.config import get_env_settings; print(get_env_settings().DASHSCOPE_BASE_URL)"` 输出默认 URL。

### 批次 4：收敛 _tables/_base.py 的 import 副作用

打开 `apps/api/src/memory_anki/infrastructure/db/_tables/_base.py`。现状（19-23 行）：

```python
ensure_runtime_dirs()
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
)
```

风险分析（执行者必读）：engine 的**创建**不触盘，真正需要目录存在的是**首次连接**（SQLite 建库文件）。因此把 `ensure_runtime_dirs()` 从 import 时挪到连接前是安全的。改法：

修改后：

```python
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
)


@event.listens_for(engine, "connect")
def _ensure_dirs_before_first_connect(dbapi_connection, _connection_record) -> None:
    ensure_runtime_dirs()
```

注意：把这个新监听器放在**现有** `_configure_sqlite_pragmas` 监听器（26-40 行）**之前**注册无关紧要（目录创建幂等、开销是一次 stat），但更优做法是在 `init_db()`（47-48 行）与 `get_session()`（51-52 行）都不改，仅靠 connect 事件兜底。engine 急切创建本身保留（模块 docstring 1-7 行明确说明这是历史行为契约，多处 `from ..._base import engine`）。

自查点：删除（或改名备份）`APP_HOME` 目录后运行 `python -c "from memory_anki.infrastructure.db.models import get_session; s=get_session(); s.execute(__import__('sqlalchemy').text('select 1')); print('ok')"` → 目录被自动重建且输出 ok；仅 `python -c "import memory_anki.infrastructure.db.models"`（不连接）→ 不创建目录。测试完成后恢复原 APP_HOME 数据。

## 3. 测试验收标准

可执行命令与期望结果（工作目录 `apps/api`，每批次结束都要跑前三条）：

| 命令 | 期望结果 |
|---|---|
| `python -m pytest tests -q` | 全部通过 |
| `python -m ruff check src tests` | 0 错误（含 E402 消除） |
| `lint-imports` | 契约 KEPT |
| `python -m mypy` | 错误数不高于改造前基线（先记录基线） |

行为验收：
- 双设备约束：设置 `MEMORY_ANKI_HOME` 指向临时目录后启动 → 数据目录在该临时目录下被创建（跨设备路径派生未破坏）。
- prepare/serve 两种启动模式均正常完成（`MEMORY_ANKI_STARTUP_MODE` 分别设 `prepare`、`serve`）。
- `.env` 中的 API key 仍被正确读取（设置页 AI 供应商测试连接可用）。

回归检查：批次 4 后，`alembic` 命令行迁移（`python -m alembic upgrade head`，工作目录 apps/api）仍可独立运行；打包/脚本入口（`tools/` 下若有 import models 的脚本）不因目录副作用缺失而崩溃。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | - |
| 2026-07-09 | Codex | 按保守方案完成 02-09 | `BaseSettings` 已回到顶部 import 区；dotenv 兼容层迁至 `core/dotenv_compat.py`，`config.py` 仍 import 并调用 `load_dotenv()`；新增 `get_env_settings()` 并冻结现有 re-export；`_tables/_base.py` 保留模块级 `engine`，通过 `do_connect` 在首次 DBAPI 连接前执行 `ensure_runtime_dirs()`，未执行重复文档中的激进惰性 engine + `__getattr__` 方案，以避免改变公开 API 与模块级 engine 契约。 |
