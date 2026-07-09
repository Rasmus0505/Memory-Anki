---
编号: 10-03
标题: 为 knowledge、settings、dashboard、backups 四个无专门测试的模块各建一个测试文件
类型: 新增
范围: 功能
优先级: P1（应该）
预估工作量: L（>8h，四个文件可分四批独立交付）
依赖文档: 10-01（conftest 先行）
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 10-03 knowledge / settings / dashboard / backups 测试补全

## 1. 原始需求

经核实 `apps/api/tests/` 目录清单，以下四个模块没有任何专门测试文件：

- **knowledge**：`modules/knowledge/presentation/router.py`（301 行，subjects/chapters 树 CRUD、subject editor、宫殿章节绑定）。仅 `tests/test_palace_chapter_binding.py` 间接覆盖绑定端点。
- **settings**：`modules/settings/presentation/router.py`（369 行，Config 读写、review 设置、client-preferences、ai-models 注册表、ai-prompts、ai-call-logs）。仅 `tests/test_review_routes.py` 挂载该 router 顺带使用。
- **dashboard**：`modules/dashboard/presentation/router.py`（38 行，唯一端点 `GET /dashboard`）+ `application/service.py`（301 行聚合逻辑）无任何直接测试。
- **backups**：`modules/backups/application/`（backup_lifecycle.py 225 行等 8 个文件）无生命周期测试；HTTP 入口目前挂在 palaces router 的 `/backups*` 五个端点上（`palaces/presentation/router.py` 528-589 行）。

目标：新建 `tests/test_knowledge_routes.py`、`tests/test_settings_routes.py`、`tests/test_dashboard_routes.py`、`tests/test_backup_lifecycle.py` 四个文件，覆盖主路径与关键分支。

## 2. 详细执行清单

> 禁止事项：不许修改 `apps/api/src/` 任何文件；不许删既有断言；backups 测试严禁触碰真实 `APP_HOME`（全部经 `tmp_path` + monkeypatch 模块常量）；不要测依赖外部 AI 网络的端点（ai-models 的 test 连接、ai-prompts 的模型调用）。

### 步骤 1：新建 `apps/api/tests/test_knowledge_routes.py`

依赖 10-01 的 `make_client`。knowledge router 的写端点会调 `maybe_create_rolling_backup`（模块级 import，第 15 行），先 no-op 掉。完整骨架与第一批用例：

```python
"""knowledge 路由（subjects/chapters 树）直接测试。"""
import pytest

from memory_anki.modules.knowledge.presentation import router as knowledge_router


@pytest.fixture(autouse=True)
def _no_rolling_backup(monkeypatch):
    monkeypatch.setattr(
        knowledge_router, "maybe_create_rolling_backup", lambda *args, **kwargs: None
    )


@pytest.fixture()
def client(make_client):
    return make_client(knowledge_router)


@pytest.fixture()
def subject_id(client) -> int:
    response = client.post("/api/v1/subjects", json={"name": "数学", "color": "#ff0000"})
    assert response.status_code == 200
    return response.json()["id"]


class TestSubjects:
    def test_create_and_list(self, client, subject_id):
        items = client.get("/api/v1/subjects").json()
        assert any(item["id"] == subject_id and item["name"] == "数学" for item in items)

    def test_update(self, client, subject_id):
        body = client.put(f"/api/v1/subjects/{subject_id}", json={"name": "高数"}).json()
        assert body["name"] == "高数"

    def test_update_missing(self, client):
        assert client.put("/api/v1/subjects/999", json={"name": "x"}).json() == {
            "error": "not found"
        }

    def test_delete(self, client, subject_id):
        assert client.delete(f"/api/v1/subjects/{subject_id}").json() == {"ok": True}
        assert client.get("/api/v1/subjects").json() == []


class TestChapterTree:
    def test_create_chapter_and_tree(self, client, subject_id):
        chapter = client.post(
            f"/api/v1/subjects/{subject_id}/chapters", json={"name": "第一章"}
        ).json()
        child = client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "1.1", "parent_id": chapter["id"]},
        ).json()
        tree = client.get(f"/api/v1/subjects/{subject_id}/tree").json()
        assert tree["subject"]["id"] == subject_id
        assert tree["chapters"][0]["id"] == chapter["id"]
        assert tree["chapters"][0]["children"][0]["id"] == child["id"]

    def test_delete_chapter_cascades(self, client, subject_id):
        chapter = client.post(
            f"/api/v1/subjects/{subject_id}/chapters", json={"name": "第一章"}
        ).json()
        client.post(
            f"/api/v1/subjects/{subject_id}/chapters",
            json={"name": "1.1", "parent_id": chapter["id"]},
        )
        assert client.delete(f"/api/v1/chapters/{chapter['id']}").json() == {"ok": True}
        assert client.get(f"/api/v1/subjects/{subject_id}/tree").json()["chapters"] == []
```

再补齐用例表：

| 用例名 | 请求 | 期望 |
|---|---|---|
| test_get_chapter_detail_with_breadcrumbs | 建三层章节后 GET `/chapters/{孙层id}` | 200；`chapter.breadcrumbs` 依序为祖、父 |
| test_get_chapter_missing | GET `/chapters/999` | `{"error": "not found"}` |
| test_update_chapter_fields | PUT `/chapters/{id}`，body `{"name": "改", "sort_order": 5}` | 返回体两字段均更新 |
| test_subject_editor_roundtrip | GET `/subjects/{id}/editor` 200；PUT 同 URL body `{"editor_doc": {"root": {"data": {"text": "数学"}, "children": []}}}` | PUT 200 后 GET 读回保存内容 |
| test_link_chapters_binding | 需同时挂载 palaces router（`make_client(knowledge_router, palace_router)`）；建宫殿+章节后 PUT `/palaces/{pid}/chapters` body `{"chapter_ids": [cid]}` | `ok is True`；GET `/palaces/{pid}/chapters` 含该章节。（`test_palace_chapter_binding.py` 已深覆盖，此处仅留一条冒烟，不要照抄该文件的复杂场景） |

- 自查点：`cd apps/api && python -m pytest tests/test_knowledge_routes.py -v` 全绿。

### 步骤 2：新建 `apps/api/tests/test_settings_routes.py`

settings router 无磁盘副作用（除 ai-call-logs 工件下载，跳过不测）。骨架：

```python
"""settings 路由（Config/偏好/AI 模型注册表）直接测试。"""
import pytest

from memory_anki.modules.settings.presentation import router as settings_router


@pytest.fixture()
def client(make_client):
    return make_client(settings_router)
```

用例表（全部实现，settings 读写函数在 router 文件 69-155 行）：

| 类 / 用例名 | 请求 | 期望 |
|---|---|---|
| TestSettings / test_get_returns_defaults | GET `/settings` | 200；body 包含 `memory_anki.core.config.DEFAULTS` 的全部 key |
| TestSettings / test_put_persists_known_key | 从 DEFAULTS 任选一个 key（执行时打开 `core/config.py` 确认，如 `default_algorithm`）PUT `/settings` body `{key: 新值}` | 返回体该 key 为新值；再 GET 仍为新值 |
| TestSettings / test_put_ignores_unknown_key | PUT body `{"not_a_real_key": "1"}` | 返回体不含该 key |
| TestReviewSettings / test_review_aliases_share_config | PUT `/settings/review` 改某 key 后 GET `/profile/review-settings` | 两个别名端点读到同一值（三组端点共用 read/write_settings） |
| TestClientPreferences / test_get_all_groups_default_none | GET `/profile/client-preferences` | 200；`items` 含 `memory_anki_shortcuts` 等全部 9 个分组，初始均为 None |
| TestClientPreferences / test_put_roundtrip | PUT body `{"review_feedback_settings": {"a": 1}}` | 返回 `items.review_feedback_settings == {"a": 1}`；再 GET 一致 |
| TestClientPreferences / test_put_unknown_group_ignored | PUT body `{"unknown_group": 1}` | 返回 `items` 不含 unknown_group |
| TestClientPreferences / test_put_null_clears_value | 先写值再 PUT `{"review_feedback_settings": None}` | GET 读回 None |
| TestAiModels / test_get_scenarios_shape | GET `/settings/ai-models` | 200；返回体为 dict（结构以首跑输出为准，断言关键顶层 key） |
| TestAiModels / test_catalog_upsert_invalid_payload_400 | POST `/settings/ai-models/models` body `{}` | 400（`AiModelRegistryError` 分支；若空 body 实际不报错，改用明显非法 payload，执行时以 `ai_model_registry_admin.py` 校验逻辑为准） |
| TestAiModels / test_provider_test_invalid_provider_400 | POST `/settings/ai-models/providers/not-a-provider/test` | 400 + `code == "provider_invalid"` |
| TestAiPrompts / test_list_templates | GET `/settings/ai-prompts` | 200；`items` 非空 |
| TestAiCallLogs / test_list_empty | GET `/ai-call-logs` | 200；`items == []` |
| TestAiCallLogs / test_get_missing_404 | GET `/ai-call-logs/nope` | 404 |

不要测：`/settings/ai-models/models/{key}/test`、`/providers/{key}/test` 的成功路径（要打真实模型 API）；`/runtime-info`、`/runtime-health`（`tests/test_runtime_info.py` 已覆盖）。

- 自查点：`python -m pytest tests/test_settings_routes.py -v` 全绿。

### 步骤 3：新建 `apps/api/tests/test_dashboard_routes.py`

```python
"""dashboard 聚合端点直接测试（造数据断言聚合正确性）。"""
from datetime import date, timedelta

import pytest

from memory_anki.infrastructure.db.models import Palace, ReviewSchedule
from memory_anki.modules.dashboard.presentation import router as dashboard_router


@pytest.fixture()
def client(make_client):
    return make_client(dashboard_router)


def test_empty_database_returns_200(client):
    response = client.get("/api/v1/dashboard")
    assert response.status_code == 200
    assert isinstance(response.json(), dict)


def test_invalid_month_returns_400(client):
    response = client.get("/api/v1/dashboard", params={"month": "not-a-month"})
    assert response.status_code == 400


def test_seeded_palace_and_schedule_show_up(client, session_factory):
    with session_factory() as session:
        palace = Palace(title="P1", description="", editor_doc="{}")
        session.add(palace)
        session.flush()
        session.add(
            ReviewSchedule(
                palace_id=palace.id,
                scheduled_date=date.today() - timedelta(days=1),
                interval_days=1,
                algorithm_used="ebbinghaus",
                completed=False,
                review_number=0,
                review_type="standard",
            )
        )
        session.commit()

    body = client.get("/api/v1/dashboard").json()
    # 首跑时打印 body，确定聚合字段名后把下面断言具体化：
    # 期望能找到 宫殿总数 == 1、逾期/待复习计数 == 1 的字段。
    assert body  # TODO: 按 build_dashboard_payload 实际输出字段收紧断言
```

执行要求：第一次跑通后，打开 `modules/dashboard/application/service.py` 的 `build_dashboard_payload` 返回结构，把 `test_seeded_palace_and_schedule_show_up` 的 TODO 断言替换为**具体字段断言**（宫殿计数、待复习计数），并另加两条用例：`duration_mode`/`start_date`+`end_date` 合法组合返回 200、非法日期返回 400。**不许**把 TODO 断言留成 `assert body` 交差。

- 自查点：`python -m pytest tests/test_dashboard_routes.py -v` 全绿且无 TODO 残留（`rg -n "TODO" apps/api/tests/test_dashboard_routes.py` 无输出）。

### 步骤 4：新建 `apps/api/tests/test_backup_lifecycle.py`

测 application 层生命周期（创建/列表/恢复），路径常量全部重定向到 `tmp_path`。参考既有先例：`tests/test_database_performance_optimizations.py` 379 行起 `patch.object(storage_backup, "APP_HOME", ...)`。注意：`FULL_BACKUPS_DIR`/`RESCUE_BACKUPS_DIR`/`DB_PATH` 被 `backup_lifecycle.py` 第 9 行按名 import，`APP_HOME`/`BACKUPS_DIR`/`DB_PATH` 被 `storage_backup.py` 第 9 行按名 import，**两个模块都要 patch**。

```python
"""backups 生命周期（创建/列表/恢复）测试，全部落在 tmp_path。"""
import pytest

from memory_anki.modules.backups.application import backup_lifecycle, storage_backup


@pytest.fixture()
def backup_env(tmp_path, monkeypatch):
    app_home = tmp_path / "home"
    backups = app_home / "data" / "backups"
    full_dir = backups / "full"
    rescue_dir = backups / "rescue"
    db_path = app_home / "data" / "memory_anki.db"
    for folder in (full_dir, rescue_dir, db_path.parent):
        folder.mkdir(parents=True, exist_ok=True)
    db_path.write_bytes(b"fake-sqlite-content")

    monkeypatch.setattr(storage_backup, "APP_HOME", app_home)
    monkeypatch.setattr(storage_backup, "BACKUPS_DIR", backups)
    monkeypatch.setattr(storage_backup, "DB_PATH", db_path)
    monkeypatch.setattr(backup_lifecycle, "DB_PATH", db_path)
    monkeypatch.setattr(backup_lifecycle, "FULL_BACKUPS_DIR", full_dir)
    monkeypatch.setattr(backup_lifecycle, "RESCUE_BACKUPS_DIR", rescue_dir)
    # 这两个副作用会碰真实环境，全部 no-op：
    monkeypatch.setattr(storage_backup, "ensure_runtime_dirs", lambda: None)
    monkeypatch.setattr(
        storage_backup, "checkpoint_sqlite_wal", lambda **kwargs: None
    )
    monkeypatch.setattr(backup_lifecycle, "analyze_database", lambda: None)
    return {"app_home": app_home, "full": full_dir, "rescue": rescue_dir, "db": db_path}


def test_create_full_backup_writes_manifest_and_db(backup_env):
    folder = backup_lifecycle.create_full_backup("unit-test")
    assert folder.parent == backup_env["full"]
    assert (folder / "manifest.json").exists()


def test_list_backups_reads_created_folder(backup_env):
    backup_lifecycle.create_full_backup("unit-test")
    items = backup_lifecycle.list_backups()
    assert len(items) == 1
    assert items[0]["kind"] == "full"
    assert items[0]["reason"] == "unit-test"


def test_restore_database_backup_returns_rescue_and_restores(backup_env, monkeypatch):
    monkeypatch.setattr(
        backup_lifecycle, "assert_exclusive_runtime_operation", lambda *a, **k: None
    )
    folder = backup_lifecycle.create_full_backup("unit-test")
    backup_env["db"].write_bytes(b"corrupted")
    rescue = backup_lifecycle.restore_database_backup(str(folder))
    assert rescue.parent == backup_env["rescue"]
    assert backup_env["db"].read_bytes() == b"fake-sqlite-content"


def test_restore_missing_backup_raises(backup_env):
    with pytest.raises(FileNotFoundError):
        backup_lifecycle.restore_database_backup(str(backup_env["app_home"] / "nope"))
```

说明：`create_full_backup` 内部经 `write_storage_backup` 复制 storage-layout 声明的存储项，manifest 里数据库项是否 `included` 取决于 `DB_PATH` 相对 `APP_HOME` 的布局；若首跑发现 db 未被复制，打开 `apps/api/storage-layout.json` 核对 `database.relative_path` 并把 fixture 的 `db_path` 调成一致（`data/memory_anki.db` 是当前值的预期，执行时核实）。首跑失败时禁止通过删断言过关，必须修 fixture 路径。

另补一条路由冒烟（可放同文件）：挂载 palaces router（`/backups` 端点宿主），monkeypatch `palace_router.list_backups`/`create_full_backup` 指向上述 tmp 环境后，`GET /api/v1/backups` 返回 200 且 items 长度正确。**注意**：若 02-03（backups 路由归位）已执行，端点宿主可能已迁移，先 `rg -n "\"/backups\"" apps/api/src` 找当前宿主再挂载对应 router。

- 自查点：`python -m pytest tests/test_backup_lifecycle.py -v` 全绿；跑完后检查真实运行时目录（`MEMORY_ANKI_HOME` 或默认位置）无新增备份文件夹。

### 明确不要做的事

1. 不要把四个文件合并成一个（按模块拆分，方便 CI 定位与并行认领）。
2. 不要测 `recover_palaces_from_git_snapshot`（依赖 git 仓库快照，超出本文档范围）。
3. 不要在 settings 测试里给 `write_settings` 的 `apply_to_pending="all"` 分支造复杂排程数据（那属于 reviews 域，`test_review_routes.py` 的地盘）。

## 3. 测试验收标准

| 命令 | 期望结果 |
|---|---|
| `cd apps/api && python -m pytest tests/test_knowledge_routes.py tests/test_settings_routes.py tests/test_dashboard_routes.py tests/test_backup_lifecycle.py -v` | 全部通过（四文件合计 ≥ 30 passed） |
| `cd apps/api && python -m pytest tests -q` | 全绿，无既有用例回归 |
| `cd apps/api && python -m ruff check tests` | 0 错误 |

行为验收：临时把 `test_backup_lifecycle.py` 的 fixture 中 `monkeypatch.setattr(backup_lifecycle, "FULL_BACKUPS_DIR", ...)` 注释掉再跑 → 用例应失败或试图写真实目录（立即恢复），证明隔离生效。

回归检查：`test_palace_chapter_binding.py`（knowledge 间接覆盖）、`test_review_routes.py`（settings 挂载方）不受影响。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；核实四模块无专门测试、backups 端点宿主为 palaces router 528-589 行、路径常量按名 import 需双模块 patch | - |
| 2026-07-09 | Codex | 新增 knowledge/settings/dashboard/backups 四个专门测试文件；backup fixture 按实际 `storage-layout.json` 使用 `data/memory_palace.db`，全程 patch 到 `tmp_path` | 目标四文件 `pytest` 36 passed；新增四文件 `ruff` passed。全量 `pytest tests -q` 受既有 `test_fable_pagination_response_models.py` 失败阻断；全量 `ruff check tests` 受既有未定义名阻断 |
