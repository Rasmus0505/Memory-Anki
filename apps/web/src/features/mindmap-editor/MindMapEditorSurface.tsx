import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { MindMapCanvas } from '@/shared/ui/mindmap-canvas'
import type { MindMapCanvasViewCommand } from '@/shared/ui/mindmap-canvas'
import type { ContextMenuAction } from '@/shared/ui/mindmap-canvas/NodeContextMenu'
import { WidgetErrorBoundary } from '@/shared/components/widget-error-boundary'
import {
  addEditorDocChildWithResult,
  addEditorDocSiblingWithResult,
  buildSelectionFromDoc,
  canMoveEditorDocNode,
  countEditorDocSubtree,
  deleteEditorDocNode,
  deleteEditorDocNodeOnly,
  editEditorDocNode,
  editorDocToGraph,
  moveEditorDocNode,
  normalizeEditorDocTree,
  reparentEditorDocNode,
  reorderEditorDocNode,
} from './documentGraphProjection'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { toast } from '@/shared/feedback/toast'
import {
  buildMindMapEditorSurfaceClassName,
  type MindMapEditorSurfaceHandle,
  type MindMapEditorSurfaceProps,
} from './MindMapEditorSurface.types'
import { useMindMapEditHistory } from './useMindMapEditHistory'
import { useMindMapFullscreen } from './useMindMapFullscreen'
import { createMindMapCapabilities, mergeMindMapGraphOptions } from './capabilities'
import { detectClientSource } from '@/shared/lib/clientSource'

type MindMapInteractionState =
  | { mode: 'idle' }
  | { mode: 'selected'; nodeId: string }
  | {
      mode: 'editing'
      nodeId: string
      originalText: string
      draftText: string
      selectAllOnStart?: boolean
      createdFromDoc?: MindMapEditorState['editor_doc']
      returnNodeId?: string
    }

export const MindMapEditorSurface = forwardRef<MindMapEditorSurfaceHandle, MindMapEditorSurfaceProps>(function MindMapEditorSurface({
  editorState,
  capabilities: providedCapabilities,
  readonly = false,
  practiceModeActive = false,
  immersiveModeActive = false,
  presentationStrategy = detectClientSource() === 'pwa' ? 'viewport-only' : 'native-preferred',
  aiSplitBusy = false,
  syncReason = null,
  externalSyncKey = null,
  forceSyncKey = null,
  preserveViewOnSync = false,
  mobileViewPolicy = 'auto',
  nodeClickViewportPolicy,
  contentChangeViewportPolicy,
  className,
  toolbarContent,
  segments = [],
  activeSegmentId = null,
  segmentColorMode = 'all',
  segmentRangeDraft = {
    active: false,
    targetSegmentId: null,
    selectedNodeUids: [],
    overriddenConflictNodeUids: [],
  },
  highlightedNodeUids = [],
  masteryByNodeUid = {},
  focusRequestNodeUid = null,
  focusRequestNonce = 0,
  reviewFxSignal = null,
  feedbackFxSignal = null,
  onEditorStateChange,
  onNodeActive,
  onNodeClick,
  onNodeContextMenu,
  onNodeHover,
  onCreateSegmentFromSelection,
  onSegmentRangeDraftChange,
  onAiSplitRequest,
  onFullscreenChange,
  onFullscreenToggle,
  onUiClearedChange,
  onReady,
}: MindMapEditorSurfaceProps, ref) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [interaction, setInteraction] = useState<MindMapInteractionState>({ mode: 'idle' })
  const interactionRef = useRef<MindMapInteractionState>(interaction)
  const selectedNodeId = interaction.mode === 'idle' ? null : interaction.nodeId
  const editingNodeId = interaction.mode === 'editing' ? interaction.nodeId : null
  const editingDraft = interaction.mode === 'editing' ? interaction.draftText : null
  const [uiCleared, setUiCleared] = useState(false)
  const [viewCommand, setViewCommand] = useState<MindMapCanvasViewCommand | null>(null)
  const viewCommandNonceRef = useRef(0)
  const pendingKeyboardFocusNodeIdRef = useRef<string | null>(null)
  const editorDoc = editorState.editor_doc
  const normalizedEditorState = useMemo<MindMapEditorState>(
    () => ({
      ...editorState,
      editor_doc: normalizeEditorDocTree(editorDoc),
      editor_config: editorState.editor_config ?? {},
      editor_local_config: editorState.editor_local_config ?? {},
      lang: editorState.lang || 'zh',
    }),
    [editorDoc, editorState],
  )
  const revealMap = useMemo(() => collectRevealMap(normalizedEditorState), [normalizedEditorState])
  const capabilities = useMemo(
    () => providedCapabilities ?? createMindMapCapabilities({
      segments,
      activeSegmentId,
      segmentColorMode,
      segmentRangeDraft,
      highlightedNodeUids,
      masteryByNodeUid,
      practiceModeActive,
      revealMap: practiceModeActive ? revealMap : undefined,
      aiSplitBusy,
      onAiSplitRequest,
      onCreateSegmentFromSelection,
      onSegmentRangeDraftChange,
      onNodeClick,
      onNodeContextMenu,
        }),
    [
      activeSegmentId, aiSplitBusy,  highlightedNodeUids, masteryByNodeUid,
      onAiSplitRequest, onCreateSegmentFromSelection,
      onNodeClick, onNodeContextMenu, onSegmentRangeDraftChange, practiceModeActive,
      providedCapabilities, revealMap, segmentColorMode, segmentRangeDraft, segments,
    ],
  )
  const graphOptions = useMemo(() => mergeMindMapGraphOptions(capabilities), [capabilities])
  const graphData = useMemo(
    () =>
      editorDocToGraph(normalizedEditorState.editor_doc, {
        ...graphOptions,
        readonly,
      }),
    [graphOptions, normalizedEditorState.editor_doc, readonly],
  )
  const canvasRecoveryKey = useMemo(
    () =>
      [
        syncReason ?? '',
        preserveViewOnSync ? '' : (externalSyncKey ?? ''),
        forceSyncKey ?? '',
        preserveViewOnSync ? '' : graphData.nodes.length,
        preserveViewOnSync ? '' : graphData.edges.length,
      ].join(':'),
    [
      externalSyncKey,
      forceSyncKey,
      graphData.edges.length,
      graphData.nodes.length,
      preserveViewOnSync,
      syncReason,
    ],
  )

  useEffect(() => {
    onReady?.()
  }, [onReady])

  useEffect(() => {
    if (!reviewFxSignal) return
    dispatchGlobalFeedback(reviewFxSignal.type, {
      origin: 'review',
      label: reviewFxSignal.nodeUid ?? undefined,
    })
  }, [reviewFxSignal])

  useEffect(() => {
    if (!feedbackFxSignal) return
    dispatchGlobalFeedback(feedbackFxSignal.type, {
      origin: feedbackFxSignal.origin ?? 'system',
      label: feedbackFxSignal.nodeUid ?? feedbackFxSignal.source ?? undefined,
    })
  }, [feedbackFxSignal])

  useEffect(() => {
    onUiClearedChange?.(uiCleared)
  }, [onUiClearedChange, uiCleared])

  const publishEditorDoc = useCallback(
    (nextEditorDoc: MindMapEditorState['editor_doc']) => {
      if (readonly) return
      onEditorStateChange({
        ...normalizedEditorState,
        editor_doc: nextEditorDoc,
      })
    },
    [normalizedEditorState, onEditorStateChange, readonly],
  )
  const editHistory = useMindMapEditHistory(
    normalizedEditorState.editor_doc,
    publishEditorDoc,
  )
  const {
    canUndo,
    canRedo,
    commit: commitEditorDoc,
    stage: stageEditorDoc,
    commitFrom: commitEditorDocFrom,
    undo: undoEditorDoc,
    redo: redoEditorDoc,
    getCurrentEditorDoc,
  } = editHistory

  const replaceInteraction = useCallback((next: MindMapInteractionState) => {
    interactionRef.current = next
    setInteraction(next)
  }, [])

  useEffect(() => {
    if (!selectedNodeId) return
    if (graphData.nodes.some((node) => node.id === selectedNodeId)) return
    replaceInteraction({ mode: 'idle' })
    onNodeActive?.([])
  }, [graphData.nodes, onNodeActive, replaceInteraction, selectedNodeId])

  useEffect(() => {
    const nodeId = pendingKeyboardFocusNodeIdRef.current
    if (!nodeId) return
    const timer = window.setTimeout(() => {
      const frame = frameRef.current
      if (!frame) return
      focusMindMapNodeText(frame, nodeId)
      pendingKeyboardFocusNodeIdRef.current = null
    }, 0)
    return () => window.clearTimeout(timer)
  }, [graphData.nodes])

  const commitEditingDraft = useCallback(() => {
    const current = interactionRef.current
    if (current.mode !== 'editing') return
    const text = current.draftText.trim()
    if (text && text !== current.originalText) {
      const nextEditorDoc = editEditorDocNode(getCurrentEditorDoc(), current.nodeId, text)
      if (current.createdFromDoc) commitEditorDocFrom(current.createdFromDoc, nextEditorDoc)
      else commitEditorDoc(nextEditorDoc)
    } else if (current.createdFromDoc) {
      commitEditorDocFrom(current.createdFromDoc, getCurrentEditorDoc())
    }
    replaceInteraction({ mode: 'selected', nodeId: current.nodeId })
  }, [commitEditorDoc, commitEditorDocFrom, getCurrentEditorDoc, replaceInteraction])

  const cancelEditing = useCallback(() => {
    const current = interactionRef.current
    if (current.mode !== 'editing') return
    if (current.createdFromDoc) {
      stageEditorDoc(current.createdFromDoc)
      const returnNodeId = current.returnNodeId ?? null
      replaceInteraction(returnNodeId ? { mode: 'selected', nodeId: returnNodeId } : { mode: 'idle' })
      onNodeActive?.(buildSelectionFromDoc(current.createdFromDoc, returnNodeId))
      return
    }
    replaceInteraction({ mode: 'selected', nodeId: current.nodeId })
  }, [onNodeActive, replaceInteraction, stageEditorDoc])

  const beginEditingNode = useCallback(
    (nodeId: string) => {
      const current = interactionRef.current
      if (current.mode === 'editing' && current.nodeId === nodeId) return
      if (current.mode === 'editing' && current.nodeId !== nodeId) commitEditingDraft()
      const selection = buildSelectionFromDoc(getCurrentEditorDoc(), nodeId)
      const text = selection[0]?.text || '未命名知识点'
      replaceInteraction({
        mode: 'editing',
        nodeId,
        originalText: text,
        draftText: text,
        selectAllOnStart: false,
      })
      onNodeActive?.(selection)
    },
    [commitEditingDraft, getCurrentEditorDoc, onNodeActive, replaceInteraction],
  )

  const updateEditingDraft = useCallback(
    (nodeId: string, draftText: string) => {
      const current = interactionRef.current
      if (current.mode !== 'editing' || current.nodeId !== nodeId) return
      replaceInteraction({ ...current, draftText })
    },
    [replaceInteraction],
  )

  const selectNode = useCallback(
    (nodeId: string | null) => {
      const current = interactionRef.current
      if (current.mode === 'editing' && current.nodeId === nodeId) return
      if (current.mode === 'editing') commitEditingDraft()
      replaceInteraction(nodeId ? { mode: 'selected', nodeId } : { mode: 'idle' })
      onNodeActive?.(buildSelectionFromDoc(getCurrentEditorDoc(), nodeId))
    },
    [commitEditingDraft, getCurrentEditorDoc, onNodeActive, replaceInteraction],
  )

  const requestFocusNode = useCallback(
    (nodeUid: string | null) => {
      const current = interactionRef.current
      if (current.mode === 'editing') commitEditingDraft()
      replaceInteraction(nodeUid ? { mode: 'selected', nodeId: nodeUid } : { mode: 'idle' })
      onNodeActive?.(buildSelectionFromDoc(getCurrentEditorDoc(), nodeUid))
      if (!nodeUid) return
      viewCommandNonceRef.current += 1
      setViewCommand({
        type: 'center',
        nodeId: nodeUid,
        nonce: viewCommandNonceRef.current,
      })
    },
    [commitEditingDraft, getCurrentEditorDoc, onNodeActive, replaceInteraction],
  )

  const requestFitView = useCallback(() => {
    viewCommandNonceRef.current += 1
    setViewCommand({
      type: 'fit',
      nonce: viewCommandNonceRef.current,
    })
  }, [])

  const fullscreen = useMindMapFullscreen({
    getFullscreenTarget: () => frameRef.current,
    presentationStrategy,
    onFullscreenChange,
  })
  const nativeFullscreenActive = fullscreen.active
  const enterNativeFullscreen = fullscreen.enter
  const exitNativeFullscreen = fullscreen.exit
  const toggleCanvasFullscreen = fullscreen.toggle

  useEffect(() => {
    if (!focusRequestNodeUid || focusRequestNonce <= 0) return
    requestFocusNode(focusRequestNodeUid)
  }, [focusRequestNodeUid, focusRequestNonce, requestFocusNode])

  const activateNode = useCallback(
    (nodeId: string) => {
      const selection = buildSelectionFromDoc(normalizedEditorState.editor_doc, nodeId)
      onNodeActive?.(selection)
      onNodeClick?.(selection)
    },
    [normalizedEditorState.editor_doc, onNodeActive, onNodeClick],
  )

  const contextNode = useCallback(
    (nodeId: string) => {
      const selection = buildSelectionFromDoc(normalizedEditorState.editor_doc, nodeId)
      onNodeActive?.(selection)
      onNodeContextMenu?.(selection)
    },
    [normalizedEditorState.editor_doc, onNodeActive, onNodeContextMenu],
  )

  const hoverNode = useCallback(
    (nodeId: string | null) => {
      onNodeHover?.(buildSelectionFromDoc(normalizedEditorState.editor_doc, nodeId))
    },
    [normalizedEditorState.editor_doc, onNodeHover],
  )

  const buildNodeActions = useCallback(
    (nodeId: string): ContextMenuAction[] => {
      const selection = buildSelectionFromDoc(normalizedEditorState.editor_doc, nodeId)
      const context = {
        nodeId,
        selection,
        isRoot: graphData.nodes.find((node) => node.id === nodeId)?.parentId == null,
        readonly,
        practiceModeActive,
      }
      return capabilities.flatMap((capability) => capability.getNodeActions?.(context) ?? [])
    },
    [capabilities, graphData.nodes, normalizedEditorState.editor_doc, practiceModeActive, readonly],
  )

  useImperativeHandle(
    ref,
    () => ({
      setUiCleared: setUiCleared,
      toggleUiCleared: () => setUiCleared((current) => !current),
      focusNode: requestFocusNode,
      fitView: requestFitView,
      enterFullscreen: enterNativeFullscreen,
      exitFullscreen: exitNativeFullscreen,
      enterNativeFullscreen,
      exitNativeFullscreen,
    }),
    [enterNativeFullscreen, exitNativeFullscreen, requestFitView, requestFocusNode],
  )

  const canEdit = !readonly && !practiceModeActive && !capabilities.some((capability) => capability.locksEditing)
  const resolvedNodeClickViewportPolicy =
    nodeClickViewportPolicy ?? 'preserve'
  const resolvedContentChangeViewportPolicy =
    contentChangeViewportPolicy ?? 'preserve'
  const frameClassName = `${buildMindMapEditorSurfaceClassName(className)}${
    nativeFullscreenActive ? ' memory-anki-mindmap-native-fullscreen' : ''
  }`
  const handleAddChild = useCallback(
    (nodeId: string) => {
      const baseEditorDoc = getCurrentEditorDoc()
      const result = addEditorDocChildWithResult(baseEditorDoc, nodeId)
      if (!result.nodeUid || !stageEditorDoc(result.editorDoc)) return
      const selection = buildSelectionFromDoc(result.editorDoc, result.nodeUid)
      const text = selection[0]?.text || '新知识点'
      replaceInteraction({
        mode: 'editing',
        nodeId: result.nodeUid,
        originalText: text,
        draftText: text,
        selectAllOnStart: true,
        createdFromDoc: baseEditorDoc,
        returnNodeId: nodeId,
      })
      onNodeActive?.(selection)
    },
    [getCurrentEditorDoc, onNodeActive, replaceInteraction, stageEditorDoc],
  )
  const handleAddChildWithoutFocus = useCallback(
    (nodeId: string) => {
      const result = addEditorDocChildWithResult(getCurrentEditorDoc(), nodeId)
      if (!result.nodeUid || !commitEditorDoc(result.editorDoc)) return
      replaceInteraction({ mode: 'selected', nodeId })
      onNodeActive?.(buildSelectionFromDoc(result.editorDoc, nodeId))
    },
    [commitEditorDoc, getCurrentEditorDoc, onNodeActive, replaceInteraction],
  )
  const handleAddSibling = useCallback(
    (nodeId: string) => {
      const baseEditorDoc = getCurrentEditorDoc()
      const result = addEditorDocSiblingWithResult(baseEditorDoc, nodeId)
      if (!result.nodeUid || !stageEditorDoc(result.editorDoc)) return
      const selection = buildSelectionFromDoc(result.editorDoc, result.nodeUid)
      const text = selection[0]?.text || '新知识点'
      replaceInteraction({
        mode: 'editing',
        nodeId: result.nodeUid,
        originalText: text,
        draftText: text,
        selectAllOnStart: true,
        createdFromDoc: baseEditorDoc,
        returnNodeId: nodeId,
      })
      onNodeActive?.(selection)
    },
    [getCurrentEditorDoc, onNodeActive, replaceInteraction, stageEditorDoc],
  )
  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const currentEditorDoc = getCurrentEditorDoc()
      const removedCount = countEditorDocSubtree(currentEditorDoc, nodeId)
      if (removedCount === 0) return
      const nextEditorDoc = deleteEditorDocNode(currentEditorDoc, nodeId)
      if (!commitEditorDoc(nextEditorDoc)) return
      replaceInteraction({ mode: 'idle' })
      onNodeActive?.([])
      toast.success(
        removedCount > 1 ? `已删除整条分支（${removedCount} 张卡片）` : '已删除卡片',
        { action: { label: '撤销', onClick: undoEditorDoc } },
      )
    },
    [commitEditorDoc, getCurrentEditorDoc, onNodeActive, replaceInteraction, undoEditorDoc],
  )
  const handleDeleteNodeOnly = useCallback(
    (nodeId: string) => {
      const currentEditorDoc = getCurrentEditorDoc()
      const nextEditorDoc = deleteEditorDocNodeOnly(currentEditorDoc, nodeId)
      if (!commitEditorDoc(nextEditorDoc)) return
      replaceInteraction({ mode: 'idle' })
      onNodeActive?.([])
      toast.success('已单独删除卡片，子级已提升', {
        action: { label: '撤销', onClick: undoEditorDoc },
      })
    },
    [commitEditorDoc, getCurrentEditorDoc, onNodeActive, replaceInteraction, undoEditorDoc],
  )
  const handleEditNode = useCallback(
    (nodeId: string, text: string) => {
      const trimmed = text.trim()
      const current = interactionRef.current
      if (trimmed) {
        const nextEditorDoc = editEditorDocNode(getCurrentEditorDoc(), nodeId, trimmed)
        if (current.mode === 'editing' && current.nodeId === nodeId && current.createdFromDoc) {
          commitEditorDocFrom(current.createdFromDoc, nextEditorDoc)
        } else {
          commitEditorDoc(nextEditorDoc)
        }
      }
      replaceInteraction({ mode: 'selected', nodeId })
    },
    [commitEditorDoc, commitEditorDocFrom, getCurrentEditorDoc, replaceInteraction],
  )
  const handleReparentNode = useCallback(
    (sourceId: string, targetId: string) =>
      commitEditorDoc(reparentEditorDocNode(getCurrentEditorDoc(), sourceId, targetId)),
    [commitEditorDoc, getCurrentEditorDoc],
  )
  const handleReorderSibling = useCallback(
    (sourceId: string, targetId: string, position: 'before' | 'after') =>
      commitEditorDoc(reorderEditorDocNode(getCurrentEditorDoc(), sourceId, targetId, position)),
    [commitEditorDoc, getCurrentEditorDoc],
  )
  const handleMoveUp = useCallback(
    (nodeId: string) =>
      commitEditorDoc(moveEditorDocNode(getCurrentEditorDoc(), nodeId, 'up')),
    [commitEditorDoc, getCurrentEditorDoc],
  )
  const handleMoveDown = useCallback(
    (nodeId: string) =>
      commitEditorDoc(moveEditorDocNode(getCurrentEditorDoc(), nodeId, 'down')),
    [commitEditorDoc, getCurrentEditorDoc],
  )
  const canMoveNodeUp = useCallback(
    (nodeId: string) => canMoveEditorDocNode(getCurrentEditorDoc(), nodeId, 'up'),
    [getCurrentEditorDoc],
  )
  const canMoveNodeDown = useCallback(
    (nodeId: string) => canMoveEditorDocNode(getCurrentEditorDoc(), nodeId, 'down'),
    [getCurrentEditorDoc],
  )

  const handleCanvasKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!canEdit) return
      const target = event.target instanceof HTMLElement ? event.target : null
      if (isEditableKeyboardTarget(target)) return

      const primaryModifier = event.ctrlKey || event.metaKey
      const lowerKey = event.key.toLowerCase()
      if (primaryModifier && lowerKey === 'z') {
        event.preventDefault()
        if (event.shiftKey) redoEditorDoc()
        else undoEditorDoc()
        return
      }
      if (primaryModifier && lowerKey === 'y') {
        event.preventDefault()
        redoEditorDoc()
        return
      }
      if (isNonNodeInteractiveTarget(target)) return
      if (!selectedNodeId || editingNodeId || event.repeat) return
      const selectedNode = graphData.nodes.find((node) => node.id === selectedNodeId)
      if (!selectedNode) return

      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        pendingKeyboardFocusNodeIdRef.current = selectedNodeId
        handleAddChildWithoutFocus(selectedNodeId)
        return
      }
      if (
        event.key === 'Enter' &&
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        selectedNode.parentId != null
      ) {
        event.preventDefault()
        handleAddSibling(selectedNodeId)
        return
      }
      if (
        (event.key === 'Enter' || event.key === 'F2') &&
        !event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault()
        beginEditingNode(selectedNodeId)
        return
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedNode.parentId != null
      ) {
        event.preventDefault()
        handleDeleteNode(selectedNodeId)
      }
    },
    [
      beginEditingNode,
      canEdit,
      editingNodeId,
      graphData.nodes,
      handleAddChildWithoutFocus,
      handleAddSibling,
      handleDeleteNode,
      redoEditorDoc,
      selectedNodeId,
      undoEditorDoc,
    ],
  )
  const handleEditingNodeChange = useCallback(
    (nodeId: string | null) => {
      if (nodeId) beginEditingNode(nodeId)
      else cancelEditing()
    },
    [beginEditingNode, cancelEditing],
  )

  const handleFocusToggle = useCallback(() => {
    const handled = capabilities.some((capability) => capability.handleFocusToggle?.())
    if (handled) return
    if (onFullscreenToggle && presentationStrategy === 'native-preferred') onFullscreenToggle()
    else toggleCanvasFullscreen()
  }, [capabilities, onFullscreenToggle, presentationStrategy, toggleCanvasFullscreen])

  const usesSurfaceFullscreen = presentationStrategy === 'viewport-only' || !onFullscreenToggle

  const canvas = (
    <WidgetErrorBoundary label="思维导图">
      <MindMapCanvas
        graphData={graphData}
        selectedNodeId={selectedNodeId}
        editingNodeId={editingNodeId}
        editingDraft={editingDraft}
        selectEditingText={interaction.mode === 'editing' && Boolean(interaction.selectAllOnStart)}
        readonly={!canEdit}
        practiceModeActive={practiceModeActive}
        focusMode={usesSurfaceFullscreen ? nativeFullscreenActive : immersiveModeActive}
        focusModeLabel={presentationStrategy === 'viewport-only' ? '全屏' : onFullscreenToggle ? '网页内全屏' : '系统全屏'}
        showToolbar={!uiCleared}
        toolbarContent={toolbarContent}
        mobileViewPolicy={mobileViewPolicy}
        nodeClickViewportPolicy={resolvedNodeClickViewportPolicy}
        contentChangeViewportPolicy={resolvedContentChangeViewportPolicy}
        viewCommand={viewCommand}
        recoveryKey={canvasRecoveryKey}
        onNodeSelect={selectNode}
        onEditingNodeChange={handleEditingNodeChange}
        onEditingDraftChange={updateEditingDraft}
        onKeyDownCapture={handleCanvasKeyDown}
        onNodeActivate={activateNode}
        onNodeContextAction={contextNode}
        onNodeHover={hoverNode}
        buildNodeActions={buildNodeActions}
        onAddChild={handleAddChild}
        onAddSibling={handleAddSibling}
        onDelete={handleDeleteNode}
        onDeleteNodeOnly={handleDeleteNodeOnly}
        onEdit={handleEditNode}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undoEditorDoc}
        onRedo={redoEditorDoc}
        onReparent={handleReparentNode}
        onReorderSibling={handleReorderSibling}
        onMoveUp={handleMoveUp}
        onMoveDown={handleMoveDown}
        canMoveUp={canMoveNodeUp}
        canMoveDown={canMoveNodeDown}
        onToggleFocusMode={handleFocusToggle}
        className="h-full min-h-0 w-full border-0 bg-transparent shadow-none"
      />
    </WidgetErrorBoundary>
  )
  return (
    <div
      ref={frameRef}
      className={frameClassName}
      data-fullscreen={nativeFullscreenActive ? 'true' : 'false'}
      data-presentation-mode={fullscreen.mode}
      data-testid="mindmap-frame-native"
    >
      {canvas}
    </div>
  )
})

MindMapEditorSurface.displayName = 'MindMapEditorSurface'

export type { MindMapEditorSurfaceHandle, MindMapEditorSurfaceProps } from './MindMapEditorSurface.types'

function isEditableKeyboardTarget(target: HTMLElement | null) {
  if (!target) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function focusMindMapNodeText(container: HTMLElement, nodeId: string) {
  const shell = Array.from(
    container.querySelectorAll<HTMLElement>('[data-mindmap-node-id]'),
  ).find((element) => element.dataset.mindmapNodeId === nodeId)
  shell?.querySelector<HTMLButtonElement>('.mindmap-node-text')?.focus()
}

function isNonNodeInteractiveTarget(target: HTMLElement | null) {
  if (!target) return false
  return Boolean(
    target.closest('button, a, [role="menuitem"]') &&
      !target.closest('.mindmap-node-text'),
  )
}

function collectRevealMap(editorState: MindMapEditorState) {
  const result: Record<string, 'hidden' | 'placeholder' | 'revealed'> = {}
  const doc = normalizeEditorDocTree(editorState.editor_doc)
  const walk = (node: { data?: Record<string, unknown>; children?: unknown[] }) => {
    const uid = typeof node.data?.uid === 'string' ? node.data.uid : ''
    const text = typeof node.data?.text === 'string' ? node.data.text : ''
    if (uid) {
      result[uid] = text === '待回忆' ? 'hidden' : 'revealed'
    }
    ;(Array.isArray(node.children) ? node.children : []).forEach((child) => {
      if (child && typeof child === 'object') {
        walk(child as { data?: Record<string, unknown>; children?: unknown[] })
      }
    })
  }
  if (doc.root) walk(doc.root)
  return result
}

