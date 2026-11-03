# 宫殿波次复习系统设计

**日期：** 2026-07-22  
**状态：** 已实现，2026-07-28 后被单元调度 / FSRS 取代并删除（`wave_service.py`、`wave_policy.py` 等已不存在）；本文为历史设计稿，不得据此重建 Wave 模块。  
**架构：** 写入时波次领域（ReviewWave 作为事实来源；StudySession 作为执行切片）

## 概要

将 FSRS 节点记忆计算与面向用户的复习任务分离。FSRS 拥有 `raw_due_at`；宫殿波次负责聚合、冻结、暂停/恢复、强化和呈现。正式长期波次使用本地日历日；同日强化使用具体的 UTC 时间。

## 决策

1. **波次为主，会话为辅：** 一个正式波次可以跨越多个 StudySession。冻结范围位于 `ReviewWaveItem` 上，并为兼容性镜像到会话摘要中。
2. **大爆炸式交付：** 表、领域、API 和前端一起落地。
3. **兼容性：** `ReviewNodeState.due_at` 仍是现有队列字段所使用的有效正式到期时间；`raw_due_at` 存储 FSRS 建议。
4. **不自动扩展：** 开始时只冻结当前到期+逾期；新的到期需要恢复时显式合并。
5. **弱评分 → 强化波次**（默认 20m/60m），而非正式的短 `due_at` 上限。
6. **首次学习 / 从未复习** 的树节点立即进入正式到期（新宫殿无需校准即可复习）。**内容已变更** 的节点在重新学习或校准之前不进入正式到期。

## 表

- `review_waves`、`review_wave_items`
- `review_calibration_operations`、`review_calibration_operation_items`
- 扩展的 `review_node_states` 列，用于双日期、波次成员资格、练习/直接时钟、schedule_source

## 关键服务

- `wave_policy.py` — 纯安全窗口 / 日期辅助函数
- `wave_service.py` — 吸附、冻结、暂停/恢复/合并/完成、强化
- `calibration_service.py` — 诊断/预览/应用/撤销
- 正式复习生命周期接入波次；`rate_nodes` 在 FSRS 写入后应用波次重新分配

## 不在范围内

- 云端多用户、独立移动应用
- 删除历史完成审计行
