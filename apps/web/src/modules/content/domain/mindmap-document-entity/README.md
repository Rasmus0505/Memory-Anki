# 脑图文档实体

由宫殿、知识和复习宿主共享的纯文档模型。

- 负责文档类型、规范化、原生传输文件解析、节点命令、选择器、子树遍历、搜索和审计。
- 不得导入 React、React Flow、features、palace、knowledge、review 或持久化 API。
- UI 代码通过 `@/modules/content/domain/mindmap-document-entity` 消费此实体。
- 业务装饰和操作属于显式的编辑器能力。
