# 目标垂直切片架构（7.22-refactor-optimize）

## 状态
后端包归属已迁移：content / memory / quiz / practice / produce / session。
前端 FSD features/entities 已并入 apps/web/src/modules/*。

## 后端模块
| 模块 | 负责 |
|---|---|
| content | 宫殿文档、知识绑定、编辑器状态 |
| memory | FSRS、波次、评分、到期汇总 |
| quiz | 题目、生成、绑定 |
| practice | 随心信息流/队列 + 正式复习组合表面 |
| produce | 脑图导入任务、AI 拆分、导入路由 |
| session | 学习会话、进度、计时 |
| english | 英语轨道 |
| settings / dashboard / search / backups | 支撑上下文 |

`english_reading` 和 `ai_learning` 已退役；历史数据与归档文档保留，不是现行模块。

## 公共导入规则
跨上下文代码只能导入公共条目（`modules.<id>.public` 或 `modules.<id>.api`）。
不要导入另一个上下文的 application/infrastructure/presentation。

## 前端
`apps/web/src/modules/<id>/public.ts` 是跨模块入口。UI 位于 `modules/<id>/ui` 下。

## 平台
- platform.events 事件总线
- platform.jobs 任务注册表脚手架
- 现有 UoW / AiRuntime / mutations
