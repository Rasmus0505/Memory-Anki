---
编号: 02-08
标题: 修复 knowledge 章节面包屑逐级查询与宫殿列表接口的 N+1 查询
类型: 优化
范围: 架构
优先级: P1
预估工作量: M
依赖文档: 无
状态: 未开始
负责代理: 无
完成时间: 无
---

# 02-08 修复 knowledge 面包屑与宫殿列表 N+1 查询

## 1. 原始需求

两处已核实的 N+1 热点：

1. **章节详情面包屑**：`modules/knowledge/presentation/router.py` `get_chapter`（第 169–201 行）——第 183–191 行用 while 循环沿 `parent_id` 逐级 `s.query(Chapter).filter_by(id=cur_id).first()`，树有多深就查多少次；同函数里 `chapter_json` 递归（第 41–52 行）对每个子章节 lazy load `c.children` 与 `c.palaces`，`palace_out` 再对每个宫殿 lazy load `p.pegs`。
2. **宫殿列表**：`modules/palaces/presentation/router.py` `GET /palaces`（第 112–114 行）对每个宫殿调 `palace_json(p, s)`。仓储层 `palace_repository.py` 的 `list_palaces`（第 46–50 行）已配好 selectinload 预加载（`_detail_loader_options`，第 30–35 行），**关系加载不是问题**；真正的每宫殿额外查询在 `palace_serializer.py` `palace_json`（第 72–169 行）内部：第 75 行 `reconcile_palace_chapter_binding(session, p)`、第 76 行 `get_palace_explicit_chapter_ids(session, p)`（`palace_chapter_binding.py` 第 14–26 行，对 `chapter_palaces` 表发一条裸 SQL——**每个宫殿一条**）、第 88 行 `palace_stage_progress` 与第 102 行 `get_algorithm_stage_labels`（每宫殿各查一次 config 间隔配置）。宫殿到三位数后列表接口发出数百条 SQL。

目标：面包屑与子树改为一次性查询；宫殿列表的 explicit-chapter-ids 改为一条 IN 查询批量取，间隔配置每请求只查一次。

## 2. 详细执行清单

> 硬约束：只做查询层优化，任何响应 JSON 的键与值不得变化（改前改后各抓一次响应做 diff）。不要动 `reconcile_palace_chapter_binding` 的语义（它可能修正绑定数据，属于业务行为）；不要改仓储的 loader options（已是预加载）；不要顺手加分页（03-02 的事）。

### 第一部分：knowledge 面包屑（独立可先做）

**步骤 1.1**：打开 `modules/knowledge/presentation/router.py`（若 02-05 已执行则在 `knowledge_service.get_chapter_detail` 中做，位置以实际为准），把 `get_chapter` 改为一次性取出该学科全部章节后内存寻路：

```python
# 修改前（183–191 行）
    breadcrumbs: list[dict[str, int | str]] = []
    cur_id = c.parent_id
    while cur_id:
        parent = s.query(Chapter).filter_by(id=cur_id).first()
        if parent:
            breadcrumbs.insert(0, {"id": parent.id, "name": parent.name})
            cur_id = parent.parent_id
        else:
            break

# 修改后
    chapters_by_id = {
        row.id: row
        for row in s.query(Chapter.id, Chapter.parent_id, Chapter.name)
        .filter(Chapter.subject_id == c.subject_id)
        .all()
    }
    breadcrumbs: list[dict[str, int | str]] = []
    cur_id = c.parent_id
    seen: set[int] = set()
    while cur_id and cur_id in chapters_by_id and cur_id not in seen:
        seen.add(cur_id)
        parent = chapters_by_id[cur_id]
        breadcrumbs.insert(0, {"id": parent.id, "name": parent.name})
        cur_id = parent.parent_id
```

（`seen` 集合防脏数据成环死循环，行为上是纯加固。）

**步骤 1.2**：给章节主查询加预加载，消除 `chapter_json` 递归与 `palace_out` 的 lazy load。第 172 行：

```python
# 修改前
    c = s.query(Chapter).filter_by(id=chapter_id).first()
# 修改后
    from sqlalchemy.orm import selectinload
    c = (
        s.query(Chapter)
        .options(
            selectinload(Chapter.children).selectinload(Chapter.children),
            selectinload(Chapter.children).selectinload(Chapter.palaces),
            selectinload(Chapter.palaces).selectinload(Palace.pegs),
            selectinload(Chapter.subject),
        )
        .filter_by(id=chapter_id)
        .first()
    )
```

（selectinload 的 import 放文件顶部。执行前打开 `infrastructure/db/_tables/knowledge.py` 核实 `Chapter.children`/`Chapter.palaces` 关系属性名与是否已有 lazy 配置，以真实模型为准；`chapter_json` 递归深度超过两层时第三层以下仍会 lazy load，属可接受的长尾。）

自查点：临时在 `_base.py` engine 上开 `echo=True`（或用 `logging.getLogger('sqlalchemy.engine')`）请求一次 `GET /api/v1/chapters/{深层章节id}`，SQL 条数从"层数+子章节数"级降到 ≤6 条；**验证完关掉 echo**。`python -m pytest tests/test_palace_chapter_binding.py -q` 通过。

### 第二部分：宫殿列表批量取 explicit ids

**步骤 2.1**：在 `modules/palaces/application/palace_chapter_binding.py` 的 `get_palace_explicit_chapter_ids`（第 14–26 行）旁新增批量版本：

```python
def get_explicit_chapter_ids_by_palace(
    session: Session, palace_ids: list[int]
) -> dict[int, set[int]]:
    """一条 SQL 批量取多宫殿的显式章节绑定，键为 palace_id。"""
    if not palace_ids:
        return {}
    rows = session.execute(
        text(
            """
            SELECT palace_id, chapter_id
            FROM chapter_palaces
            WHERE palace_id IN :palace_ids
              AND COALESCE(is_explicit, 1) = 1
            """
        ).bindparams(bindparam("palace_ids", expanding=True)),
        {"palace_ids": list(palace_ids)},
    ).fetchall()
    result: dict[int, set[int]] = {pid: set() for pid in palace_ids}
    for palace_id, chapter_id in rows:
        if chapter_id is not None:
            result.setdefault(int(palace_id), set()).add(int(chapter_id))
    return result
```

（`bindparam` 从 `sqlalchemy` import。）同时在门面 `title_sync_service.py` 的 re-export 列表中补上该函数（第 5–17 行 import 块与 `__all__`）。

**步骤 2.2**：给序列化器加"预取值"旁路。`modules/palaces/application/palace_serializer.py` 中 `palace_json`（72 行）、`palace_summary_json`（172 行）、`palace_card_json`（261 行）各加一个仅限关键字参数，默认 None 时行为不变：

```python
# 修改前（palace_json 开头，73–76 行）
def palace_json(p, session: Session | None = None) -> dict:
    explicit_chapter_ids: set[int] = set()
    if session is not None:
        reconcile_palace_chapter_binding(session, p)
        explicit_chapter_ids = get_palace_explicit_chapter_ids(session, p)

# 修改后
def palace_json(
    p,
    session: Session | None = None,
    *,
    precomputed_explicit_chapter_ids: set[int] | None = None,
) -> dict:
    explicit_chapter_ids: set[int] = set()
    if session is not None:
        reconcile_palace_chapter_binding(session, p)
        if precomputed_explicit_chapter_ids is not None:
            explicit_chapter_ids = precomputed_explicit_chapter_ids
        else:
            explicit_chapter_ids = get_palace_explicit_chapter_ids(session, p)
```

（`palace_card_json` 内部第 266 行还会再查一次 explicit ids，也走同一参数。）

**步骤 2.3**：改 `GET /palaces` 路由（`palaces/presentation/router.py` 第 112–114 行）：

```python
# 修改前
@router.get("/palaces")
def api_list(search: str = "", s: Session = Depends(session_dep)):
    return [palace_json(p, s) for p in list_palaces(s, search)]

# 修改后
@router.get("/palaces")
def api_list(search: str = "", s: Session = Depends(session_dep)):
    palaces = list_palaces(s, search)
    explicit_map = get_explicit_chapter_ids_by_palace(s, [p.id for p in palaces])
    return [
        palace_json(p, s, precomputed_explicit_chapter_ids=explicit_map.get(p.id, set()))
        for p in palaces
    ]
```

`GET /palaces/grouped`（117 行）与 `/palaces/grouped-summary`（129 行）使用 `palace_card_json`/`palace_summary_json` 回调，用同样方式：先批量取 map，再把回调改为 `lambda p, sess: palace_card_json(p, sess, precomputed_explicit_chapter_ids=explicit_map.get(p.id, set()))`。

自查点：`GET /api/v1/palaces` 响应 JSON 与改前 diff 为空；SQL echo 下 `chapter_palaces` 相关查询从 N 条降为 1 条。

**步骤 2.4（可选，先测量再做）**：`get_algorithm_stage_labels`（`reviews/application/schedule_service.py` 第 82 行）每宫殿查一次间隔配置。若测量确认它仍是剩余大头，给 `palace_json` 再加 `precomputed_stage_labels: dict[str, list[str]] | None` 参数，在路由层按算法名预取一次（列表页所有宫殿基本同算法）。不确定就不做，把测量数据记进第 4 节进度表。

### 通用注意

不要改 `reconcile_palace_chapter_binding` 每宫殿执行的现状——它有写修复语义（`GET /palaces/subjects` 第 144–145 行也显式逐宫殿调用），去掉属于行为变更，超出本文档范围。

## 3. 测试验收标准

```
cd apps/api && python -m pytest                  # 期望：全部通过
cd apps/api && python -m ruff check src tests    # 期望：0 错误
cd apps/api && python -m mypy                    # 期望：不多于基线错误
python tools/check_architecture.py               # 期望：passed
```

行为验收：

- 响应等价：`GET /palaces`、`GET /palaces/grouped`、`GET /palaces/grouped-summary`、`GET /chapters/{id}` 四接口改前后响应 JSON diff 为空（含 `is_explicit` 标记）。
- 性能：在真实数据库上用 SQL echo 或 `EXPLAIN` 计数——宫殿列表接口 SQL 条数不随宫殿数线性增长（chapter_palaces 项）；章节详情 SQL 条数不随树深线性增长。可把改前/改后计数记录到进度表。
- 前端宫殿列表页、书架页、章节详情页显示与操作正常。

回归检查：

- `tests/test_palace_chapter_binding.py`（explicit 绑定语义）与 `tests/test_review_routes.py`（palace_json 被 reviews 路由复用）必须全绿。
- 单宫殿详情 `GET /palaces/{id}`（未传预取参数的路径）行为不变。
- 空列表、无绑定章节宫殿的 `is_explicit` 输出与改前一致（批量函数对无行宫殿返回空 set）。

## 4. 进度记录（交接用）

| 时间 | 执行者 | 动作 | 结果/备注 |
|---|---|---|---|
| - | - | 文档创建 | 核实：面包屑逐级查询在 183–191 行（描述 169–201 为整个函数范围，吻合）；宫殿列表 N+1 主因是 palace_json 内部每宫殿的 chapter_palaces 裸 SQL 与 config 查询，而非关系 lazy load（仓储已 selectinload，与描述"palace_serializer.py 329 行内部再查询"的行数指文件总行数 329 吻合） |
