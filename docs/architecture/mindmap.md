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

## 展示策略

- `MindMapPresentationMachine` 明确区分 `nativeFullscreen` 与 `viewportFullscreen`，原生 Fullscreen API 被拒绝时只能进入 viewport 模式，不得继续上报为系统全屏。
- `MindMapEditorSurface` 接受 `presentationStrategy`：桌面默认 `native-preferred`，已安装 PWA 默认 `viewport-only`。业务宿主只组合按钮和文案，不直接操作浏览器全屏、滚动锁或视口监听。
- `PresentationPort` 继续拥有 Fullscreen API、`visualViewport`、页面滚动锁、Escape 和布局调度。viewport 模式使用稳定画布宿主覆盖应用外壳，并由 CSS safe-area inset 保护交互控件。
- Electron 保留现有网页内沉浸与系统全屏入口；PWA 只暴露一个“全屏”入口，其产品语义是占满可用视觉视口，不承诺隐藏 iOS 系统状态栏或 Home Indicator。

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

## 浮层启动协调

- 从 `DropdownMenu` 打开的 Dialog/Drawer 必须由共享 `useDropdownMenuActionCoordinator` 协调：菜单先受控关闭，浮层动作在关闭提交后执行。
- 业务页面只声明动作语义 `opensOverlay: true`，不得使用 `setTimeout`、`queueMicrotask` 或页面级焦点补丁处理 Radix 菜单与浮层竞态。
- 可最小化的业务入口浮层应使用稳定 `floatingId`；需要每次显式打开完整窗口时使用 `expandOnOpen`，避免持久化胶囊状态让入口看似失效。
- 需要持续与背景内容交互的非模态工作台应设置 `dismissOnInteractOutside={false}`，只通过显式关闭按钮或 Escape 退出；焦点归还和背景点击不得改变业务 open 状态。

## 图片与 PDF 导入边界

- 新图片任务统一使用 `image-batch`；一张和多张图片都先进入可排序、可删除的图片队列，再由用户显式开始识别。`image-single` 只用于兼容读取旧历史。
- PDF 资料库是全局运行时资料，元数据保存于 `pdf_documents`，文件保存于 `%LOCALAPPDATA%\MemoryAnki\pdf_library` 或 `MEMORY_ANKI_HOME/pdf_library`。业务数据库只保存相对文件标识，不保存设备绝对路径。
- PDF 导入只接受显式页码选择。任务创建时将选中页渲染为任务输入，并把原 PDF 复制为 `import_jobs/{operation_id}/source.pdf`；资料库文件后续删除不会破坏既有任务预览和复跑。
- 所有新任务携带稳定 `owner_id/entity_key` 和唯一 `operation_id`。复跑创建新的 operation 并复制来源工件，不覆盖旧任务。
- AI 结果先进入导入预览。覆盖当前导图、追加到选中节点和写入文本均由宿主显式确认；后台任务不得直接修改正式导图。

## 视觉直出与 OCR 回退

- 普通 PDF/多图使用 `ai_prompt_import_document_mindmap`，视觉模型根据全部正文页面的标题、编号、段落和并列关系直接生成脑图；不得默认把第一张图当作结构图。
- 用户显式指定结构图时使用独立场景 `vision_structure_mindmap` 和 `ai_prompt_import_batch_mindmap`，结构补全提示词不得进入普通正文流程。
- 视觉模型目录公开 `vision_processing_role`：通用 VL 为 `direct_generation`，`qwen3.5-ocr` 与 `qwen-vl-ocr` 为 `ocr_extraction`。
- 通用 VL 仅在流完整、JSON 可解析、根标题非空、节点 Schema 合法且至少有一个内容节点时直接进入预览；协议错误、网络中断、`finish_reason=length`、JSON 或 Schema 错误触发逐页 OCR 与文本模型整理。
- OCR 按页保存到 `ocr/page-<页码>.txt`，成功页可恢复复用；同时保存 `vision_response.txt`、`ocr_combined.txt`、`formatter_response.txt` 和 `final_tree.json`。
- 任务保存 `vision_ai_runtime` 与 `formatter_ai_runtime`，读取时兼容旧 `ai_runtime`；同一 `owner_id/operation_id` 贯穿视觉、OCR、整理和预览阶段。
- 识别结果只写入任务预览。用户点击“应用到宫殿”后才一次性保存正式导图；OCR 重整与视觉重试均创建新的 operation，不覆盖历史任务。
## AI 分卡替换边界

- 脑图编辑页通过 capability 提供统一的“AI 分卡”；由模型自行判断并列或层级结构。根节点、只读模式和练习模式不开放替换式分卡。
- 替换式分卡只处理无子节点的长内容卡片。旧请求仍保留原有“新增一级分类并重挂旧子节点”兼容流程，不自动迁移复杂子树。
- 请求携带 `owner_id=palace:<id>`、唯一 `operation_id` 和 `split_mode`（默认 `auto`；`parallel`/`hierarchy` 为兼容别名）。服务端验证所属宫殿，前端只应用身份完全匹配的响应。
- 服务端在父级 `children` 的原索引执行一次切片替换（删除原卡并插入新卡），目标前后的兄弟顺序保持不变；新 UID 由 operation 和树路径确定生成。
- 统一场景 `ai_split` 使用保真、结构自判、样例对照、原位边界和 `replacement_nodes` JSON 块；允许最多四层、节点总量受服务端限制；叶子尽量保留原句，禁止总结删减。


## 统一文档工作区与宫殿学科标签

- 全站思维导图继续使用同一套 `MindMapEditorSurface`、`MindMapPageToolbar` 和 `useMindMapDocumentSession`。宫殿文档与学科文档是独立持久化文档，不得合并数据库内容。
- 宫殿编辑页通过单工作区标签在宫殿文档和显式归属的学科文档之间切换，同一时刻只挂载一个可编辑画布。切换文档前必须提交当前文档待保存状态。
- 学科文档在宫殿宿主中仍由 Knowledge API 读写；Palace 只注入章节关联 capability，并拥有宫殿—学科、宫殿—章节的一致性命令。
- `PalaceKnowledgeOutlinePanel`、`PalaceChapterPanel` 和页面自行推导“第一个学科”的实现已经退役，不得重建。

## Node identity and memory state

A palace document has one stable node UID per node. Reviews indexes memory state by `palace_id + node_uid`; all non-root nodes are independent FSRS cards. Text or note changes invalidate the content fingerprint and reset only that node, while movement, style, and layout changes preserve the card. New nodes immediately join the progress denominator; deleted nodes stop scheduling while historical evidence remains.
