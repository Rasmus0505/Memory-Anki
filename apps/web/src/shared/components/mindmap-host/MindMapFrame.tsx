import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Brain, FolderTree, Scissors, Sparkles, Target } from 'lucide-react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { MindMapCanvas } from '@/shared/components/mindmap'
import type { MindMapCanvasViewCommand } from '@/shared/components/mindmap'
import type { ContextMenuAction } from '@/shared/components/mindmap/NodeContextMenu'
import {
  addEditorDocChild,
  addEditorDocSibling,
  buildSelectionFromDoc,
  canMoveEditorDocNode,
  deleteEditorDocNode,
  editEditorDocNode,
  editorDocToGraph,
  moveEditorDocNode,
  normalizeEditorDocTree,
  reparentEditorDocNode,
  reorderEditorDocNode,
} from '@/shared/components/mindmap/editorDocAdapter'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import {
  buildMindMapFrameClassName,
  type MindMapFrameHandle,
  type MindMapFrameProps,
} from './MindMapFrame.types'

export const MindMapFrame = forwardRef<MindMapFrameHandle, MindMapFrameProps>(function MindMapFrame({
  editorState,
  readonly = false,
  practiceModeActive = false,
  immersiveModeActive = false,
  aiSplitBusy = false,
  syncReason = null,
  externalSyncKey = null,
  forceSyncKey = null,
  mobileViewPolicy = 'auto',
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
  onReady,
}: MindMapFrameProps, ref) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
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
        miniPalaceDraft,
        revealMap: practiceModeActive ? revealMap : undefined,
        readonly,
      }),
    [
      activeSegmentId,
      focusNodeUids,
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
        externalSyncKey ?? '',
        forceSyncKey ?? '',
        graphData.nodes.length,
        graphData.edges.length,
      ].join(':'),
    [externalSyncKey, forceSyncKey, graphData.edges.length, graphData.nodes.length, syncReason],
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

  const emitState = useCallback(
    (nextEditorDoc: MindMapEditorState['editor_doc']) => {
      if (readonly) return
      onEditorStateChange({
        ...normalizedEditorState,
        editor_doc: nextEditorDoc,
      })
    },
    [normalizedEditorState, onEditorStateChange, readonly],
  )

  const selectNode = useCallback(
    (nodeId: string | null) => {
      setSelectedNodeId(nodeId)
      onNodeActive?.(buildSelectionFromDoc(normalizedEditorState.editor_doc, nodeId))
    },
    [normalizedEditorState.editor_doc, onNodeActive],
  )

  const requestFocusNode = useCallback(
    (nodeUid: string | null) => {
      setSelectedNodeId(nodeUid)
      onNodeActive?.(buildSelectionFromDoc(normalizedEditorState.editor_doc, nodeUid))
      if (!nodeUid) return
      viewCommandNonceRef.current += 1
      setViewCommand({
        type: 'center',
        nodeId: nodeUid,
        nonce: viewCommandNonceRef.current,
      })
    },
    [normalizedEditorState.editor_doc, onNodeActive],
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
      if (!readonly && !practiceModeActive) {
        actions.push({
          label: '添加子知识点',
          icon: Scissors,
          onClick: () => emitState(addEditorDocChild(normalizedEditorState.editor_doc, nodeId)),
        })
      }
      return actions
    },
    [
      aiSplitBusy,
      emitState,
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
  const frameClassName = buildMindMapFrameClassName(className)
  const canvas = (
    <MindMapCanvas
      graphData={graphData}
      selectedNodeId={selectedNodeId}
      readonly={!canEdit}
      practiceModeActive={practiceModeActive}
      focusMode={nativeFullscreenActive || immersiveModeActive}
      showToolbar={!uiCleared}
      mobileViewPolicy={mobileViewPolicy}
      viewCommand={viewCommand}
      recoveryKey={canvasRecoveryKey}
      onNodeSelect={selectNode}
      onNodeActivate={activateNode}
      onNodeContextAction={contextNode}
      onNodeHover={hoverNode}
      buildNodeActions={buildNodeActions}
      onAddChild={(nodeId) => emitState(addEditorDocChild(normalizedEditorState.editor_doc, nodeId))}
      onAddSibling={(nodeId) => emitState(addEditorDocSibling(normalizedEditorState.editor_doc, nodeId))}
      onDelete={(nodeId) => emitState(deleteEditorDocNode(normalizedEditorState.editor_doc, nodeId))}
      onEdit={(nodeId, text) => emitState(editEditorDocNode(normalizedEditorState.editor_doc, nodeId, text))}
      onReparent={(sourceId, targetId) => emitState(reparentEditorDocNode(normalizedEditorState.editor_doc, sourceId, targetId))}
      onReorderSibling={(sourceId, targetId, position) =>
        emitState(reorderEditorDocNode(normalizedEditorState.editor_doc, sourceId, targetId, position))
      }
      onMoveUp={(nodeId) => emitState(moveEditorDocNode(normalizedEditorState.editor_doc, nodeId, 'up'))}
      onMoveDown={(nodeId) => emitState(moveEditorDocNode(normalizedEditorState.editor_doc, nodeId, 'down'))}
      canMoveUp={(nodeId) => canMoveEditorDocNode(normalizedEditorState.editor_doc, nodeId, 'up')}
      canMoveDown={(nodeId) => canMoveEditorDocNode(normalizedEditorState.editor_doc, nodeId, 'down')}
      onToggleFocusMode={toggleCanvasFullscreen}
      className="h-full min-h-0 w-full border-0 bg-transparent shadow-none"
    />
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
