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
| 学习组、焦点、AI 拆分 | `features/palace-edit` 提供业务状态，`pages/create/PalaceEditorPage` 组合编辑器与跨 feature UI |
| 图片/PDF 导入、任务历史、预览应用 | `features/mindmap-import`，服务端任务通过 `entities/knowledge-import/api` 访问 |
| 复习揭示、评分、掌握度 | `widgets/mindmap-review-flow` 宿主和 capability 输入 |
| 知识体系导图 | `pages/library/KnowledgeLibraryPage` 宿主 |

`MindMapEditorSurface` 不直接调用业务 API。业务页面通过 `MindMapPersistenceAdapter` 提供加载和保存，通过 `MindMapCapability[]` 提供装饰与动作。


## 学习组统一边界

- 学习组是宫殿局部范围的唯一业务概念，允许多个显式学习组包含同一节点；默认学习组仅投影未被任何显式学习组覆盖的节点。
- `PalaceEditorPage` 负责进入选点状态；普通节点点击切换整棵子树，`MindMapEditorSurface` 只接收通用 `segmentRangeDraft` 装饰和工具栏内容，不感知宫殿业务。
- 学习组训练统一使用 `/segments/{id}/practice` 与 `segment-checkpoint` 揭示模式。节点掌握度全局共享，揭示状态、完成状态和续练进度按 `palace_segment_id` 独立保存。
- 题目通过 `segment_ids: number[]` 与学习组多对多关联；题目正文和答题统计只有一份，不为学习组复制题目。
- 迷你宫殿功能、路由、API 和前端类型已经退役，不得重新创建 `features/mini-palace`、`entities/mini-palace` 或 mini practice 路由。

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

## 图片与 PDF 导入边界

- 新图片任务统一使用 `image-batch`；一张和多张图片都先进入可排序、可删除的图片队列，再由用户显式开始识别。`image-single` 只用于兼容读取旧历史。
- PDF 资料库是全局运行时资料，元数据保存于 `pdf_documents`，文件保存于 `%LOCALAPPDATA%\MemoryAnki\pdf_library` 或 `MEMORY_ANKI_HOME/pdf_library`。业务数据库只保存相对文件标识，不保存设备绝对路径。
- PDF 导入只接受显式页码选择。任务创建时将选中页渲染为任务输入，并把原 PDF 复制为 `import_jobs/{operation_id}/source.pdf`；资料库文件后续删除不会破坏既有任务预览和复跑。
- 所有新任务携带稳定 `owner_id/entity_key` 和唯一 `operation_id`。复跑创建新的 operation 并复制来源工件，不覆盖旧任务。
- AI 结果先进入导入预览。覆盖当前导图、追加到选中节点和写入文本均由宿主显式确认；后台任务不得直接修改正式导图。
