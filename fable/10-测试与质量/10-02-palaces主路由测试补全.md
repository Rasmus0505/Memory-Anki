---
编号: 10-02
标题: 新建 tests/test_palace_routes.py，补全 palaces 主路由（628 行、约 40 个端点）缺失的独立测试
类型: 新增
范围: 功能
优先级: P1（应该）
预估工作量: L（>8h，可按端点分组分批）
依赖文档: 10-01（conftest 与 fixture 先行）
状态: 已完成
负责代理: Codex
完成时间: 2026-07-09
---

# 10-02 palaces 主路由测试补全

## 1. 原始需求

`apps/api/src/memory_anki/modules/palaces/presentation/router.py` 共 628 行，承载约 40 个端点（宫殿 CRUD、grouped 列表、editor 读写、segments、mini-palaces、versions、attachments、practice session、/backups 等），但 `apps/api/tests/` 下**没有 test_palace_routes.py**。现有覆盖是间接的：`tests/test_mini_palace_routes.py` 覆盖 mini-palace 端点与 grouped/subjects 的少量断言，`tests/test_palace_chapter_binding.py` 覆盖章节绑定，`tests/test_review_routes.py` 顺带打到部分 palace 端点。核心 CRUD、editor 读写、segments、versions、attachments、practice session 的主路径与 404 分支无直接测试，重构（如 02-01、10-10）时没有安全网。

目标：新建 `apps/api/tests/test_palace_routes.py`，用 10-01 的 fixture 覆盖下表用例。

**重要现状事实**（写断言前必须知道）：该 router 的"未找到"分支**大多返回 HTTP 200 + `{"error": "not found"}`**（如 `api_get` 第 152 行），而不是 404。测试按现状断言（状态码 200 + error 字段），不要顺手把生产代码改成 404——那是另一个文档（03-03 response_model）的范围。

## 2. 详细执行清单

> 禁止事项：不许修改 `apps/api/src/` 下任何文件；不许删改既有测试文件；`/backups` 五个端点的生命周期测试归 10-03，本文档只测 `GET /backups` 打通即可，避免重复。

### 步骤 1：确认 10-01 已提供 fixture

打开 `apps/api/tests/conftest.py`，确认存在 `make_client`、`session_factory`。若 10-01 未执行，先执行 10-01 的步骤 1（仅 conftest.py 那一步即可解锁本文档）。

### 步骤 2：新建 `apps/api/tests/test_palace_routes.py` 骨架与第一批用例

完整初始文件内容（第一批：CRUD + grouped + 404 分支，可直接落盘）：

```python
"""palaces 主路由（modules/palaces/presentation/router.py）直接测试。

约定：
- 会话注入依赖 tests/conftest.py 的 make_client / session_factory。
- 滚动备份钩子 maybe_create_rolling_backup 会写真实磁盘，统一替换为 no-op。
- 当前 router 的 not-found 分支返回 200 + {"error": "not found"}，按现状断言。
"""
import json

import pytest

from memory_anki.modules.palaces.presentation import router as palace_router


@pytest.fixture(autouse=True)
def _no_rolling_backup(monkeypatch):
    monkeypatch.setattr(
        palace_router, "maybe_create_rolling_backup", lambda *args, **kwargs: None
    )


@pytest.fixture()
def client(make_client):
    return make_client(palace_router)


@pytest.fixture()
def palace_id(client) -> int:
    payload = {
        "title": "测试宫殿",
        "description": "desc",
        "pegs": [{"name": "桩子A", "content": "内容A"}],
    }
    response = client.post("/api/v1/palaces", json=payload)
    assert response.status_code == 200
    return response.json()["id"]


class TestPalaceCrud:
    def test_create_returns_palace_json(self, client):
        response = client.post(
            "/api/v1/palaces", json={"title": "新宫殿", "description": "", "pegs": []}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["title"] == "新宫殿"
        assert isinstance(body["id"], int)

    def test_list_contains_created_palace(self, client, palace_id):
        response = client.get("/api/v1/palaces")
        assert response.status_code == 200
        assert any(item["id"] == palace_id for item in response.json())

    def test_list_search_filters_by_title(self, client, palace_id):
        assert client.get("/api/v1/palaces", params={"search": "测试宫殿"}).json()
        assert client.get("/api/v1/palaces", params={"search": "不存在的词"}).json() == []

    def test_get_detail(self, client, palace_id):
        response = client.get(f"/api/v1/palaces/{palace_id}")
        assert response.status_code == 200
        assert response.json()["title"] == "测试宫殿"

    def test_get_missing_returns_error_payload(self, client):
        response = client.get("/api/v1/palaces/99999")
        assert response.status_code == 200
        assert response.json() == {"error": "not found"}

    def test_update_title(self, client, palace_id):
        response = client.put(
            f"/api/v1/palaces/{palace_id}", json={"title": "改名后"}
        )
        assert response.status_code == 200
        assert response.json()["title"] == "改名后"

    def test_update_missing_returns_error_payload(self, client):
        response = client.put("/api/v1/palaces/99999", json={"title": "x"})
        assert response.json() == {"error": "not found"}

    def test_delete_then_get_reports_missing(self, client, palace_id):
        assert client.delete(f"/api/v1/palaces/{palace_id}").json() == {"ok": True}
        assert client.get(f"/api/v1/palaces/{palace_id}").json() == {"error": "not found"}


class TestPalaceGroupedLists:
    def test_grouped_shape(self, client, palace_id):
        body = client.get("/api/v1/palaces/grouped").json()
        assert set(body) == {"groups", "ungrouped", "subjects"}

    def test_grouped_summary_shape(self, client, palace_id):
        body = client.get("/api/v1/palaces/grouped-summary").json()
        assert set(body) == {"groups", "ungrouped", "subjects"}

    def test_subject_shelf_returns_payload(self, client, palace_id):
        response = client.get("/api/v1/palaces/subjects")
        assert response.status_code == 200
```

- 自查点：`cd apps/api && python -m pytest tests/test_palace_routes.py -v`，期望 11 passed。

### 步骤 3：按下表分批补齐其余用例

每个用例一个测试方法，命名 `test_<动作>_<期望>`。逐端点用例表（请求均带 `/api/v1` 前缀）：

**editor 读写（TestPalaceEditor 类）**

| 用例名 | 请求 | 期望 |
|---|---|---|
| test_get_editor_returns_palace_and_state | GET `/palaces/{id}/editor` | 200；body 含 `palace` 与 `editor_doc` |
| test_get_editor_missing | GET `/palaces/99999/editor` | 200 + `{"error": "not found"}` |
| test_put_editor_saves_doc | PUT `/palaces/{id}/editor`，body `{"editor_doc": {"root": {"data": {"text": "T"}, "children": []}}}` | 200；再 GET editor 返回保存的 root 文本 |
| test_put_editor_invalid_payload_returns_400 | PUT editor，body 触发 `ValueError`（如 `{"editor_doc": "not-a-dict"}`——先手工确认 save_palace_editor_state 对该输入抛 ValueError，否则改用其他非法值） | 400 |
| test_put_editor_conflict_returns_409 | 先 GET editor 拿 `editor_version`，PUT 一次成功后再用旧版本号 PUT | 409（`EditorStateConflictError` 分支） |
| test_focus_session_returns_focus_fields | GET `/palaces/{id}/focus-session` | 200；body 含 `focus_node_uids`、`focus_count` |
| test_toggle_focus_node | PUT `/palaces/{id}/focus-nodes/uid-1`，body `{"focused": true}` | 200；`focused is True` 且 `focus_count == 1`；再发 `{"focused": false}` 后 count 归 0 |

**segments（TestPalaceSegments 类）**

| 用例名 | 请求 | 期望 |
|---|---|---|
| test_list_segments_contains_default | GET `/palaces/{id}/segments` | 200；`items` 为列表 |
| test_create_segment | POST `/palaces/{id}/segments`，body `{"title": "分段1", "node_uids": []}`（字段以 `segment_service.create_palace_segment` 实际接受为准，写用例前打开该文件核对） | 200；`item.title == "分段1"` |
| test_get_segment_detail | GET `/palace-segments/{segment_id}` | 200；body 含 `item`、`palace`、`editor_doc` |
| test_update_segment | PUT `/palace-segments/{segment_id}`，body `{"title": "改名"}` | 200；title 更新 |
| test_delete_segment | DELETE `/palace-segments/{segment_id}` | `{"ok": True}`；再 GET 返回 error payload |
| test_segment_missing_branches | GET/PUT/DELETE `/palace-segments/99999` | 均返回 `{"error": "not found"}` |

**versions（TestPalaceVersions 类）**：种子数据需在 `session_factory()` 会话里直接调 `create_palace_version`（从 `memory_anki.modules.backups.application.backup_service` import，与 test_review_routes.py 第 31-37 行同款用法）。

| 用例名 | 请求 | 期望 |
|---|---|---|
| test_list_versions | GET `/palaces/{id}/versions` | 200；`versions` 非空、含 `palace_title` |
| test_version_detail | GET `/palaces/{id}/versions/{version_id}` | 200；detail 非空 |
| test_version_detail_missing | GET `/palaces/{id}/versions/99999` | `{"error": "version not found"}` |
| test_restore_version | POST `/palaces/{id}/restore-version`，body `{"version_id": vid}` | 200 且 `ok is True` |
| test_restore_version_invalid_id | body `{"version_id": 0}` | `{"error": "invalid version id"}` |

**attachments（TestPalaceAttachments 类）**：`ATTACHMENTS_DIR` 是 router 模块级常量（第 11 行 import），用 `monkeypatch.setattr(palace_router, "ATTACHMENTS_DIR", tmp_path)` 指向 pytest `tmp_path`。

| 用例名 | 请求 | 期望 |
|---|---|---|
| test_upload_attachment | POST `/palaces/{id}/upload`，files=`{"file": ("a.txt", b"hello", "text/plain")}` | 200；返回 `id`/`filename`/`original_name`；tmp_path 下文件存在 |
| test_upload_to_missing_palace | POST `/palaces/99999/upload` 同上 | `{"error": "not found"}` |
| test_download_attachment | GET `/attachments/{att_id}` | 200；内容为 `hello` |
| test_delete_attachment | DELETE `/attachments/{att_id}` | `{"ok": True}`；磁盘文件已删除 |
| test_attachment_missing | GET `/attachments/99999` | `{"error": "not found"}` |

**practice session（TestPracticeSession 类）**

| 用例名 | 请求 | 期望 |
|---|---|---|
| test_get_progress_empty | GET `/practice/session/{palace_id}` | 200；`progress` 为空值（以首跑实际返回为准记录） |
| test_upsert_then_get_progress | PUT `/practice/session/{palace_id}`，body `{"progress": {...任意 JSON...}}`（字段以 `session_progress_service.upsert_practice_progress` 为准） | 200；随后 GET 能读回 |
| test_delete_progress | DELETE `/practice/session/{palace_id}` | `{"ok": True}`；GET 回到空值 |
| test_progress_missing_palace | GET/PUT `/practice/session/99999` | `{"error": "not found"}` |

**其余单端点（TestPalaceMisc 类）**：`GET /palaces/{id}/review-plan`（主路径 + missing）、`PUT /palaces/{id}/practice-flag`（needs_practice 置位）、`PUT /palaces/{id}/archive`、`GET /backups`（仅断言 200 且 `items` 是列表——先 `monkeypatch.setattr(palace_router, "list_backups", lambda: [])`，完整生命周期归 10-03）。

- 每批自查点：`python -m pytest tests/test_palace_routes.py -v` 全绿，且 `python -m pytest tests -q` 无既有用例被破坏。

### 明确不要做的事

1. 不要为了让 404 断言"更漂亮"而改 router 返回 HTTPException——按现状断言。
2. 不要在本文件测 mini-palaces 端点（`tests/test_mini_palace_routes.py` 已覆盖）与章节绑定（`test_palace_chapter_binding.py` 已覆盖）。
3. 不要测 `/palaces/{id}/editor/ai-split`（依赖外部 AI，`tests/test_mindmap_ai_split_service.py` 已在 service 层覆盖）。
4. 不要让任何用例写真实磁盘（备份钩子必须保持 no-op，附件目录必须是 tmp_path）。

## 3. 测试验收标准

| 命令 | 期望结果 |
|---|---|
| `cd apps/api && python -m pytest tests/test_palace_routes.py -v` | 全部通过（完整实施后 ≥ 35 passed） |
| `cd apps/api && python -m pytest tests -q` | 全绿，无既有用例回归 |
| `cd apps/api && python -m ruff check tests/test_palace_routes.py` | 0 错误 |

行为验收：故意把 `tests/test_palace_routes.py` 中某个 URL 改错（如 `/palaces` 改 `/palacesX`）→ 对应用例失败，证明测试真的打到路由；改回后全绿。

回归检查：`tests/test_mini_palace_routes.py`、`tests/test_palace_chapter_binding.py`、`tests/test_review_routes.py` 全部保持通过。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；核实 router.py 628 行、无独立测试文件、not-found 分支返回 200+error 的现状 | - |
| 2026-07-09 | Codex | 新增 `apps/api/tests/test_palace_routes.py`，覆盖 CRUD/grouped/editor/segments/versions/attachments/practice session/review-plan/practice-flag/archive/backups 等稳定主路径与 missing/error 分支 | 44 passed；按当前路由现状保留 `/palaces/{id}` missing 的兼容字段断言、editor 根节点标题规范化、archive 固定返回 `archived: false` 行为 |
| 2026-07-09 | Codex | 运行目标测试、相邻回归、全量后端测试与 ruff | `python -m pytest tests/test_palace_routes.py -v` 44 passed；`python -m pytest tests/test_mini_palace_routes.py tests/test_palace_chapter_binding.py tests/test_review_routes.py -q` 73 passed/43 skipped；`python -m pytest tests -q` 347 passed/72 skipped；`python -m ruff check tests/test_palace_routes.py` 通过 |
