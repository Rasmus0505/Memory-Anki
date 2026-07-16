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
import {
  MindMapCanvas,
  mindMapSceneChromeClassName,
  mindMapSceneChromeLabel,
} from '@/shared/ui/mindmap-canvas'
import type { MindMapCanvasViewCommand } from '@/shared/ui/mindmap-canvas'
import type { ContextMenuAction } from '@/shared/ui/mindmap-canvas/NodeContextMenu'
import { WidgetErrorBoundary } from '@/shared/components/widget-error-boundary'
import {
  buildSelectionFromDoc,
  editEditorDocNode,
  editorDocToGraph,
  normalizeEditorDocTree,
} from './documentGraphProjection'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import {
  buildMindMapEditorSurfaceClassName,
  type MindMapEditorSurfaceHandle,
  type MindMapEditorSurfaceProps,
} from './MindMapEditorSurface.types'
import { useMindMapEditHistory } from './useMindMapEditHistory'
import { useMindMapEditorDocActions } from './useMindMapEditorDocActions'
import { useMindMapFullscreen } from './useMindMapFullscreen'
import { createMindMapCapabilities, mergeMindMapGraphOptions } from './capabilities'
import { detectClientSource } from '@/shared/lib/clientSource'
import {
  collectRevealMap,
  focusMindMapNodeText,
} from './mindMapEditorSurfaceDom'
import {
  createMindMapCanvasKeyDownHandler,
  selectedInteraction,
  type MindMapInteractionState,
} from './mindMapEditorSurfaceKeyboard'

export const MindMapEditorSurface = forwardRef<MindMapEditorSurfaceHandle, MindMapEditorSurfaceProps>(function MindMapEditorSurface({
  editorState,
  capabilities: providedCapabilities,
  readonly = false,
  practiceModeActive = false,
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
  sceneChrome = 'default',
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
  statusChipsByNodeUid,
  countBadgeByNodeUid,
  onCountBadgeClick,
  focusRequestNodeUid = null,
  focusRequestNonce = 0,
  reviewFxSignal = null,
  feedbackFxSignal = null,
  buildSelectionToolbarActions,
  selectionToolbarPreferPosition = 'auto',
  frameOverlay = null,
  onEditorStateChange,
  onNodeActive,
  onNodeClick,
  onNodeContextMenu,
  onNodeHover,
  onCreateSegmentFromSelection,
  onSegmentRangeDraftChange,
  onAiSplitRequest,
  onFullscreenChange,
  onUiClearedChange,
  onReady,
}: MindMapEditorSurfaceProps, ref) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [interaction, setInteraction] = useState<MindMapInteractionState>({ mode: 'idle' })
  const interactionRef = useRef<MindMapInteractionState>(interaction)
  const selectedNodeId =
    interaction.mode === 'selected'
      ? interaction.primaryId
      : interaction.mode === 'editing'
        ? interaction.nodeId
        : null
  const selectedNodeIds = useMemo(
    () =>
      interaction.mode === 'selected'
        ? interaction.nodeIds
        : interaction.mode === 'editing'
          ? [interaction.nodeId]
          : [],
    [interaction],
  )
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
      statusChipsByNodeUid,
      countBadgeByNodeUid,
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
      activeSegmentId, aiSplitBusy, countBadgeByNodeUid, highlightedNodeUids, masteryByNodeUid,
      onAiSplitRequest, onCreateSegmentFromSelection,
      onNodeClick, onNodeContextMenu, onSegmentRangeDraftChange, practiceModeActive,
      providedCapabilities, revealMap, segmentColorMode, segmentRangeDraft, segments,
      statusChipsByNodeUid,
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
    if (selectedNodeIds.length === 0) return
    const validIds = new Set(graphData.nodes.map((node) => node.id))
    const nextIds = selectedNodeIds.filter((id) => validIds.has(id))
    if (nextIds.length === selectedNodeIds.length && selectedNodeId && validIds.has(selectedNodeId)) {
      return
    }
    if (nextIds.length === 0) {
      replaceInteraction({ mode: 'idle' })
      onNodeActive?.([])
      return
    }
    const primaryId =
      selectedNodeId && nextIds.includes(selectedNodeId)
        ? selectedNodeId
        : nextIds[nextIds.length - 1]!
    replaceInteraction(selectedInteraction(primaryId, nextIds))
    onNodeActive?.(buildSelectionFromDoc(getCurrentEditorDoc(), primaryId))
  }, [
    getCurrentEditorDoc,
    graphData.nodes,
    onNodeActive,
    replaceInteraction,
    selectedNodeId,
    selectedNodeIds,
  ])

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
    replaceInteraction(selectedInteraction(current.nodeId))
  }, [commitEditorDoc, commitEditorDocFrom, getCurrentEditorDoc, replaceInteraction])

  const cancelEditing = useCallback(() => {
    const current = interactionRef.current
    if (current.mode !== 'editing') return
    if (current.createdFromDoc) {
      stageEditorDoc(current.createdFromDoc)
      const returnNodeId = current.returnNodeId ?? null
      replaceInteraction(returnNodeId ? selectedInteraction(returnNodeId) : { mode: 'idle' })
      onNodeActive?.(buildSelectionFromDoc(current.createdFromDoc, returnNodeId))
      return
    }
    replaceInteraction(selectedInteraction(current.nodeId))
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
    (nodeId: string | null, options?: { additive?: boolean }) => {
      const current = interactionRef.current
      if (current.mode === 'editing' && current.nodeId === nodeId && !options?.additive) return
      if (current.mode === 'editing') commitEditingDraft()
      if (!nodeId) {
        replaceInteraction({ mode: 'idle' })
        onNodeActive?.([])
        return
      }
      if (options?.additive) {
        const existing =
          current.mode === 'selected'
            ? current.nodeIds
            : current.mode === 'editing'
              ? [current.nodeId]
              : []
        const set = new Set(existing)
        if (set.has(nodeId)) {
          set.delete(nodeId)
          if (set.size === 0) {
            replaceInteraction({ mode: 'idle' })
            onNodeActive?.([])
            return
          }
          const nodeIds = [...set]
          const primaryId =
            current.mode === 'selected' && set.has(current.primaryId)
              ? current.primaryId
              : nodeIds[nodeIds.length - 1]!
          replaceInteraction(selectedInteraction(primaryId, nodeIds))
          onNodeActive?.(buildSelectionFromDoc(getCurrentEditorDoc(), primaryId))
          return
        }
        set.add(nodeId)
        replaceInteraction(selectedInteraction(nodeId, [...set]))
        onNodeActive?.(buildSelectionFromDoc(getCurrentEditorDoc(), nodeId))
        return
      }
      replaceInteraction(selectedInteraction(nodeId))
      onNodeActive?.(buildSelectionFromDoc(getCurrentEditorDoc(), nodeId))
    },
    [commitEditingDraft, getCurrentEditorDoc, onNodeActive, replaceInteraction],
  )

  const requestFocusNode = useCallback(
    (nodeUid: string | null) => {
      const current = interactionRef.current
      if (current.mode === 'editing') commitEditingDraft()
      replaceInteraction(nodeUid ? selectedInteraction(nodeUid) : { mode: 'idle' })
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
  const toggleNativeFullscreen = fullscreen.toggleNative
  const toggleViewportFullscreen = fullscreen.toggleViewport
  const toggleCanvasFullscreen = fullscreen.toggle
  const showSystemFullscreenControl = presentationStrategy !== 'viewport-only'

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
  const sceneLabel = mindMapSceneChromeLabel(sceneChrome)
  const frameClassName = [
    buildMindMapEditorSurfaceClassName(className),
    mindMapSceneChromeClassName(sceneChrome),
    nativeFullscreenActive ? 'memory-anki-mindmap-native-fullscreen' : '',
  ].filter(Boolean).join(' ')
  const {
    handleAddChild,
    handleAddChildWithoutFocus,
    handleAddSibling,
    handleDeleteNode,
    handleDeleteNodes,
    handleDeleteNodeOnly,
    handleEditNode: commitEditedNodeText,
    handleRelocateNodes,
    handleExtractSelection,
    handleReorderSibling,
    handleMoveUp,
    handleMoveDown,
    canMoveNodeUp,
    canMoveNodeDown,
  } = useMindMapEditorDocActions({
    canEdit,
    getCurrentEditorDoc,
    commitEditorDoc,
    commitEditorDocFrom,
    stageEditorDoc,
    replaceInteraction,
    onNodeActive,
    undoEditorDoc,
  })
  const handleEditNode = useCallback(
    (nodeId: string, text: string) => {
      commitEditedNodeText(nodeId, text, interactionRef.current)
    },
    [commitEditedNodeText],
  )

  const handleCanvasKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      createMindMapCanvasKeyDownHandler({
        canEdit,
        selectedNodeId,
        selectedNodeIds,
        editingNodeId,
        graphNodes: graphData.nodes,
        undoEditorDoc,
        redoEditorDoc,
        handleAddChildWithoutFocus,
        handleAddSibling,
        beginEditingNode,
        handleDeleteNodes,
        pendingKeyboardFocusNodeIdRef,
      })(event)
    },
    [
      beginEditingNode,
      canEdit,
      editingNodeId,
      graphData.nodes,
      handleAddChildWithoutFocus,
      handleAddSibling,
      handleDeleteNodes,
      redoEditorDoc,
      selectedNodeId,
      selectedNodeIds,
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

  const handleSystemFullscreenToggle = useCallback(() => {
    const handled = capabilities.some((capability) => capability.handleFocusToggle?.())
    if (handled) return
    // Desktop: Fullscreen API (system fullscreen). Host immersive layout stays separate.
    toggleNativeFullscreen()
  }, [capabilities, toggleNativeFullscreen])

  const handleWebpageFullscreenToggle = useCallback(() => {
    const handled = capabilities.some((capability) => capability.handleFocusToggle?.())
    if (handled) return
    // Viewport CSS lock inside the browser window so the OS window can still be dragged.
    if (presentationStrategy === 'viewport-only') {
      toggleCanvasFullscreen()
      return
    }
    toggleViewportFullscreen()
  }, [capabilities, presentationStrategy, toggleCanvasFullscreen, toggleViewportFullscreen])

  const canvas = (
    <WidgetErrorBoundary label="思维导图">
      <MindMapCanvas
        graphData={graphData}
        selectedNodeId={selectedNodeId}
        selectedNodeIds={selectedNodeIds}
        editingNodeId={editingNodeId}
        editingDraft={editingDraft}
        selectEditingText={interaction.mode === 'editing' && Boolean(interaction.selectAllOnStart)}
        readonly={!canEdit}
        practiceModeActive={practiceModeActive}
        focusMode={nativeFullscreenActive}
        presentationMode={fullscreen.mode}
        showSystemFullscreenControl={showSystemFullscreenControl}
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
        onCountBadgeClick={onCountBadgeClick}
        buildNodeActions={buildNodeActions}
        buildSelectionToolbarActions={buildSelectionToolbarActions}
        selectionToolbarPreferPosition={selectionToolbarPreferPosition}
        onAddChild={handleAddChild}
        onAddSibling={handleAddSibling}
        onDelete={handleDeleteNode}
        onDeleteNodeOnly={handleDeleteNodeOnly}
        onEdit={handleEditNode}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undoEditorDoc}
        onRedo={redoEditorDoc}
        onRelocate={handleRelocateNodes}
        onExtractSelection={handleExtractSelection}
        onReorderSibling={handleReorderSibling}
        onMoveUp={handleMoveUp}
        onMoveDown={handleMoveDown}
        canMoveUp={canMoveNodeUp}
        canMoveDown={canMoveNodeDown}
        onToggleSystemFullscreen={handleSystemFullscreenToggle}
        onToggleWebpageFullscreen={handleWebpageFullscreenToggle}
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
      data-scene-chrome={sceneChrome}
      data-testid="mindmap-frame-native"
    >
      {sceneLabel ? (
        <span className="memory-anki-mindmap-scene-label" data-testid="mindmap-scene-label">
          {sceneLabel}
        </span>
      ) : null}
      {canvas}
      {frameOverlay}
    </div>
  )
})

MindMapEditorSurface.displayName = 'MindMapEditorSurface'
export type { MindMapEditorSurfaceHandle, MindMapEditorSurfaceProps } from './MindMapEditorSurface.types'
