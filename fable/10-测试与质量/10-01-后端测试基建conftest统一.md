---
编号: 10-01
标题: 为 apps/api/tests 补建 conftest.py 与共享测试基类，消除 26 个测试文件各自复制的 in-memory 引擎搭建与逐 router monkeypatch
类型: 优化
范围: 架构
优先级: P0（必须）
预估工作量: L（>8h，可分批执行）
依赖文档: 与 02-01（统一会话依赖）双向关联，执行前必读其进度记录；10-02/10-03/10-04/10-10 依赖本文档
状态: 未开始
负责代理: 无
完成时间: 无
---

# 10-01 后端测试基建：conftest.py 统一

## 1. 原始需求

`apps/api/tests/` 目录下共 26 个测试文件（约 13000 行，unittest.TestCase 风格），**没有 conftest.py**。经核实：

- 12 个文件各自复制了一份 in-memory SQLite 引擎搭建代码（`create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)` + `Base.metadata.create_all`）。
- 其中 8 个路由测试文件在 `setUp`/`tearDown` 里逐 router 替换模块级属性 `get_session` 注入测试库。典型证据 `apps/api/tests/test_review_routes.py` 58-77 行：

```58:77:apps/api/tests/test_review_routes.py
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)
        self.original_get_session = review_router.get_session
        self.original_dashboard_get_session = dashboard_router.get_session
        self.original_palace_get_session = palace_router.get_session
        self.original_settings_get_session = settings_router.get_session

        def get_test_session():
            return self.SessionLocal()

        review_router.get_session = get_test_session
        dashboard_router.get_session = get_test_session
        palace_router.get_session = get_test_session
        settings_router.get_session = get_test_session
```

问题：任何会话注入机制调整（例如 02-01 把 `session_dep` 收敛到 `infrastructure/db/deps.py`）都要同步改 8 个文件几十处；新增测试文件（10-02/10-03/10-04 计划新建 6 个）只能继续复制粘贴。期望效果：`tests/conftest.py` 提供 pytest fixture（`test_engine`、`session_factory`、`db_session`、`make_client`），`tests/support.py` 提供 unittest 共享基类 `RouterTestCase`，26 个存量文件分批迁移，新文件直接用 fixture。

**与 02-01 的关系（必读）**：02-01 会把 11 个 router 的本地 `session_dep()` 收敛为 `memory_anki/infrastructure/db/deps.py` 一处。本文档的注入方案通过 **FastAPI `app.dependency_overrides`（按 `session_dep` 函数对象为 key）** 实现，天然兼容两种状态：02-01 未执行时逐 router 覆盖各自的 `session_dep`；02-01 执行后所有 router 共享同一个 `session_dep`，重复覆盖同一 key 无副作用。因此**两个文档可以任意先后执行**，但执行本文档第 3 步迁移前，先读 02-01 的进度记录表确认 router 现状（本地 `session_dep` 还是共享 import）。

## 2. 详细执行清单

> 全程禁止事项：不许为了让某个用例变绿而删除或弱化既有断言；不许修改 `apps/api/src/` 下任何文件（那是 02-01 的事）；不许把 unittest 测试体改写成 pytest 函数风格（本文档只消除 setUp/tearDown 重复，测试体一行不动）；不许改 `pyproject.toml`。

### 步骤 1：新建 `apps/api/tests/conftest.py`

完整文件内容如下（面向新建的 pytest 风格测试文件，10-02/10-03/10-04 直接使用）：

```python
"""apps/api/tests 共享 fixture。

- test_engine / session_factory / db_session：in-memory SQLite 测试库。
- make_client：挂载指定 presentation router 模块并注入测试会话的 TestClient 工厂。
  通过 FastAPI dependency_overrides 覆盖各 router 模块的 ``session_dep``，
  同时兼容 02-01 改造前（每个 router 有本地 session_dep）与改造后
  （全部 router 共享 infrastructure/db/deps.session_dep）两种状态。
"""
from collections.abc import Callable

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base


@pytest.fixture()
def test_engine():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(test_engine):
    return sessionmaker(bind=test_engine)


@pytest.fixture()
def db_session(session_factory):
    session = session_factory()
    yield session
    session.close()


@pytest.fixture()
def make_client(session_factory) -> Callable[..., TestClient]:
    def _make(*router_modules) -> TestClient:
        app = FastAPI()

        def override_session_dep():
            s = session_factory()
            try:
                yield s
            finally:
                s.close()

        for module in router_modules:
            app.include_router(module.router, prefix="/api/v1")
            app.dependency_overrides[module.session_dep] = override_session_dep
        return TestClient(app)

    return _make
```

- 自查点：`cd apps/api && python -m pytest --collect-only -q` 仍能收集全部既有用例且无 conftest 导入错误。

### 步骤 2：新建 `apps/api/tests/support.py`（unittest 共享基类）

完整文件内容如下：

```python
"""unittest.TestCase 风格路由测试的共享基建（迁移存量 26 个文件用）。

用法：
    from tests_support 说明见各测试文件——实际 import 写法为 ``from support import RouterTestCase``
    （pytest 将 tests/ 加入 sys.path，rootdir 下可直接 import 同目录模块）。

    class MyRouteTests(RouterTestCase):
        ROUTER_MODULES = (palace_router, settings_router)

        def seed(self, session):
            session.add(...)
            session.commit()
"""
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from memory_anki.infrastructure.db.models import Base


class RouterTestCase(unittest.TestCase):
    """建 in-memory 库 + 挂载 ROUTER_MODULES + dependency_overrides 注会话。"""

    ROUTER_MODULES: tuple = ()

    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine)

        app = FastAPI()

        def override_session_dep():
            s = self.SessionLocal()
            try:
                yield s
            finally:
                s.close()

        for module in self.ROUTER_MODULES:
            app.include_router(module.router, prefix="/api/v1")
            app.dependency_overrides[module.session_dep] = override_session_dep
        self.app = app
        self.client = TestClient(app)

        with self.SessionLocal() as session:
            self.seed(session)

    def seed(self, session):
        """子类覆盖此钩子做种子数据，默认不种。"""

    def tearDown(self):
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()
```

注意两点设计约束：

1. 属性名保持 `self.engine`、`self.SessionLocal`、`self.app`、`self.client` 与存量文件一致，迁移时测试体零改动。
2. 覆盖对象是 `module.session_dep`（handler 里 `Depends(session_dep)` 的函数对象），**不再 monkeypatch `module.get_session`**——这样 tearDown 无需恢复任何全局状态，02-01 落地后也无需再改。

- 自查点：`cd apps/api && python -c "import sys; sys.path.insert(0, 'tests'); from support import RouterTestCase; print('ok')"` 输出 ok。

### 步骤 3：分批迁移 12 个含引擎复制的存量文件

迁移动作（每个文件相同）：
1. 打开文件，把测试类改为继承 `RouterTestCase`（顶部加 `from support import RouterTestCase`），设 `ROUTER_MODULES = (...)` 为原 setUp 里 `include_router` 的模块。
2. 把原 setUp 里的种子数据代码搬进 `def seed(self, session):`（把 `with self.SessionLocal() as session:` 的缩进层剥掉）。
3. 删除原 setUp/tearDown 中：引擎创建、`Base.metadata.create_all/drop_all`、`get_session` 备份/替换/恢复、app 组装、`engine.dispose()`。文件里**除会话注入外**的其他 patch（如 `palace_router.maybe_create_rolling_backup`、`main_module.get_session`、`task_service.get_session`）原样保留在子类自己的 setUp/tearDown 里（子类 setUp 先 `super().setUp()` 再做额外 patch）。
4. 运行该文件全量用例，必须全绿且用例数与迁移前一致。

批次清单（每批做完必须整体 `python -m pytest tests -q` 全绿再进下一批）：

| 批次 | 文件 | 涉及 router | 备注 |
|---|---|---|---|
| 批 1（试点，小文件） | `tests/test_freestyle_routes.py`、`tests/test_study_session_routes.py`、`tests/test_mini_palace_routes.py` | freestyle；sessions+dashboard；palaces | mini_palace 保留 `maybe_create_rolling_backup` patch |
| 批 2 | `tests/test_palace_chapter_binding.py`、`tests/test_editor_state_service.py`、`tests/test_external_ai_call_logs.py` | knowledge+palaces；无 router（仅引擎）；无 router | 后两个只用 `test_engine` 等价物：继承基类但 `ROUTER_MODULES=()`，或仅复用引擎搭建段 |
| 批 3 | `tests/test_english_routes.py`、`tests/test_english_reading_routes.py`、`tests/test_mindmap_ai_split_service.py` | english；english_reading；无 router | 前两个文件里 `task_service.get_session` 等 application 层 patch 不要动 |
| 批 4 | `tests/test_palace_quiz_routes.py`、`tests/test_database_performance_optimizations.py` | palace_quiz+settings；混合 | 后者含 `storage_backup.APP_HOME` 等路径 patch，保留 |
| 批 5（最大，单独一批） | `tests/test_review_routes.py` | reviews+palaces+settings（+dashboard） | 4226 行；其中 `main_module.get_session` 的替换与本迁移无关，不要动；本批完成后才可执行 10-10 拆分 |

其余 14 个文件（`test_dev_server_migration_preflight.py`、`test_file_sync.py`、`test_local_config.py`、`test_manual_text_quiz_parser.py`、`test_mindmap_import_job_service.py`、`test_openai_compatible.py`、`test_prune_deleted_features_migration.py`、`test_restore_review_schedule_algorithm_migration.py`、`test_review_preview.py`、`test_runtime_activity.py`、`test_runtime_info.py`、`test_startup_runtime_and_supervisor.py`、`test_study_sessions_migration.py`、`test_web_static_cache_headers.py`）不含 in-memory 引擎复制，**不迁移、不要碰**。

- 每批自查点：`cd apps/api && python -m pytest tests -q` 全绿；`python -m pytest tests --collect-only -q` 的用例总数与迁移前记录值一致（迁移前先执行一次并把数字记入本文档进度表）。

### 步骤 4：迁移完成后的残留检查

```powershell
cd D:\322321\Memory-Anki
rg -c "create_engine\(" apps/api/tests
```

期望：只有 `tests/conftest.py` 与 `tests/support.py` 两处（若某文件确因特殊引擎参数无法迁移，在进度表记录原因）。

## 3. 测试验收标准

| 命令 | 期望结果 |
|---|---|
| `cd apps/api && python -m pytest tests -q` | 全部通过，失败数 0 |
| `cd apps/api && python -m pytest tests --collect-only -q` | 用例总数 ≥ 迁移前记录值（不许减少） |
| `cd apps/api && python -m ruff check tests` | 0 错误 |
| `rg -n "router.get_session = " apps/api/tests` | 迁移完成的文件中无匹配 |

行为验收：任选一个迁移后的文件单跑（如 `python -m pytest tests/test_freestyle_routes.py -v`），输出的用例名列表与迁移前完全一致。

回归检查：不得在真实 `APP_HOME` 数据库产生任何数据（跑完测试后检查运行时目录无新文件）；26 个文件的既有断言一条不许删。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；核实 26 个测试文件、12 个含引擎复制、8 个含 get_session monkeypatch、test_review_routes.py 58-77 行证据 | - |
