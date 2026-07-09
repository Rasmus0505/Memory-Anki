---
编号: 10-04
标题: 为 modules/persistence/application/idempotency.py（67 行，零测试）新建单元 + 路由级幂等测试
类型: 新增
范围: 功能
优先级: P1（应该）
预估工作量: S（<2h）
依赖文档: 10-01（conftest 的 fixture）
状态: 未开始
负责代理: 无
完成时间: 无
---

# 10-04 persistence 幂等测试补全

## 1. 原始需求

`apps/api/src/memory_anki/modules/persistence/application/idempotency.py`（67 行）实现了写请求幂等机制：读取请求头 `X-Memory-Anki-Mutation-ID`，把响应以 `api_mutation.<id>` 为 key 存入 Config 表，重复请求直接返回缓存响应。该机制是前端离线队列重放（`apps/web/src/shared/api/http.ts` 对所有写请求注入该头）不产生重复副作用的**唯一防线**，但目前没有任何直接测试——`rg -l "idempot" apps/api/tests` 只命中 `test_review_routes.py`/`test_palace_quiz_routes.py` 的间接使用。生产调用方为 `modules/reviews/presentation/router.py` 的 `POST /review/session/{schedule_id}/submit`（187、217 行）。

目标：新建 `apps/api/tests/test_idempotency.py`，单元层覆盖 read/get/save 三个函数，路由层覆盖"同 mutation ID 重复 POST 返回缓存响应、不同 ID 正常执行、无头正常执行"。

## 2. 详细执行清单

> 禁止事项：不许修改 `idempotency.py` 或 reviews router；不许删既有断言；不要把测试写进 `test_review_routes.py`（那个文件正等着 10-10 拆分，不要再增肥）。

### 步骤 1：新建 `apps/api/tests/test_idempotency.py`

依赖 10-01 的 `db_session`、`make_client`、`session_factory` fixture。完整文件内容：

```python
"""persistence 幂等机制（idempotency.py）单元与路由级测试。"""
import json
from datetime import UTC, date, datetime, timedelta

import pytest

from memory_anki.infrastructure.db.models import Config, Palace, ReviewLog, ReviewSchedule
from memory_anki.modules.persistence.application.idempotency import (
    MUTATION_ID_HEADER,
    get_idempotent_response,
    read_mutation_id,
    save_idempotent_response,
)
from memory_anki.modules.reviews.presentation import router as review_router


class FakeRequest:
    """只提供 headers 的最小 Request 替身（read_mutation_id 只读 headers）。"""

    def __init__(self, headers: dict[str, str]):
        self.headers = headers


class TestReadMutationId:
    def test_none_request_returns_none(self):
        assert read_mutation_id(None) is None

    def test_missing_header_returns_none(self):
        assert read_mutation_id(FakeRequest({})) is None

    def test_blank_header_returns_none(self):
        assert read_mutation_id(FakeRequest({MUTATION_ID_HEADER: "   "})) is None

    def test_overlong_header_returns_none(self):
        assert read_mutation_id(FakeRequest({MUTATION_ID_HEADER: "x" * 81})) is None

    def test_valid_header_is_stripped(self):
        assert read_mutation_id(FakeRequest({MUTATION_ID_HEADER: " abc "})) == "abc"


class TestSaveAndGet:
    def test_roundtrip(self, db_session):
        request = FakeRequest({MUTATION_ID_HEADER: "mut-1"})
        save_idempotent_response(db_session, request, {"ok": True, "score": 3})
        assert get_idempotent_response(db_session, request) == {"ok": True, "score": 3}

    def test_no_header_saves_nothing(self, db_session):
        save_idempotent_response(db_session, FakeRequest({}), {"ok": True})
        assert db_session.query(Config).count() == 0

    def test_get_without_saved_row_returns_none(self, db_session):
        assert get_idempotent_response(
            db_session, FakeRequest({MUTATION_ID_HEADER: "unknown"})
        ) is None

    def test_corrupt_stored_json_returns_none(self, db_session):
        db_session.add(Config(key="api_mutation.bad", value="{not json"))
        db_session.commit()
        assert get_idempotent_response(
            db_session, FakeRequest({MUTATION_ID_HEADER: "bad"})
        ) is None

    def test_save_overwrites_existing_row(self, db_session):
        request = FakeRequest({MUTATION_ID_HEADER: "mut-2"})
        save_idempotent_response(db_session, request, {"v": 1})
        save_idempotent_response(db_session, request, {"v": 2})
        assert get_idempotent_response(db_session, request) == {"v": 2}
        assert db_session.query(Config).filter(
            Config.key.like("api_mutation.%")
        ).count() == 1


def _seed_schedule(session_factory) -> int:
    """造一个到期的复习排程，返回 schedule_id。"""
    with session_factory() as session:
        palace = Palace(
            title="幂等测试宫殿",
            description="",
            editor_doc=json.dumps(
                {"root": {"data": {"text": "幂等测试宫殿"}, "children": []}}
            ),
        )
        session.add(palace)
        session.flush()
        schedule = ReviewSchedule(
            palace_id=palace.id,
            scheduled_date=date.today() - timedelta(days=1),
            interval_days=1,
            algorithm_used="ebbinghaus",
            completed=False,
            review_number=0,
            review_type="standard",
        )
        session.add(schedule)
        session.commit()
        return schedule.id


class TestSubmitRouteIdempotency:
    @pytest.fixture()
    def client(self, make_client):
        return make_client(review_router)

    def test_duplicate_mutation_id_returns_cached_response_without_second_log(
        self, client, session_factory
    ):
        schedule_id = _seed_schedule(session_factory)
        headers = {MUTATION_ID_HEADER: "dup-1"}
        body = {"duration_seconds": 10, "completion_mode": "manual_complete"}

        first = client.post(
            f"/api/v1/review/session/{schedule_id}/submit", json=body, headers=headers
        )
        assert first.status_code == 200
        second = client.post(
            f"/api/v1/review/session/{schedule_id}/submit", json=body, headers=headers
        )
        assert second.status_code == 200
        assert second.json() == first.json()

        with session_factory() as session:
            assert session.query(ReviewLog).count() == 1  # 副作用只发生一次

    def test_different_mutation_ids_execute_independently(
        self, client, session_factory
    ):
        schedule_id = _seed_schedule(session_factory)
        body = {"duration_seconds": 10, "completion_mode": "manual_complete"}
        first = client.post(
            f"/api/v1/review/session/{schedule_id}/submit",
            json=body,
            headers={MUTATION_ID_HEADER: "id-a"},
        )
        assert first.status_code == 200
        # 第二次换 ID 真实执行：排程已完成，submit_review 返回空 log → 404
        second = client.post(
            f"/api/v1/review/session/{schedule_id}/submit",
            json=body,
            headers={MUTATION_ID_HEADER: "id-b"},
        )
        assert second.status_code != 200 or second.json() != first.json()

    def test_no_header_executes_normally(self, client, session_factory):
        schedule_id = _seed_schedule(session_factory)
        response = client.post(
            f"/api/v1/review/session/{schedule_id}/submit",
            json={"duration_seconds": 5, "completion_mode": "manual_complete"},
        )
        assert response.status_code == 200
        assert response.json()["ok"] is True
```

执行提示：

- `test_different_mutation_ids_execute_independently` 的第二次提交行为取决于 `submit_review` 对已完成排程的处理（可能 404、也可能推进到下一复习号）。首跑后按真实行为把断言写死为具体状态码/字段，**不许**保留弱断言 `!=` 交差——上面的写法只是首跑探针。
- 若 `Palace` 模型必填字段与上面種子不符（如 `difficulty`、`review_mode`），参照 `tests/test_review_routes.py` 79-111 行的种子代码补齐字段。

### 步骤 2：收紧探针断言

首跑 `python -m pytest tests/test_idempotency.py -v` 后，把步骤 1 中标注的两处探针断言替换为具体值，再跑一遍全绿。

## 3. 测试验收标准

| 命令 | 期望结果 |
|---|---|
| `cd apps/api && python -m pytest tests/test_idempotency.py -v` | 13 passed（5 单元 + 5 存取 + 3 路由） |
| `cd apps/api && python -m pytest tests -q` | 全绿 |
| `cd apps/api && python -m ruff check tests/test_idempotency.py` | 0 错误 |

行为验收：临时把 `test_duplicate_mutation_id_...` 中第二次 POST 的 header 值改成别的 → `ReviewLog.count()==1` 断言失败（说明测试真的在验证幂等而非凑数），改回后全绿。

回归检查：`tests/test_review_routes.py` 中既有 submit 相关用例全部保持通过。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| 2026-07-08 | 文档代理（fable） | 文档创建；核实 idempotency.py 67 行零直测、生产调用方仅 reviews router submit 端点（187/217 行） | - |
