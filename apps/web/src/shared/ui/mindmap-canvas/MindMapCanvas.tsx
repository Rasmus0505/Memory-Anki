import {
  ReactFlowProvider,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { NodeContextMenu } from './NodeContextMenu'
import type { ContextMenuAction } from './NodeContextMenu'
import type { GraphData } from './adapter'
import { MindMapCanvasToolbar } from './MindMapCanvasToolbar'
import { MindMapCanvasViewport } from './MindMapCanvasViewport'
import { useMindMapCanvasState } from './useMindMapCanvasState'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { logAppError } from '@/shared/logs/model/appLogs'

export type MindMapMobileViewPolicy = 'auto' | 'map' | 'guided'
export type MindMapNodeClickViewportPolicy = 'preserve' | 'guided-center'
export type MindMapContentChangeViewportPolicy = 'auto-fit' | 'preserve'

export interface MindMapCanvasViewCommand {
  type: 'fit' | 'center'
  nodeId?: string | null
  nonce: number
}

export type MindMapDropMode = 'before' | 'inside' | 'after'

export interface MindMapNodeSelectOptions {
  additive?: boolean
}

export interface MindMapCanvasProps {
  graphData: GraphData
  selectedNodeId: string | null
  /** Multi-select set; when omitted, falls back to [selectedNodeId]. */
  selectedNodeIds?: string[]
  editingNodeId?: string | null
  editingDraft?: string | null
  selectEditingText?: boolean
  onNodeSelect: (nodeId: string | null, options?: MindMapNodeSelectOptions) => void
  onEditingNodeChange?: (nodeId: string | null) => void
  onEditingDraftChange?: (nodeId: string, text: string) => void
  onKeyDownCapture?: (event: KeyboardEvent<HTMLDivElement>) => void
  onAddChild: (parentId: string) => void
  onAddSibling: (nodeId: string) => void
  onDelete: (nodeId: string) => void
  onDeleteNodeOnly?: (nodeId: string) => void
  /** Preferred drop commit for structure moves (supports multi-source). */
  onRelocate?: (sourceIds: string[], targetId: string, mode: MindMapDropMode) => void
  onReparent?: (sourceId: string, targetId: string) => void
  onExtractSelection?: (payload: {
    sourceId: string
    liveText: string
    start: number
    end: number
    placement: { mode: 'inside' | 'before' | 'after'; targetUid: string }
  }) => void
  onEdit?: (nodeId: string, text: string) => void
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  focusMode?: boolean
  presentationMode?: 'embedded' | 'native' | 'viewport'
  showSystemFullscreenControl?: boolean
  onToggleSystemFullscreen?: () => void
  onToggleWebpageFullscreen?: () => void
  /** @deprecated Prefer dual toggles; kept for single-control callers. */
  onToggleFocusMode?: () => void
  onEdgeDelete?: (edgeId: string, sourceId: string, targetId: string) => void
  onEdgeInsert?: (edgeId: string, sourceId: string, targetId: string) => void
  onReorderSibling?: (sourceId: string, targetId: string, position: 'before' | 'after') => void
  onMoveUp?: (nodeId: string) => void
  onMoveDown?: (nodeId: string) => void
  canMoveUp?: (nodeId: string) => boolean
  canMoveDown?: (nodeId: string) => boolean
  readonly?: boolean
  showToolbar?: boolean
  toolbarContent?: ReactNode
  onNodeActivate?: (nodeId: string) => void
  onNodeContextAction?: (nodeId: string) => void
  onNodeHover?: (nodeId: string | null) => void
  buildNodeActions?: (nodeId: string) => ContextMenuAction[]
  buildSelectionToolbarActions?: (nodeId: string) => import('./selectionToolbar').SelectionToolbarAction[]
  selectionToolbarPreferPosition?: import('./selectionToolbar').SelectionToolbarPreferPosition
  practiceModeActive?: boolean
  mobileViewPolicy?: MindMapMobileViewPolicy
  nodeClickViewportPolicy?: MindMapNodeClickViewportPolicy
  contentChangeViewportPolicy?: MindMapContentChangeViewportPolicy
  viewCommand?: MindMapCanvasViewCommand | null
  recoveryKey?: string | number | null
  className?: string
}

interface MindMapCanvasRecoveryPanelProps {
  title: string
  description: string
  onRefresh: () => void
}

function MindMapCanvasRecoveryPanel({
  title,
  description,
  onRefresh,
}: MindMapCanvasRecoveryPanelProps) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-50/92 p-4 backdrop-blur-sm">
      <div className="max-w-sm rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm shadow-lg">
        <div className="font-semibold text-zinc-900">{title}</div>
        <div className="mt-1 text-xs leading-5 text-zinc-600">{description}</div>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-3 inline-flex h-9 items-center justify-center rounded-lg border border-zinc-200 px-3 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
        >
          刷新脑图
        </button>
      </div>
    </div>
  )
}

interface MindMapCanvasErrorBoundaryProps {
  resetKey: string
  onRecover: () => void
  children: ReactNode
}

interface MindMapCanvasErrorBoundaryState {
  error: Error | null
}

class MindMapCanvasErrorBoundary extends Component<
  MindMapCanvasErrorBoundaryProps,
  MindMapCanvasErrorBoundaryState
> {
  state: MindMapCanvasErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): MindMapCanvasErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logAppError({
      feature: '思维导图',
      stage: 'mindmap_canvas_error_boundary',
      error,
      responseSummary: info.componentStack ?? '',
      meta: {
        componentStack: info.componentStack ?? '',
      },
    })
  }

  componentDidUpdate(previousProps: MindMapCanvasErrorBoundaryProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="relative h-full min-h-[520px] rounded-[14px] border border-zinc-200 bg-zinc-50">
          <MindMapCanvasRecoveryPanel
            title="脑图渲染异常"
            description="当前脑图区域遇到渲染错误，可以刷新脑图宿主恢复当前翻卡进度。"
            onRefresh={this.props.onRecover}
          />
        </div>
      )
    }
    return this.props.children
  }
}

type MindMapCanvasInnerProps = MindMapCanvasProps & {
  onAutoRecover: (reason: string, signature: string) => void
  onHostRefresh: () => void
  controlledViewport: Viewport
  onControlledViewportChange: (viewport: Viewport) => void
}

function MindMapCanvasInner({
  focusMode = false,
  presentationMode = 'embedded',
  showSystemFullscreenControl = false,
  onToggleSystemFullscreen,
  onToggleWebpageFullscreen,
  onToggleFocusMode,
  showToolbar = true,
  className,
  onAutoRecover,
  onHostRefresh,
  ...props
}: MindMapCanvasInnerProps) {
  const state = useMindMapCanvasState({
    ...props,
    focusMode,
    toolbarVisible: showToolbar,
    onHostRefresh,
  })
  const expectedNodeCount = props.graphData.nodes.length
  const [canvasReadyTimedOut, setCanvasReadyTimedOut] = useState(false)
  const blankCanvasDetected =
    state.isCanvasReady && expectedNodeCount > 0 && state.displayNodes.length === 0
  const canvasIssue = useMemo(() => {
    if (canvasReadyTimedOut) {
      return {
        reason: 'size',
        title: '脑图容器尺寸异常',
        description: '脑图数据还在，但容器尺寸暂时不可用。刷新脑图会重建宿主并重新测量画布。',
      }
    }
    if (blankCanvasDetected) {
      return {
        reason: 'empty',
        title: '脑图渲染为空',
        description: '脑图数据还在，但 ReactFlow 当前没有渲染出节点。刷新脑图会重建宿主并保留当前翻卡进度。',
      }
    }
    return null
  }, [blankCanvasDetected, canvasReadyTimedOut])

  useEffect(() => {
    if (expectedNodeCount === 0 || state.isCanvasReady) {
      setCanvasReadyTimedOut(false)
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      setCanvasReadyTimedOut(true)
    }, 900)
    return () => window.clearTimeout(timeoutId)
  }, [expectedNodeCount, state.isCanvasReady])

  useEffect(() => {
    if (!canvasIssue) return
    onAutoRecover(
      canvasIssue.reason,
      [
        props.recoveryKey ?? '',
        canvasIssue.reason,
        expectedNodeCount,
        state.canvasSize.width,
        state.canvasSize.height,
      ].join(':'),
    )
  }, [
    canvasIssue,
    expectedNodeCount,
    onAutoRecover,
    props.recoveryKey,
    state.canvasSize.height,
    state.canvasSize.width,
  ])

  const dispatchFullscreenFeedback = (label: string, nextActive: boolean) => {
    dispatchGlobalFeedback('mode_switch', {
      origin: 'toolbar',
      label: nextActive ? 'EXIT' : label,
    })
  }

  const handleToggleSystemFullscreen = () => {
    dispatchFullscreenFeedback('SYSTEM_FOCUS', presentationMode === 'native')
    ;(onToggleSystemFullscreen ?? onToggleFocusMode)?.()
  }

  const handleToggleWebpageFullscreen = () => {
    const webpageActive = presentationMode === 'viewport' || (!showSystemFullscreenControl && focusMode)
    dispatchFullscreenFeedback('VIEWPORT_FOCUS', webpageActive)
    ;(onToggleWebpageFullscreen ?? onToggleFocusMode)?.()
  }

  return (
    <div
      ref={state.frameRef}
      tabIndex={-1}
      onKeyDownCapture={props.onKeyDownCapture}
      data-interaction-mode={props.editingNodeId ? 'editing' : props.selectedNodeId ? 'selected' : 'idle'}
      className={`relative flex h-full min-h-[520px] min-w-0 flex-col overflow-hidden rounded-[14px] border border-zinc-200 bg-zinc-50 shadow-[0_18px_44px_rgba(24,24,27,0.08)] ${className ?? ''}`}
    >
      {showToolbar ? (
        <MindMapCanvasToolbar
          focusMode={focusMode}
          presentationMode={presentationMode}
          showSystemFullscreenControl={showSystemFullscreenControl}
          canUndo={state.canUndo}
          canRedo={state.canRedo}
          showHistoryControls={state.canShowHistoryControls}
          leadingContent={props.toolbarContent}
          onRefreshHost={onHostRefresh}
          onToggleSystemFullscreen={handleToggleSystemFullscreen}
          onToggleWebpageFullscreen={handleToggleWebpageFullscreen}
          onUndo={props.onUndo}
          onRedo={props.onRedo}
        />
      ) : null}

      <div ref={state.canvasRef} className="min-h-0 flex-1" data-testid="mindmap-canvas-viewport-host">
        {state.isCanvasReady ? (
          <div className="relative h-full">
            <MindMapCanvasViewport
              width={state.canvasSize.width}
              height={state.canvasSize.height}
              nodes={state.displayNodes}
              edges={state.displayEdges}
              isDraggingNode={state.isDraggingNode}
              onNodesChange={state.onNodesChange}
              onEdgesChange={state.onEdgesChange}
              onNodeClick={state.handleNodeClick}
              onNodeDoubleClick={state.handleNodeDoubleClick}
              onNodeContextMenu={state.handleNodeContextMenu}
              onNodeDragStart={state.handleNodeDragStart}
              onNodeDrag={state.handleNodeDrag}
              onNodeDragStop={state.handleNodeDragStop}
              onNodeMouseEnter={state.handleNodeMouseEnter}
              onNodeMouseLeave={state.handleNodeMouseLeave}
              onEdgeClick={state.handleEdgeClick}
              onEdgeDoubleClick={state.handleEdgeDoubleClick}
              onPaneClick={state.handlePaneClick}
              onMoveStart={state.handleMoveStart}
              onMove={state.handleMove}
              onMoveEnd={state.handleMoveEnd}
              viewport={state.controlledViewport}
              onViewportChange={state.handleViewportChange}
              readonly={Boolean(props.readonly)}
              mobileGuided={state.mobileGuidedActive}
              preserveViewport={state.preserveViewport}
            />
            {canvasIssue ? (
              <MindMapCanvasRecoveryPanel
                title={canvasIssue.title}
                description={canvasIssue.description}
                onRefresh={state.refreshCanvas}
              />
            ) : null}
          </div>
        ) : canvasIssue ? (
          <div className="relative h-full min-h-[360px]">
            <MindMapCanvasRecoveryPanel
              title={canvasIssue.title}
              description={canvasIssue.description}
              onRefresh={state.refreshCanvas}
            />
          </div>
        ) : (
          <div className="flex h-full min-h-[360px] items-center justify-center text-sm text-muted-foreground">
            正在准备画布...
          </div>
        )}
      </div>

      {state.ctxMenu ? (
        <NodeContextMenu
          x={state.ctxMenu.x}
          y={state.ctxMenu.y}
          onClose={state.closeNodeMenu}
          actions={state.nodeActions}
        />
      ) : null}
      {state.edgeMenu ? (
        <NodeContextMenu
          x={state.edgeMenu.x}
          y={state.edgeMenu.y}
          onClose={state.closeEdgeMenu}
          actions={state.edgeActions}
        />
      ) : null}
    </div>
  )
}

export function MindMapCanvas(props: MindMapCanvasProps) {
  const [hostEpoch, setHostEpoch] = useState(0)
  // 相机状态放在 Provider 外层，容器重建或短暂零尺寸时也不会丢失用户视口。
  const [controlledViewport, setControlledViewport] = useState<Viewport>({ x: 4, y: 18, zoom: 0.99 })
  const autoRecoveredSignaturesRef = useRef<Set<string>>(new Set())
  const hostResetKey = `${String(props.recoveryKey ?? '')}:${hostEpoch}`
  const refreshHost = useCallback(() => {
    dispatchGlobalFeedback('toolbar_action', {
      origin: 'toolbar',
      label: 'HOST_REFRESH',
    })
    setHostEpoch((version) => version + 1)
  }, [])
  const handleAutoRecover = useCallback(
    (_reason: string, signature: string) => {
      if (autoRecoveredSignaturesRef.current.has(signature)) return
      autoRecoveredSignaturesRef.current.add(signature)
      refreshHost()
    },
    [refreshHost],
  )

  return (
    <MindMapCanvasErrorBoundary resetKey={hostResetKey} onRecover={refreshHost}>
      <ReactFlowProvider key={hostResetKey}>
        <MindMapCanvasInner
          {...props}
          controlledViewport={controlledViewport}
          onControlledViewportChange={setControlledViewport}
          onAutoRecover={handleAutoRecover}
          onHostRefresh={refreshHost}
        />
      </ReactFlowProvider>
    </MindMapCanvasErrorBoundary>
  )
}
