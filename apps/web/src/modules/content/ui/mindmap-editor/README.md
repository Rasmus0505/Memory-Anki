# 脑图编辑器

由宫殿、知识和复习宿主共享的编辑器运行时。

- `MindMapEditorSurface`：仅做编排；没有业务 API 调用。
- `capabilities.ts`：显式的业务装饰和节点操作组合。
- `useMindMapDocumentSession`：在纯会话 reducer 之上的持久化副作用驱动器。
- `documentGraphProjection.ts`：将类型化文档和能力数据转换为通用画布视图模型。
- 通过 `@/modules/content/ui/mindmap-editor` 导入生产 API。
