# Progression（成长数据层，后端）

后端 context `progression` 把已记录的学习证据换算为 XP、等级、每日委托与印章。它是**只读投影**：没有表、不写入、两台设备结果一致，并可回算历史。

**当前前端不展示**：等级、XP、委托、印章、`/growth` 页面和外观奖励均已从 `apps/web` 移除（`/growth` 旧地址转到 `/dashboard`）。
后端规则与接口保持不变，供将来恢复界面或做数据分析使用。

## 后端

`GET /api/v1/progression/overview` → `modules/progression/application/overview_service.py`。
`apps/web/src/shared/api/contracts/progression.ts` 仍保留类型契约，但没有界面消费它。

- 证据来源：有效的 `review_unit_rating_operations`（未撤销、未被替换，经 encounter 关联 `round_id`）、`quiz_attempt_events`、未删除的 `study_sessions.effective_seconds`。日和小时按本地墙上时间计算。
- 星级倍率来自 `exam.api.build_memory_snapshot`（已注册依赖 `progression → exam`）。概览 payload 仍包含该快照，界面不渲染。
- 领域规则（`domain/`，框架无关）：
  - `rules.py`：每次评分 XP `{1:4, 2:8, 3:12, 4:14}` × 星级倍率 `{1:1, 2:1.25, 3:1.6}`；攻克（末次评分为忘记，现已 ≥ 记得）每单元每天 +15；首次通过 +8；测验答对 8 / 作答 3；专注每分钟 1 XP，单次会话封顶 120；同一卡片或题目同日递减 1 → 0.5 → 0.25 → 0.1。等级曲线 `150 × (L−1)^1.9`。
  - `quests.py`：每日 3 个 + 每周 1 个委托，由日期的 sha256 选取，同一指标不重复。日委托 +30，周委托 +150，完成当天入账。未完成的委托过期，不累积。
  - `stamps.py`：基于只增不减的计数器（评分、学习日、攻克、三星通过、测验、满分轮次、夜间/黎明/长时段、委托、等级），印章不会失效。`unlocked_on` 为计数器越过目标的那一天。
- 不做：XP 扣减、连续天数断档惩罚、排行榜。

## 前端（当前状态）

| 项 | 状态 |
|---|---|
| `modules/progression` | 已删除 |
| 随心页顶部等级环 / 每日委托数 | 已删除 |
| 轮次结算中的 XP / 升级 / 印章演出 | 已删除 |
| `growth_state` 字段 | 仍在 profile 契约与后端白名单中保留，界面无使用 |
| 主题外观解锁与开箱 | 已删除，见 [theme-packs.md](./theme-packs.md) |

如需恢复界面，应新建前端模块并在 `docs/architecture/context-map.yaml` 的 `frontendModules` 中登记，而不是复用旧的 `ceremony` / `cosmetics` 设计。
