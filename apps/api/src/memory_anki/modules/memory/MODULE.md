# 模块：memory

## 状态
已迁移 —— 永久标记单元排期是唯一的宫殿复习运行时。

## 负责
- 永久标记单元状态与拓扑对账
- 固定阶梯排期与本地日到期日期
- 复习会话、encounter、原子修订、关闭锁定和撤销

## 已退役
- 节点评分与节点 FSRS 状态
- 波次、校准、聚合、每日计划和临时标记

## 禁止
不得导入宫殿应用内部实现；通过 content.public 读取树

## 公共接口
- `public/commands.py` — 写意图
- `public/queries.py` — 读意图

## 跨模块规则
只导入 `memory_anki.modules.memory.public`。绝不要导入另一个模块的 application/infrastructure/presentation。
