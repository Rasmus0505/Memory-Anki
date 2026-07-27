// 桶文件只保留轻量运行时导出：重组件（TreeRenderer/MindMapContainer/
// MindMapWorkspace/nodeTypes/NodeContextMenu/adapter 运行时函数）没有外部
// 消费者，且会把 @xyflow 静态拖进所有 import 本桶的模块，需要时从子路径引入。
export { MindMapCanvas } from './MindMapCanvasLazy'
export type {
  MindMapCanvasProps,
  MindMapCanvasViewCommand,
  MindMapContentChangeViewportPolicy,
  MindMapMobileViewPolicy,
  MindMapNodeClickViewportPolicy,
} from './MindMapCanvas'
export type { TreeRendererProps, TreeRenderMeta } from './TreeRenderer'
export type { MindMapContainerProps, ViewMode } from './MindMapContainer'
export type { ContextMenuAction } from './NodeContextMenu'
export type { MindMapNode, MindMapEdge, GraphData, TreeNodeLike, MindMapNodeStatusChip, MindMapNodeVisual } from './adapter'
export type {
  SelectionToolbarAction,
  SelectionToolbarActionVariant,
  SelectionToolbarPreferPosition,
} from './selectionToolbar'
export {
  mindMapSceneChromeClassName,
  mindMapSceneChromeLabel,
  resolveMindMapSceneChrome,
} from './mindMapSceneChrome'
export type { MindMapSceneChrome, MindMapSceneMode } from './mindMapSceneChrome'
