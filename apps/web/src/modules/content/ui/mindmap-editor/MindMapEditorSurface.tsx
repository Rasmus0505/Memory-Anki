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
  getEditorDocStoredText,
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

const EMPTY_SEGMENTS: NonNullable<MindMapEditorSurfaceProps['segments']> = []
const EMPTY_UIDS: string[] = []
const EMPTY_MASTERY_BY_UID: NonNullable<MindMapEditorSurfaceProps['masteryByNodeUid']> = {}
const EMPTY_SEGMENT_RANGE_DRAFT: NonNullable<MindMapEditorSurfaceProps['segmentRangeDraft']> = {
  active: false,
  targetSegmentId: null,
  selectedNodeUids: [],
  overriddenConflictNodeUids: [],
}

export const MindMapEditorSurface = forwardRef<MindMapEditorSurfaceHandle, MindMapEditorSurfaceProps>(function MindMapEditorSurface({
  editorState,
  capabilities: providedCapabilities,
  readonly = false,
  practiceModeActive = false,
  presentationStrategy = detectClientSource() === 'pwa' ? 'viewport-only' : 'native-preferred',
  aiSplitBusy = false,
  externalSyncKey = null,
  forceSyncKey = null,
  preserveViewOnSync = false,
  mobileViewPolicy = 'auto',
  nodeClickViewportPolicy,
  contentChangeViewportPolicy,
  className,
  sceneChrome = 'default',
  sceneTransitionKey = null,
  toolbarContent,
  segments = EMPTY_SEGMENTS,
  activeSegmentId = null,
  segmentColorMode = 'all',
  segmentRangeDraft = EMPTY_SEGMENT_RANGE_DRAFT,
  highlightedNodeUids = EMPTY_UIDS,
  ankiEditMode = false,
  mutedNodeUids = EMPTY_UIDS,
  masteryByNodeUid = EMPTY_MASTERY_BY_UID,
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
  // Hosts often pass inline lambdas; keep latest callbacks in refs so effects do not
  // re-fire (and nest setState) solely because the prop identity changed.
  const onNodeActiveRef = useRef(onNodeActive)
  const onReadyRef = useRef(onReady)
  const onUiClearedChangeRef = useRef(onUiClearedChange)
  // Action callbacks must not rebuild capabilities/graphData on timer ticks or parent re-renders.
  // Review hosts recreate these handlers every second when effectiveSeconds updates.
  const onNodeClickRef = useRef(onNodeClick)
  const onNodeContextMenuRef = useRef(onNodeContextMenu)
  const onAiSplitRequestRef = useRef(onAiSplitRequest)
  const onCreateSegmentFromSelectionRef = useRef(onCreateSegmentFromSelection)
  const onSegmentRangeDraftChangeRef = useRef(onSegmentRangeDraftChange)
  const handledFocusRequestNonceRef = useRef(0)
  onNodeActiveRef.current = onNodeActive
  onReadyRef.current = onReady
  onUiClearedChangeRef.current = onUiClearedChange
  onNodeClickRef.current = onNodeClick
  onNodeContextMenuRef.current = onNodeContextMenu
  onAiSplitRequestRef.current = onAiSplitRequest
  onCreateSegmentFromSelectionRef.current = onCreateSegmentFromSelection
  onSegmentRangeDraftChangeRef.current = onSegmentRangeDraftChange
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
  const editorConfig = editorState.editor_config
  const editorLocalConfig = editorState.editor_local_config
  const editorLang = editorState.lang
  // Depend on document/config pieces, not the whole editorState object — hosts often
  // pass a fresh shell every render while editor_doc stays referentially stable.
  const normalizedEditorDoc = useMemo(
    () => normalizeEditorDocTree(editorDoc),
    [editorDoc],
  )
  const normalizedEditorState = useMemo<MindMapEditorState>(
    () => ({
      editor_doc: normalizedEditorDoc,
      editor_config: editorConfig ?? {},
      editor_local_config: editorLocalConfig ?? {},
      lang: editorLang || 'zh',
    }),
    [editorConfig, editorLang, editorLocalConfig, normalizedEditorDoc],
  )
  const revealMap = useMemo(() => collectRevealMap(normalizedEditorState), [normalizedEditorState])
  const capabilities = useMemo(
    () => providedCapabilities ?? createMindMapCapabilities({
      segments,
      activeSegmentId,
      segmentColorMode,
      segmentRangeDraft,
      highlightedNodeUids,
      mutedNodeUids,
      masteryByNodeUid,
      statusChipsByNodeUid,
      countBadgeByNodeUid,
      practiceModeActive,
      revealMap: practiceModeActive ? revealMap : undefined,
      aiSplitBusy,
      onAiSplitRequest: (payload) => onAiSplitRequestRef.current?.(payload),
      onCreateSegmentFromSelection: () => onCreateSegmentFromSelectionRef.current?.(),
      onSegmentRangeDraftChange: (payload) => onSegmentRangeDraftChangeRef.current?.(payload),
      onNodeClick: (nodes) => onNodeClickRef.current?.(nodes),
      onNodeContextMenu: (nodes) => onNodeContextMenuRef.current?.(nodes),
        }),
    [
      activeSegmentId, aiSplitBusy, countBadgeByNodeUid, highlightedNodeUids, masteryByNodeUid,
      mutedNodeUids, practiceModeActive, providedCapabilities, revealMap, segmentColorMode,
      segmentRangeDraft, segments, statusChipsByNodeUid,
    ],
  )
  const graphOptions = useMemo(() => mergeMindMapGraphOptions(capabilities), [capabilities])
  // Content signature absorbs shallow-new decoration objects with identical payload
  // (e.g. empty mastery maps recreated each render in review).
  const graphOptionsSignature = useMemo(() => JSON.stringify(graphOptions), [graphOptions])
  const graphData = useMemo(
    () =>
      editorDocToGraph(normalizedEditorState.editor_doc, {
        ...graphOptions,
        ankiEditMode,
        readonly,
      }),
    // graphOptions is read from the latest closure when signature changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signature tracks decoration content
    [ankiEditMode, graphOptionsSignature, normalizedEditorState.editor_doc, readonly],
  )
  // Host remounts only on intentional document-identity changes.
  // Mode switches (build/learn, flip syncReason, preserveView flag) must not rebuild ReactFlow.
  const canvasRecoveryKey = useMemo(() => {
    if (forceSyncKey != null && String(forceSyncKey) !== '') return String(forceSyncKey)
    if (preserveViewOnSync) return ''
    return String(externalSyncKey ?? '')
  }, [externalSyncKey, forceSyncKey, preserveViewOnSync])

  useEffect(() => {
    onReadyRef.current?.()
  }, [])

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
    onUiClearedChangeRef.current?.(uiCleared)
  }, [uiCleared])

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
      onNodeActiveRef.current?.([])
      return
    }
    const primaryId =
      selectedNodeId && nextIds.includes(selectedNodeId)
        ? selectedNodeId
        : nextIds[nextIds.length - 1]!
    replaceInteraction(selectedInteraction(primaryId, nextIds))
    onNodeActiveRef.current?.(buildSelectionFromDoc(getCurrentEditorDoc(), primaryId))
  }, [
    getCurrentEditorDoc,
    graphData.nodes,
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
      if (current.mode === 'editing' && current.nodeId === nodeId) {
        // Re-assert editing so a desynced card (e.g. after yellow-emphasis double-click
        // races) remounts the editor instead of silently no-oping.
        replaceInteraction({ ...current })
        return
      }
      if (current.mode === 'editing' && current.nodeId !== nodeId) commitEditingDraft()
      const editorDoc = getCurrentEditorDoc()
      const selection = buildSelectionFromDoc(editorDoc, nodeId)
      // Prefer stored markup (yellow emphasis HTML) so double-click edit keeps highlights.
      const stored = getEditorDocStoredText(editorDoc, nodeId).trim()
      const text = stored || selection[0]?.text || '未命名知识点'
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
      // Skip redundant select→re-render on the second click of a double-click;
      // remounting yellow-emphasis markup mid-gesture can drop the dblclick event.
      if (
        !options?.additive &&
        current.mode === 'selected' &&
        current.primaryId === nodeId &&
        current.nodeIds.length === 1 &&
        current.nodeIds[0] === nodeId
      ) {
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
      onNodeActiveRef.current?.(buildSelectionFromDoc(getCurrentEditorDoc(), nodeUid))
      if (!nodeUid) return
      viewCommandNonceRef.current += 1
      setViewCommand({
        type: 'center',
        nodeId: nodeUid,
        nonce: viewCommandNonceRef.current,
      })
    },
    [commitEditingDraft, getCurrentEditorDoc, replaceInteraction],
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

  // Each focusRequestNonce must run at most once. Including requestFocusNode in deps is
  // unsafe: hosts pass unstable onNodeActive, which used to recreate requestFocusNode and
  // re-enter this effect, nesting setViewCommand until React #185 (max update depth).
  useEffect(() => {
    if (!focusRequestNodeUid || focusRequestNonce <= 0) return
    if (handledFocusRequestNonceRef.current === focusRequestNonce) return
    handledFocusRequestNonceRef.current = focusRequestNonce
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
  // Scene identity for center-card re-anchor across edit/review/practice/rating.
  const resolvedSceneTransitionKey =
    sceneTransitionKey
    ?? `${sceneChrome}:${readonly ? 'ro' : 'rw'}:${practiceModeActive ? 'practice' : 'plain'}`
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
    handleHighlightNodes,
    handleToggleQuestionCards,
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
        sceneTransitionKey={resolvedSceneTransitionKey}
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
        onDeleteNodes={handleDeleteNodes}
        onDeleteNodeOnly={handleDeleteNodeOnly}
        onHighlightNodes={handleHighlightNodes}
        onToggleQuestionCards={handleToggleQuestionCards}
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
