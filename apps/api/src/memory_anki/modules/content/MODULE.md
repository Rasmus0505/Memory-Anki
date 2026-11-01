# 模块：content

## 状态
活跃 —— 拥有当前的宫殿和知识文档契约。

## 负责
宫殿文档、知识树、编辑器状态、附件

## 迁移自
- palaces（文档/编辑器/树/附件）
- knowledge
- mindmap_document

## 禁止
不得导入 memory/FSRS；不涉及复习排期

## 公共接口
- `public/commands.py` — 写意图
- `public/queries.py` — 读意图

## 跨模块规则
只导入 `memory_anki.modules.content.public`。绝不要导入另一个模块的 application/infrastructure/presentation。
