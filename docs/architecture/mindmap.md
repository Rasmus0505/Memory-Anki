# 思维导图架构

## 一句话模型

思维导图由“纯文档实体 → 通用画布 → 编辑器运行时 → 显式能力 → 业务宿主”组成。后端由“纯文档模块 → 宫殿/知识聚合保存 → 独立学习投影”组成。

## 前端修改入口

| 需求 | 修改位置 |
|---|---|
| 节点增删改、移动、子树遍历、搜索、审计 | `apps/web/src/entities/mindmap-document` |
| React Flow 布局、拖拽、视口、通用节点外观 | `apps/web/src/shared/ui/mindmap-canvas` |
| 编辑历史、快捷键、全屏、编辑器运行时 | `apps/web/src/features/mindmap-editor` |
| 实体级加载、自动保存、陈旧请求隔离 | `apps/web/src/shared/hooks/useMindMapDocumentSession.ts` 与 `shared/lib/mindmapDocumentSessionModel.ts` |
| 分段、焦点、AI 拆分、迷你宫殿 | `features/palace-edit` 提供业务状态，`pages/create/PalaceEditorPage` 组合编辑器与跨 feature UI |
| 复习揭示、评分、掌握度 | `widgets/mindmap-review-flow` 宿主和 capability 输入 |
| 知识体系导图 | `pages/library/KnowledgeLibraryPage` 宿主 |

`MindMapEditorSurface` 不直接调用业务 API。业务页面通过 `MindMapPersistenceAdapter` 提供加载和保存，通过 `MindMapCapability[]` 提供装饰与动作。

## 后端修改入口

| 需求 | 修改位置 |
|---|---|
| 文档规范化、旧格式兼容、序列化、指纹 | `modules/mindmap_document/api.py` |
| 宫殿导图读写、危险删除、版本、Peg 同步 | `modules/palaces/application/editor_*` |
| 知识导图读写、Chapter 同步 | `modules/knowledge/application/editor_*` |
| 回忆事件、掌握度、人工标签 | `modules/mindmap_learning` |

其他模块只能通过 `memory_anki.modules.mindmap_document.api` 使用纯文档能力，不得导入其内部文件。

## 数据契约

后端继续读取现有 `editor_doc`、`editor_config`、`editor_local_config` 数据库列。HTTP 响应同时提供 canonical `snapshot`：

```text
schemaVersion, document, editorPreferences, localPreferences, language, revision
```

前端优先读取 `snapshot`，旧字段仅作为兼容回退。保存接口接受旧字段，也接受 `{ snapshot, baseRevision }`。

## 新增能力流程

1. 在所属 feature/entity 中定义业务状态和 API 调用；跨 feature 的宿主组合放在 page/widget。
2. 创建一个显式 capability，将业务状态转换为通用 visual 装饰或节点动作。
3. 将 capability 加入宿主的能力数组。
4. 不修改通用画布；只有新增通用渲染原语时才扩展 `MindMapNodeVisual`。
5. 添加 capability 单测和宿主集成测试。

## 禁止事项

- 文档 entity 不依赖 React、React Flow 或业务 feature。
- 通用画布不出现 palace、segment、mastery、review 等业务字段。
- 编辑器运行时不直接访问宫殿、知识或复习 API。
- 后端纯文档模块不依赖 ORM、FastAPI、备份或业务聚合。
- 不重新创建旧 `shared/components/mindmap*` 或 `modules/mindmap/application/editor_state_*`。

## Import preview port

`features/mindmap-import` owns import state and result presentation but receives mind-map preview rendering through `renderMindMapPreview`. Knowledge and Palace hosts provide `MindMapEditorSurface`; the import feature does not import editor feature internals.
