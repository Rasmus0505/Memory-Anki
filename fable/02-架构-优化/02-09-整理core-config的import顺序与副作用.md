---
编号: 02-09
标题: 整理 core/config.py 的 import 顺序与消除 import 期副作用（建目录、建引擎）
类型: 优化
范围: 架构
优先级: P1
预估工作量: M
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 02-09 整理 core-config 的 import 顺序与副作用

## 1. 原始需求

`apps/api/src/memory_anki/core/config.py`（226 行）存在多处 import 期问题（均已核实）：

- 第 32 行 `from pydantic_settings import BaseSettings` 出现在第 12–31 行两个函数定义**之后**（模块中部才 import），违反 PEP8/E402，阅读时容易漏掉依赖。
- 第 37 行模块级执行 `load_dotenv()`——**任何**模块只要 `from memory_anki.core.config import X` 就触发读 `.env` 并写 `os.environ`。全仓有 31 个模块直接 import 本模块。
- 第 72 行 import 期实例化 `EnvSettings()` 单例，第 76–88 行把 13 个环境设置 re-export 成模块级常量（DASHSCOPE_* 7 个、ZHIPU 2、SILICONFLOW 2、DEEPSEEK 2），后续再改环境变量不生效，测试无法用 monkeypatch.setenv 影响它们。
- 连锁副作用：`infrastructure/db/_tables/_base.py` 第 19 行 import 期执行 `ensure_runtime_dirs()`（在磁盘上建 13+ 个目录），第 20–23 行 import 期急切 `create_engine(...)`——**import 任何 ORM 模型都会建目录+建引擎**，工具脚本、alembic env.py、单元测试全部被迫承受。

目标：import 顺序规范化、消除"import 即建目录"、引擎改为惰性创建并提供显式初始化入口。涉及面大（31 个 import 方 + 全部测试），必须分批推进、每批可独立回滚。

## 2. 详细执行清单

> 硬约束：13 个环境常量与全部路径常量的**名字和取值语义保持不变**（31 个引用方一个都不改）；`get_session()`/`init_db()`/`Base` 的公开签名不变；跨设备约束——运行时路径仍全部经由本模块派生，禁止写死路径。每批做完必须全量 pytest。

### 批次 1：修 import 顺序与 dotenv 时机（低风险）

**步骤 1.1**：打开 `core/config.py`，把第 32 行 `from pydantic_settings import BaseSettings` 与第 34–35 行的两个 `memory_anki.core.*` import 移到文件顶部（第 4 行 `from pathlib import Path` 之后、`try: from dotenv ...` 之前的常规位置）。`load_dotenv` 的 try/except 兼容层（6–31 行）保持原样。

**步骤 1.2**：`load_dotenv()` 调用（第 37 行）保持模块级执行**位置不变**（挪到 EnvSettings 定义之前即可）——彻底去掉它需要改所有入口（uvicorn、tools/dev_server.py、alembic、pytest），收益低风险高，明确**不做**；但补一行注释说明"import 副作用：读取 CWD 下 .env"。

自查点：`python -m ruff check src`（E402 不再出现于本文件）；`python -m pytest -q` 全绿。

### 批次 2：环境常量改为惰性解析（保持名字不变）

用模块级 `__getattr__`（PEP 562）把 13 个常量变成首次访问才实例化 EnvSettings：

```python
# 修改前（72–88 行）
_env = EnvSettings()
DASHSCOPE_API_KEY = _env.DASHSCOPE_API_KEY
...（13 行 re-export）

# 修改后
_ENV_SETTING_NAMES = frozenset({
    "DASHSCOPE_API_KEY", "DASHSCOPE_BASE_URL", "DASHSCOPE_ASR_MODEL",
    "DASHSCOPE_VISION_MODEL", "DASHSCOPE_OCR_MODEL", "DASHSCOPE_TEXT_MODEL",
    "ENGLISH_TRANSLATION_MODEL", "ZHIPU_API_KEY", "ZHIPU_BASE_URL",
    "SILICONFLOW_API_KEY", "SILICONFLOW_BASE_URL",
    "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL",
})
_env: EnvSettings | None = None


def _get_env() -> EnvSettings:
    global _env
    if _env is None:
        _env = EnvSettings()
    return _env


def __getattr__(name: str):
    if name in _ENV_SETTING_NAMES:
        return getattr(_get_env(), name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
```

**重大注意**：`DEFAULTS` 字典（第 140–196 行）在模块级引用 `DASHSCOPE_TEXT_MODEL` 等 6 个常量作为默认值——模块自身代码不触发 `__getattr__`。因此 DEFAULTS 里的引用必须改为 `_get_env().DASHSCOPE_TEXT_MODEL` 形式（或先在 DEFAULTS 定义前显式 `_d = _get_env()` 再用 `_d.DASHSCOPE_TEXT_MODEL`）。这会使 DEFAULTS 的构建成为"首个 import 时机"的 EnvSettings 实例化点——净效果是把实例化从"import config"延到"import config"（DEFAULTS 也是模块级）……**所以若不同时把 DEFAULTS 惰性化则本批收益有限**。两个方案：
  - 方案 A（推荐，改动小）：接受 EnvSettings 仍在 import 期实例化，本批只做 `from X import Y` → 属性访问的解耦收益跳过，**直接跳过批次 2**，把它标记为不执行并在进度表说明。
  - 方案 B（完整）：DEFAULTS 一并改为 `def get_defaults() -> dict` 函数 + 模块 `__getattr__` 里对 `DEFAULTS` 惰性构建缓存。引用 DEFAULTS 的模块有 `settings/presentation/router.py`、`app/startup_runtime.py` 等（`rg "import DEFAULTS" apps/api/src` 核实，均为 `from ... import DEFAULTS`，`__getattr__` 对 from-import 同样生效，引用方无需改动）。
执行者按工期二选一，选了 B 必须逐个跑 settings/startup 相关测试。

自查点（选 B 时）：`python -c "import memory_anki.core.config as c; print(c.DEFAULTS['ai_model_text'])"` 输出正常；`MEMORY_ANKI_...` 环境变量在首次访问前设置能生效（写一个临时脚本验证 DASHSCOPE_TEXT_MODEL 可被 env 覆盖）。

### 批次 3：数据库引擎惰性化（核心收益）

打开 `infrastructure/db/_tables/_base.py`（53 行），替换第 19–23 行：

```python
# 修改前
ensure_runtime_dirs()
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": 30},
)

# 修改后
_engine = None


def get_engine():
    global _engine
    if _engine is None:
        ensure_runtime_dirs()
        _engine = create_engine(
            DATABASE_URL,
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        event.listen(_engine, "connect", _configure_sqlite_pragmas)
    return _engine


def __getattr__(name: str):
    if name == "engine":
        return get_engine()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
```

配套修改（同文件内）：

1. 第 26 行装饰器 `@event.listens_for(engine, "connect")` 依赖模块级 engine，改为普通函数 `_configure_sqlite_pragmas`（去掉装饰器），注册动作移入 `get_engine()`（如上）。
2. 第 51–52 行 `get_session()` 改为 `return Session(get_engine())`。
3. **排查 engine 的全部引用方**：`rg "import engine|\.engine\b|from memory_anki.infrastructure.db.models import (.*engine" apps/api` ——`infrastructure/db/models.py` 若 re-export `engine`，改为同样的模块 `__getattr__` 转发或 re-export `get_engine`；`from module import engine` 形式经模块 `__getattr__` 仍能取到（惰性触发），但 import 那一刻就会建引擎，等于没惰性——这类引用方（含测试）需逐个改为调用 `get_engine()`。核实清单记录到进度表。

不要做：不要动 `run_migrations`/`init_db` 的调用链；不要改 pragma 内容；不要在本批同时做批次 2。

自查点：`python -c "import memory_anki.infrastructure.db.models"` 在一个**空目录**（无 APP_HOME 环境变量指向的目录不存在）下执行，不再创建任何目录；随后 `python -c "from memory_anki.infrastructure.db.models import get_session; get_session()"` 才建目录建库。`python -m pytest -q` 全绿。

### 批次 4：显式初始化入口核查

启动路径已有显式初始化：`app/startup_runtime.py` 的 `run_prepare_runtime()`/`initialize_service_runtime()` 均先 `ensure_legacy_repo_data_migrated()`（内部 `ensure_runtime_dirs()`）再 `init_db()`。本批只做核查+补漏：

1. `rg "ensure_runtime_dirs" apps/api tools` 列出全部调用点，确认 uvicorn 启动、`tools/dev_server.py`、`tools/create_startup_backup.py`、alembic `env.py` 四条路径在触碰 DB 前都有目录初始化（惰性 engine 的 `get_engine()` 内已兜底，风险很低）。
2. 若 alembic 独立运行（`alembic upgrade head`）路径无目录兜底，在 `alembic/env.py` 第 12 行 `config.set_main_option` 之前补 `ensure_runtime_dirs()` 调用。

自查点：删除测试用临时 APP_HOME 目录后分别跑 `python -m uvicorn memory_anki.app.main:app`、`python tools/dev_server.py`（如适用）、`alembic upgrade head`，三者都能自建目录正常工作。

## 3. 测试验收标准

```
cd apps/api && python -m pytest                  # 期望：每个批次后全绿
cd apps/api && python -m ruff check src tests    # 期望：0 错误（E402 消除）
cd apps/api && python -m mypy                    # 期望：不多于基线错误
python tools/check_architecture.py               # 期望：passed
```

行为验收：

- 干净环境（临时 MEMORY_ANKI_HOME 指向不存在目录）import ORM 模型不建目录；启动服务后目录齐全、库可读写。
- 双设备核验：两台设备启动后 `GET /api/v1/runtime-info` 路径信息正确，均指向各自 APP_HOME。
- `.env` 中的 DASHSCOPE_API_KEY 仍被正确读取（AI 生成功能连通性测试 `POST /settings/ai-models/providers/dashscope/test`）。

回归检查：

- 26 个测试文件全绿（多数测试自建内存 engine，不依赖全局 engine，风险点在少数直接 import engine 的测试——批次 3 第 3 点已列举排查方法）。
- alembic 12 个版本可从零库执行到 head。
- 打包/双设备启动脚本（若存在）不因 engine 惰性化改变行为。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 核实：BaseSettings import 确在第 32 行（函数定义之后）；load_dotenv() 第 37 行 import 期执行；EnvSettings re-export 为 **13** 个模块级常量（并非描述所说 56 个；含路径常量在内本模块共约 30 个模块级名字）；_base.py 第 19 行 ensure_runtime_dirs + 第 20 行急切 engine 属实；直接 import 方 31 个模块 |
