# `/palaces/grouped` 性能实测（A5 调查结论）

> 审计把该端点列为"打开慢"的嫌疑（日志中位 335 ms / p90 1057 ms / >5s 占 5.6%）。
> 本文记录**对真实数据库的实测分解**，用于把优化投到正确的环节。
> 结论：N+1 确实存在，但**不是主因**；主要成本在 due rollup 与目录查询。

## 测量方法

对 `学习数据/memory_palace.db` 的**副本**（197 MB，124 座宫殿）按该端点的真实调用序列
逐段计时，并用 `before_cursor_execute` 统计 SQL 条数。未触碰实时库。

## 结果（124 座宫殿，合计 271 ms）

| 阶段 | 耗时 | 占比 | SQL 条数 |
|---|---:|---:|---:|
| `list_catalog_palaces_by_subject` | 83.6 ms | 31% | 2 |
| `get_explicit_chapter_ids_by_palace` | 0.8 ms | 0.3% | 1 |
| `batch_palace_due_rollups` | **144.2 ms** | **53%** | 1 |
| `build_chapter_grouped_palace_list` | 40.4 ms | 15% | **248** |
| `build_grouped_palace_list` | 2.3 ms | 0.8% | 0 |
| **合计** | **271.3 ms** | | **255** |

该数字与运行日志的中位数（335 ms）同一量级，说明测量具有代表性。

## 修正：N+1 不是主因

248 条 N+1 来自 `palace_summary_json` 对每座宫殿各查一次：

```
124x SELECT chapter_id FROM chapter_palaces WHERE palace_id = ? AND COALESCE(is_explicit,1)=1
124x SELECT palace_segments.id ... WHERE palace_segments.palace_id = ?
```

第一条本可避免：`catalog_router.api_list_grouped` **已经**算好了
`precomputed_explicit_chapter_ids` 并传给 `palace_card_json`，但
`palace_summary_json`（第 233 行）在 `precomputed_explicit_chapter_ids is None` 时才查——
而 `include_heavy_collections` 路径上的另一个调用点（第 319 行）没有传该参数，于是逐条重查。
第二条来自 `list_palace_segments(session, p, ...)`（第 152 行）在 `include_heavy_collections`
为真时逐宫殿调用。

但两者合计只占 40 ms / 271 ms（15%）。**主要成本是 `batch_palace_due_rollups`（144 ms，53%）
与目录查询（84 ms，31%）**——两者都已经是单条批量 SQL，瓶颈在单条查询本身的代价，
而非查询条数。因此"消除 N+1"即使完全成功，也只能带来约 15% 的改善。

## 为什么本轮没有动手

1. **收益与风险不匹配。** 首要项是单条批量查询的内部成本，需要读懂
   `project_palace_review_summaries` 的投影逻辑；只修 15% 的 N+1 而把改动引入
   目录卡片序列化路径（所有宫殿列表页共用），风险高于收益。
2. **该区域正被并发编辑。** 主工作区中这些文件当前处于未提交修改状态：
   `palace-catalog/PalaceListPage.tsx`、`PalaceShelfPage.tsx`、`model/palaceCatalog.ts`、
   `content/presentation/editor_router.py`。在本 worktree 里重写同一片区域会与该工作冲突。
   任务本身也把 A5 标注为"需先与用户确认接手"。
3. **前端已有相关改动在途。** `palaceCatalog.ts` 正在新增
   `publishPalaceKnowledgeBindings`，说明该路径正在被调整。

## 已做的一处修复，以及它为什么不改变结论

`palace_view_resolvers.build_chapter_grouped_palace_list` 逐宫殿调用
`get_palace_explicit_chapter_ids`（纯读，仅经 `_group_chapter_for_subject` 读取），
而同模块早已存在批量版本 `get_explicit_chapter_ids_by_palace`。已改为先批量取一次：

| | chapter_grouped | SQL 条数 | 总计 |
|---|---:|---:|---:|
| 修复前 | 40.4 ms | 248 | 271.3 ms |
| 修复后 | 33.0 ms | **125** | 273.8 ms |

**SQL 条数减少 123 条，但总耗时没有可测量的改善（两次运行的差异在噪声范围内，
甚至略高）。** 这是本次测量最有价值的一条结论：该端点的成本**不是**查询条数，
而是少数几条批量查询自身的代价。因此不要再以"消除 N+1"为目标优化它。

保留该改动的理由是它是纯读、局部、有现成批量函数且测试覆盖充分（54 用例通过、
全后端 846 用例通过）——SQL 条数减少 123 对将来放大规模仍有意义，但它**不是**
性能修复。

## 若要继续，建议的切入顺序

1. 先确认前端是否已通过缓存/分页把该端点移出首屏关键路径（若已移出，后端优化的优先级下降）。
2. 对 `batch_palace_due_rollups`（144 ms，53%）那条批量查询做 `EXPLAIN QUERY PLAN`，
   看它走了什么索引。**这是单项收益最大的位置。**
3. `list_catalog_palaces_by_subject`（84 ms，31%）次之。
4. 最后才考虑逐宫殿 `list_palace_segments`（`palace_serializer` 第 152 行，
   `include_heavy_collections` 为真时触发）——按上表结论，它的收益很可能是噪声级的。
