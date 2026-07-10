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
import { createPortal } from 'react-dom'
import { Brain, FolderTree, Sparkles, Target } from 'lucide-react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { MindMapCanvas } from '@/shared/components/mindmap'
import type { MindMapCanvasViewCommand } from '@/shared/components/mindmap'
import type { ContextMenuAction } from '@/shared/components/mindmap/NodeContextMenu'
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
} from '@/shared/components/mindmap/editorDocAdapter'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import { toast } from '@/shared/feedback/toast'
import {
  buildMindMapFrameClassName,
  type MindMapFrameHandle,
  type MindMapFrameProps,
} from './MindMapFrame.types'
import { useMindMapEditHistory } from './useMindMapEditHistory'

type MindMapInteractionState =
  | { mode: 'idle' }
  | { mode: 'selected'; nodeId: string }
  | {
      mode: 'editing'
      nodeId: string
      originalText: string
      draftText: string
    }

export const MindMapFrame = forwardRef<MindMapFrameHandle, MindMapFrameProps>(function MindMapFrame({
  editorState,
  readonly = false,
  practiceModeActive = false,
  immersiveModeActive = false,
  aiSplitBusy = false,
  syncReason = null,
  externalSyncKey = null,
  forceSyncKey = null,
  preserveViewOnSync = false,
  mobileViewPolicy = 'auto',
  nodeClickViewportPolicy,
  contentChangeViewportPolicy,
  className,
  segments = [],
  activeSegmentId = null,
  segmentColorMode = 'all',
  segmentRangeDraft = {
    active: false,
    targetSegmentId: null,
    selectedNodeUids: [],
    overriddenConflictNodeUids: [],
  },
  focusNodeUids = [],
  highlightedNodeUids = [],
  masteryByNodeUid = {},
  focusRequestNodeUid = null,
  focusRequestNonce = 0,
  miniPalaceDraft = {
    active: false,
    selectedNodeUids: [],
  },
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
  onMiniPalacePour,
  onReady,
}: MindMapFrameProps, ref) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [interaction, setInteraction] = useState<MindMapInteractionState>({ mode: 'idle' })
  const interactionRef = useRef<MindMapInteractionState>(interaction)
  const selectedNodeId = interaction.mode === 'idle' ? null : interaction.nodeId
  const editingNodeId = interaction.mode === 'editing' ? interaction.nodeId : null
  const editingDraft = interaction.mode === 'editing' ? interaction.draftText : null
  const [uiCleared, setUiCleared] = useState(false)
  const [nativeFullscreenActive, setNativeFullscreenActive] = useState(false)
  const [viewCommand, setViewCommand] = useState<MindMapCanvasViewCommand | null>(null)
  const viewCommandNonceRef = useRef(0)
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
  const graphData = useMemo(
    () =>
      editorDocToGraph(normalizedEditorState.editor_doc, {
        segments,
        activeSegmentId,
        segmentColorMode,
        segmentRangeDraft,
        focusNodeUids,
        highlightedNodeUids,
        masteryByNodeUid,
        miniPalaceDraft,
        revealMap: practiceModeActive ? revealMap : undefined,
        readonly,
      }),
    [
      activeSegmentId,
      focusNodeUids,
      highlightedNodeUids,
      masteryByNodeUid,
      miniPalaceDraft,
      normalizedEditorState.editor_doc,
      practiceModeActive,
      readonly,
      revealMap,
      segmentColorMode,
      segmentRangeDraft,
      segments,
    ],
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

  const commitEditingDraft = useCallback(() => {
    const current = interactionRef.current
    if (current.mode !== 'editing') return
    const text = current.draftText.trim()
    if (text && text !== current.originalText) {
      commitEditorDoc(editEditorDocNode(getCurrentEditorDoc(), current.nodeId, text))
    }
    replaceInteraction({ mode: 'selected', nodeId: current.nodeId })
  }, [commitEditorDoc, getCurrentEditorDoc, replaceInteraction])

  const cancelEditing = useCallback(() => {
    const current = interactionRef.current
    if (current.mode !== 'editing') return
    replaceInteraction({ mode: 'selected', nodeId: current.nodeId })
  }, [replaceInteraction])

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

  const requestFitViewOnNextFrame = useCallback(() => {
    if (typeof window === 'undefined') return
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        requestFitView()
      })
    })
  }, [requestFitView])

  const enterNativeFullscreen = useCallback(async () => {
    setNativeFullscreenActive(true)
    onFullscreenChange?.(true)
    requestFitViewOnNextFrame()
  }, [onFullscreenChange, requestFitViewOnNextFrame])

  const exitNativeFullscreen = useCallback(async () => {
    setNativeFullscreenActive(false)
    onFullscreenChange?.(false)
    requestFitViewOnNextFrame()
  }, [onFullscreenChange, requestFitViewOnNextFrame])

  const toggleCanvasFullscreen = useCallback(() => {
    if (nativeFullscreenActive) {
      void exitNativeFullscreen()
      return
    }
    if (immersiveModeActive) {
      onFullscreenToggle?.(false)
    }
    void enterNativeFullscreen()
  }, [
    enterNativeFullscreen,
    exitNativeFullscreen,
    immersiveModeActive,
    nativeFullscreenActive,
    onFullscreenToggle,
  ])

  useEffect(() => {
    if (!nativeFullscreenActive) return
    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
    }
  }, [nativeFullscreenActive])

  useEffect(() => {
    if (!nativeFullscreenActive || typeof window === 'undefined') return
    const root = document.documentElement
    const previousHeight = root.style.getPropertyValue('--memory-anki-mindmap-fullscreen-height')
    const updateViewportHeight = () => {
      const height = window.visualViewport?.height ?? window.innerHeight
      root.style.setProperty('--memory-anki-mindmap-fullscreen-height', `${height}px`)
    }
    updateViewportHeight()
    window.visualViewport?.addEventListener('resize', updateViewportHeight)
    window.visualViewport?.addEventListener('scroll', updateViewportHeight)
    window.addEventListener('resize', updateViewportHeight)
    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewportHeight)
      window.visualViewport?.removeEventListener('scroll', updateViewportHeight)
      window.removeEventListener('resize', updateViewportHeight)
      if (previousHeight) {
        root.style.setProperty('--memory-anki-mindmap-fullscreen-height', previousHeight)
      } else {
        root.style.removeProperty('--memory-anki-mindmap-fullscreen-height')
      }
    }
  }, [nativeFullscreenActive])

  useEffect(() => {
    if (!nativeFullscreenActive) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      void exitNativeFullscreen()
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [exitNativeFullscreen, nativeFullscreenActive])

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
      const selected = selection[0] ?? null
      const actions: ContextMenuAction[] = []
      if (onAiSplitRequest && !readonly && !practiceModeActive) {
        actions.push({
          label: aiSplitBusy ? '正在整理知识点...' : 'AI 拆分知识点',
          icon: Sparkles,
          disabled: aiSplitBusy,
          onClick: () =>
            onAiSplitRequest({
              target_node_uid: selected?.uid ?? nodeId,
              target_node_text: selected?.text ?? '',
              target_node_note: selected?.note ?? '',
              target_node_type: selected?.memoryAnkiNodeType ?? null,
              is_root: graphData.nodes.find((node) => node.id === nodeId)?.parentId == null,
            }),
        })
      }
      if (segmentRangeDraft.active) {
        actions.push({
          label: '加入/移出当前学习组',
          icon: FolderTree,
          onClick: () => {
            const current = new Set(segmentRangeDraft.selectedNodeUids)
            if (current.has(nodeId)) {
              current.delete(nodeId)
            } else {
              current.add(nodeId)
            }
            onSegmentRangeDraftChange?.({
              selectedNodeUids: [...current],
              overriddenConflictNodeUids: segmentRangeDraft.overriddenConflictNodeUids,
            })
          },
        })
      }
      if (onCreateSegmentFromSelection && !readonly) {
        actions.push({
          label: '将选中内容组成学习组',
          icon: FolderTree,
          onClick: onCreateSegmentFromSelection,
        })
      }
      if (miniPalaceDraft.active) {
        actions.push({
          label: '选为专项训练知识点',
          icon: Target,
          onClick: () => onNodeClick?.(selection),
        })
      }
      if (practiceModeActive) {
        actions.push({
          label: '隐藏这个分支',
          icon: Brain,
          onClick: () => onNodeContextMenu?.(selection),
        })
      }
      return actions
    },
    [
      aiSplitBusy,
      graphData.nodes,
      miniPalaceDraft.active,
      normalizedEditorState.editor_doc,
      onAiSplitRequest,
      onCreateSegmentFromSelection,
      onNodeClick,
      onNodeContextMenu,
      onSegmentRangeDraftChange,
      practiceModeActive,
      readonly,
      segmentRangeDraft.active,
      segmentRangeDraft.overriddenConflictNodeUids,
      segmentRangeDraft.selectedNodeUids,
    ],
  )

  useImperativeHandle(
    ref,
    () => ({
      setUiCleared: setUiCleared,
      toggleUiCleared: () => setUiCleared((current) => !current),
      focusNode: requestFocusNode,
      fitView: requestFitView,
      enterNativeFullscreen,
      exitNativeFullscreen,
    }),
    [enterNativeFullscreen, exitNativeFullscreen, requestFitView, requestFocusNode],
  )

  const canEdit = !readonly && !practiceModeActive && !miniPalaceDraft.active
  const preservePracticeViewport = practiceModeActive && preserveViewOnSync
  const resolvedNodeClickViewportPolicy =
    nodeClickViewportPolicy ?? (preservePracticeViewport ? 'preserve' : 'guided-center')
  const resolvedContentChangeViewportPolicy =
    contentChangeViewportPolicy ?? (preservePracticeViewport ? 'preserve' : 'auto-fit')
  const frameClassName = buildMindMapFrameClassName(className)
  const handleAddChild = useCallback(
    (nodeId: string) => {
      const result = addEditorDocChildWithResult(getCurrentEditorDoc(), nodeId)
      if (!result.nodeUid || !commitEditorDoc(result.editorDoc)) return
      const selection = buildSelectionFromDoc(result.editorDoc, result.nodeUid)
      const text = selection[0]?.text || '新知识点'
      replaceInteraction({
        mode: 'editing',
        nodeId: result.nodeUid,
        originalText: text,
        draftText: text,
      })
      onNodeActive?.(selection)
    },
    [commitEditorDoc, getCurrentEditorDoc, onNodeActive, replaceInteraction],
  )
  const handleAddSibling = useCallback(
    (nodeId: string) => {
      const result = addEditorDocSiblingWithResult(getCurrentEditorDoc(), nodeId)
      if (!result.nodeUid || !commitEditorDoc(result.editorDoc)) return
      const selection = buildSelectionFromDoc(result.editorDoc, result.nodeUid)
      const text = selection[0]?.text || '新知识点'
      replaceInteraction({
        mode: 'editing',
        nodeId: result.nodeUid,
        originalText: text,
        draftText: text,
      })
      onNodeActive?.(selection)
    },
    [commitEditorDoc, getCurrentEditorDoc, onNodeActive, replaceInteraction],
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
      if (trimmed) commitEditorDoc(editEditorDocNode(getCurrentEditorDoc(), nodeId, trimmed))
      replaceInteraction({ mode: 'selected', nodeId })
    },
    [commitEditorDoc, getCurrentEditorDoc, replaceInteraction],
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
        handleAddChild(selectedNodeId)
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
      handleAddChild,
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

  const handleMiniPalacePour = useCallback(() => {
    if (miniPalaceDraft.active && onMiniPalacePour) {
      onMiniPalacePour()
      return
    }
    toggleCanvasFullscreen()
  }, [miniPalaceDraft.active, onMiniPalacePour, toggleCanvasFullscreen])

  const canvas = (
    <WidgetErrorBoundary label="思维导图">
      <MindMapCanvas
        graphData={graphData}
        selectedNodeId={selectedNodeId}
        editingNodeId={editingNodeId}
        editingDraft={editingDraft}
        readonly={!canEdit}
        practiceModeActive={practiceModeActive}
        focusMode={nativeFullscreenActive || immersiveModeActive}
        showToolbar={!uiCleared}
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
        onToggleFocusMode={handleMiniPalacePour}
        className="h-full min-h-0 w-full border-0 bg-transparent shadow-none"
      />
    </WidgetErrorBoundary>
  )
  const fullscreenLayer = nativeFullscreenActive
    ? createPortal(
        <div className="memory-anki-mindmap-native-fullscreen" data-testid="mindmap-frame-fullscreen-layer">
          {canvas}
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <div ref={frameRef} className={frameClassName} data-testid="mindmap-frame-native">
        {nativeFullscreenActive ? null : canvas}
      </div>
      {fullscreenLayer}
    </>
  )
})

MindMapFrame.displayName = 'MindMapFrame'

export type { MindMapFrameHandle } from './MindMapFrame.types'

function isEditableKeyboardTarget(target: HTMLElement | null) {
  if (!target) return false
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
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
