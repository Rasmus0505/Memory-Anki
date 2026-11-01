# 模块：practice

## 状态
活跃 —— memory、content、quiz 和 session 契约的消费者。

## 负责
沉浸式随心队列、正式复习会话 UX 编排

## 迁移自
- 随心（队列/信息流）
- 正式复习编排（不涉及排期数学）

## 禁止
禁止直接使用 ORM；仅组合 content/memory/quiz/session 的公共接口

Practice 不得拆分永久标记拓扑、持久化复习进度，或将单元身份附加到测验/Anki 卡片上。

## 公共接口
- `api.py` — 面向跨上下文调用者的队列门面

## 跨模块规则
只导入 `memory_anki.modules.practice.api`。绝不要导入另一个模块的 application/infrastructure/presentation。
