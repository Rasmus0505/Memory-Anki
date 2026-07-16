import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from '@/shared/feedback/toast'
import type { MindMapSelection } from '@/entities/mindmap-document'
import type { ImportApplyContext } from '@/shared/api/contracts/imports'
import type { MindMapAiSplitRequestPayload } from '@/shared/ui/mindmap-canvas/capabilities'
import type { MindMapFeedbackEvent, MindMapFeedbackFxPayload } from '@/shared/feedback/feedbackEvents'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { useGlobalTimerRegistration } from '@/shared/components/session/GlobalTimerProvider'
import { parseMindMapDoc } from '@/features/palace-edit/model/mindmap-editor'
import { usePalaceEditorDocument } from '@/features/palace-edit/hooks/usePalaceEditorDocument'
import { usePalaceMetaController } from '@/features/palace-edit/hooks/usePalaceMetaController'
import { usePalacePracticeMode } from '@/features/palace-edit/hooks/usePalacePracticeMode'
import { usePalaceSegmentsController } from '@/features/palace-edit/hooks/usePalaceSegmentsController'
import { usePalaceVersionsController } from '@/features/palace-edit/hooks/usePalaceVersionsController'
import type { StatusBadgeState } from '@/features/palace-edit/model/palace-edit-types'
import { getEnglishContinueCourseApi } from '@/entities/english/api'
import type { MindMapDoc, MindMapEditorState } from '@/shared/api/contracts'
import { useMemoryAnkiShortcuts } from '@/entities/preferences/model/memoryAnkiShortcuts'
import { useAiSplitWorkbench } from '@/features/palace-edit/hooks/useAiSplitWorkbench'
export type { PalaceMeta } from '@/features/palace-edit/model/palace-edit-types'

function readSelectionNodeUid(nodes: MindMapSelection[]) {
  const node = nodes[0] ?? null
  return node?.uid ? String(node.uid) : null
}

export function usePalaceEditPage() {
  const { isActive, becameActiveAt, fullPath } = useRouteResidency()
  const { id } = useParams()
  const navigate = useNavigate()
  const palaceId = id ? Number(id) : null
  const [replaceSyncVersion, setReplaceSyncVersion] = useState(0)
  const [selectedNodes, setSelectedNodes] = useState<MindMapSelection[]>([])
  const [modeFocusRequest, setModeFocusRequest] = useState<{
    nodeUid: string | null
    nonce: number
  }>({ nodeUid: null, nonce: 0 })
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)
  const [aiSplitAppliedSyncVersion, setAiSplitAppliedSyncVersion] = useState(0)
  const [feedbackFxSignal, setFeedbackFxSignal] = useState<MindMapFeedbackFxPayload | null>(null)
  const hardUnloadRef = useRef(false)
  const feedbackFxNonceRef = useRef(0)
  const selectedNodeUidRef = useRef<string | null>(null)
  const documentStateRef = useRef<ReturnType<typeof usePalaceEditorDocument> | null>(null)
  const selectedNodesRef = useRef<MindMapSelection[]>([])

  const timer = useTimedSession({
    kind: 'palace_edit',
    title: '未命名宫殿',
    palaceId,
    persistKey: palaceId ? `palace_edit:${palaceId}` : null,
  })
  const timerRef = useRef(timer)

  const documentState = usePalaceEditorDocument({
    palaceId,
    setReplaceSyncVersion,
  })
  documentStateRef.current = documentState
  selectedNodesRef.current = selectedNodes
  const palace = documentState.meta
  const palaceTitle = palace?.title || '未命名宫殿'
  const selectedNode = selectedNodes[0] ?? null
  const selectedNodeUid = selectedNode?.uid ? String(selectedNode.uid) : null
  const parsedEditorDoc = useMemo(
    () => parseMindMapDoc(documentState.editorState?.editor_doc ?? null),
    [documentState.editorState?.editor_doc],
  )

  const meta = usePalaceMetaController({
    palace,
    reload: documentState.reload,
    timer,
  })
  useGlobalTimerRegistration({
    scene: 'palace_edit',
    title: meta.title || palaceTitle,
    timer,
    isRouteActive: isActive,
    becameActiveAt,
    routePath: fullPath,
  })

  const practice = usePalacePracticeMode({
    palaceId,
    editorState: documentState.editorState,
    title: meta.title || palaceTitle,
    timer,
  })

  const segments = usePalaceSegmentsController({
    palaceId,
    palace,
    parsedEditorDoc,
    selectedNodes,
    timer,
  })

  const versions = usePalaceVersionsController({
    palaceId,
    palace,
    editorStateLoaded: Boolean(documentState.editorState),
    saveError: documentState.error,
    isSaving: documentState.isSaving,
    reload: documentState.reload,
    onAfterRestore: () => setReplaceSyncVersion((value) => value + 1),
  })

  useEffect(() => {
    selectedNodeUidRef.current = selectedNodeUid
  }, [selectedNodeUid])

  const queueModeFocusRequest = useCallback((nodeUid: string | null = selectedNodeUidRef.current) => {
    setModeFocusRequest((current) => ({
      nodeUid,
      nonce: current.nonce + 1,
    }))
  }, [])

  const enterInlinePractice = useCallback(() => {
    queueModeFocusRequest()
    practice.enterInlinePractice()
  }, [practice, queueModeFocusRequest])

  const exitInlinePractice = useCallback(() => {
    queueModeFocusRequest()
    practice.exitInlinePractice()
  }, [practice, queueModeFocusRequest])

  const toggleInlinePractice = useCallback(() => {
    queueModeFocusRequest()
    practice.toggleInlinePractice()
  }, [practice, queueModeFocusRequest])

  const handleMindMapNodeActive = useCallback((nodes: MindMapSelection[]) => {
    selectedNodeUidRef.current = readSelectionNodeUid(nodes)
    setSelectedNodes(nodes)
  }, [])

  const handleInlinePracticeNodeClick = useCallback((nodes: MindMapSelection[]) => {
    if (practice.editorMode === 'recall') {
      selectedNodeUidRef.current = readSelectionNodeUid(nodes)
      setSelectedNodes(nodes)
    }
    practice.handleInlinePracticeNodeClick(nodes)
  }, [practice])

  const handleInlinePracticeNodeContextMenu = useCallback((nodes: MindMapSelection[]) => {
    if (practice.editorMode === 'recall') {
      selectedNodeUidRef.current = readSelectionNodeUid(nodes)
      setSelectedNodes(nodes)
    }
    practice.handleInlinePracticeNodeContextMenu(nodes)
  }, [practice])

  const emitFeedbackFx = useCallback(
    (
      type: MindMapFeedbackEvent,
      options: {
        nodeUid?: string | null
        relatedNodeUids?: string[]
        lineMode?: MindMapFeedbackFxPayload['lineMode']
        intensity?: MindMapFeedbackFxPayload['intensity']
        source?: string
      } = {},
    ) => {
      feedbackFxNonceRef.current += 1
      setFeedbackFxSignal({
        type,
        nodeUid: options.nodeUid ?? selectedNode?.uid ?? null,
        relatedNodeUids:
          options.relatedNodeUids ??
          (selectedNode?.uid ? [String(selectedNode.uid)] : []),
        intensity: options.intensity ?? 'full',
        lineMode: options.lineMode ?? 'confirm',
        source: options.source,
        nonce: feedbackFxNonceRef.current,
      })
    },
    [selectedNode?.uid],
  )

  const handleMindMapEditorStateChange = useCallback(
    (nextState: MindMapEditorState) => {
      documentState.handleMindMapEditorStateChange(nextState, () => {
        timerRef.current.registerActivity('edit_operation', { source: 'mind_map_edit' })
      })
    },
    [documentState],
  )

  const handleShortcutHideChildCards = useCallback(() => {
    if (practice.editorMode !== 'recall') return
    const node = selectedNode
    if (!node?.uid) {
      toast.info('请先选中一个知识点，再隐藏子级知识点。')
      return
    }
    practice.handleInlinePracticeNodeContextMenu([node])
  }, [practice, selectedNode])

  const shortcutHandlers = useMemo(
    () => ({
      hide_child_cards_practice: handleShortcutHideChildCards,
    }),
    [handleShortcutHideChildCards],
  )

  useMemoryAnkiShortcuts(
    practice.editorMode === 'edit' ? 'edit' : 'practice',
    shortcutHandlers,
    Boolean(documentState.editorState),
  )

  const handleCreateBlankPalace = useCallback(async (options: { title: string; subjectIds: number[] }) => {
    if (palaceId || id !== undefined || documentState.isCreatingDraft) return
    documentState.setIsCreatingDraft(true)
    try {
      const createdId = await documentState.createDraftPalace(options)
      navigate(`/palaces/${createdId}/edit`, { replace: true })
    } catch (error) {
      documentState.setIsCreatingDraft(false)
      toast.error(error instanceof Error ? error.message : '创建宫殿失败，请稍后重试。')
    }
  }, [documentState, id, navigate, palaceId])

  useEffect(() => {
    if (!palaceId || !documentState.editorState) return
    if (!isActive) return
    if (timer.status !== 'idle') return
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig(), 'palace_edit')) return
    timer.start({ source: 'page_enter' })
  }, [documentState.editorState, isActive, palaceId, timer])

  useEffect(() => {
    timer.setSceneActive?.(isActive, { source: isActive ? 'route_active' : 'route_inactive' })
  }, [isActive, timer])

  useEffect(() => {
    timerRef.current = timer
  }, [timer])

  useEffect(() => {
    if (isActive) return
    setMindMapFullscreen(false)
  }, [isActive])

  useEffect(() => {
    const markHardUnload = () => {
      hardUnloadRef.current = true
    }
    const confirmUnsavedBeforeUnload = (event: BeforeUnloadEvent) => {
      markHardUnload()
      if (!documentState.hasUnsavedChanges && !documentState.isSaving) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', confirmUnsavedBeforeUnload)
    window.addEventListener('pagehide', markHardUnload)
    return () => {
      window.removeEventListener('beforeunload', confirmUnsavedBeforeUnload)
      window.removeEventListener('pagehide', markHardUnload)
    }
  }, [documentState.hasUnsavedChanges, documentState.isSaving])

  useEffect(() => {
    return () => {
      if (hardUnloadRef.current) return
    }
  }, [])

  useEffect(() => {
    if (!mindMapFullscreen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mindMapFullscreen])

  useEffect(() => {
    if (!mindMapFullscreen) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.fullscreenElement) return
      event.preventDefault()
      event.stopPropagation()
      setMindMapFullscreen(false)
    }
    window.addEventListener('keydown', handleEscape, true)
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
    }
  }, [mindMapFullscreen])

  const toggleMindMapFullscreen = useCallback(
    (active?: boolean) => {
      timer.registerActivity('edit_operation', { source: 'mind_map_immersive_toggle' })
      emitFeedbackFx('mode_switch', { source: 'mind_map_immersive_toggle' })
      setMindMapFullscreen((current) => (typeof active === 'boolean' ? active : !current))
    },
    [emitFeedbackFx, timer],
  )

  const handleOpenEnglishArea = useCallback(async () => {
    try {
      const result = await getEnglishContinueCourseApi()
      if (result.course?.id) {
        navigate(`/english/courses/${result.course.id}`)
        return
      }
      navigate('/english')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打开英语听力失败，请稍后再试。')
    }
  }, [navigate])

  const aiSplitWorkbench = useAiSplitWorkbench({
    palaceId,
    navigateTarget: fullPath || (palaceId ? `/palaces/${palaceId}` : undefined),
    getLatestEditorState: () => documentStateRef.current?.editorState ?? null,
    getCurrentSelectedUid: () => {
      const node = selectedNodesRef.current[0]
      return node?.uid ? String(node.uid) : null
    },
    getCurrentSelectedLabel: () => {
      const node = selectedNodesRef.current[0]
      return node?.text ? String(node.text) : ''
    },
    applyEditorDoc: (nextDoc) => {
      const latest = documentStateRef.current?.editorState
      if (!latest) return
      setAiSplitAppliedSyncVersion((value) => value + 1)
      documentStateRef.current?.setEditorState({
        ...latest,
        editor_doc: nextDoc,
      })
    },
    onApplied: ({ mode, nodeCount }) => {
      timer.registerActivity('edit_operation', { source: 'mindmap_ai_split_applied' })
      emitFeedbackFx('node_create', {
        nodeUid: selectedNodeUidRef.current,
        relatedNodeUids: selectedNodeUidRef.current ? [selectedNodeUidRef.current] : [],
        source: mode === 'replace' ? 'mindmap_ai_split_replace' : 'mindmap_ai_split_append',
      })
      void nodeCount
    },
  })

  const handleAiSplitRequest = useCallback(
    async (payload: MindMapAiSplitRequestPayload) => {
      if (practice.editorMode !== 'edit' || !palaceId || !documentState.editorState) return
      if (!payload.target_node_uid) {
        toast.error('请先选中要分卡的目标节点。')
        return
      }
      timer.registerActivity('edit_operation', { source: 'mindmap_ai_split_open' })
      const editorDoc = documentState.editorState.editor_doc as MindMapDoc
      await aiSplitWorkbench.openWorkbench({
        targetNodeUid: payload.target_node_uid,
        targetNodeText: payload.target_node_text || '',
        targetNodeNote: payload.target_node_note || '',
        editorDoc,
      })
    },
    [aiSplitWorkbench, documentState.editorState, palaceId, practice.editorMode, timer],
  )

  const statusBadge: StatusBadgeState = versions.statusBadge

  return {
    aiSplitWorkbench,
    palaceId,
    palace,
    reload: documentState.reload,
    timer,
    title: meta.title,
    setTitle: meta.setTitle,
    createdAt: meta.createdAt,
    setCreatedAt: meta.setCreatedAt,
    editorMode: practice.editorMode,
    enterPreview: practice.enterPreview,
    versionOpen: versions.versionOpen,
    setVersionOpen: versions.setVersionOpen,
    mindMapFullscreen,
    setMindMapFullscreen,
    toggleMindMapFullscreen,
    handleOpenEnglishArea,
    versions: versions.versions,
    removedDuplicateCount: versions.removedDuplicateCount,
    previewingVersionId: versions.previewingVersionId,
    previewVersionDetail: versions.previewVersionDetail,
    previewLoading: versions.previewLoading,
    previewError: versions.previewError,
    segments: segments.segments,
    segmentDialogOpen: segments.segmentDialogOpen,
    setSegmentDialogOpen: segments.setSegmentDialogOpen,
    segmentName: segments.segmentName,
    setSegmentName: segments.setSegmentName,
    segmentColor: segments.segmentColor,
    setSegmentColor: segments.setSegmentColor,
    segmentCreatedAt: segments.segmentCreatedAt,
    setSegmentCreatedAt: segments.setSegmentCreatedAt,
    editingSegmentId: segments.editingSegmentId,
    activeSegmentId: segments.activeSegmentId,
    setActiveSegmentId: segments.setActiveSegmentId,
    activeSegment: segments.activeSegment,
    segmentSaving: segments.segmentSaving,
    segmentMergingId: segments.segmentMergingId,
    segmentError: segments.segmentError,
    isSegmentRangeMode: segments.isSegmentRangeMode,
    rangeTargetSegmentId: segments.rangeTargetSegmentId,
    selectedRangeNodeUids: segments.selectedRangeNodeUids,
    overriddenConflictNodeUids: segments.overriddenConflictNodeUids,
    selectedRangeNodeCount: segments.selectedRangeNodeCount,
    currentRangeTargetSegment: segments.currentRangeTargetSegment,
    subtreeUidMap: segments.subtreeUidMap,
    editorState: documentState.editorState,
    applyImportedPalaceEditorState: documentState.applyImportedPalaceEditorState as (
      nextState: MindMapEditorState,
      context?: ImportApplyContext,
    ) => Promise<void>,
    activeMindMapEditorState: practice.activeMindMapEditorState,
    practiceVisibleEditorSyncKey: practice.practiceVisibleEditorSyncKey,
    modeFocusRequestNodeUid: modeFocusRequest.nodeUid,
    modeFocusRequestNonce: modeFocusRequest.nonce,
    replaceSyncVersion,
    selectedNodes,
    selectedNode,
    feedbackFxSignal,
    reviewFxSignal: practice.feedback.reviewFxSignal,
    setSelectedNodes,
    handleMindMapNodeActive,
    setEditorState: documentState.setEditorState,
    hasUnsavedChanges: documentState.hasUnsavedChanges,
    saveStatus: documentState.saveStatus,
    saveError: documentState.error,
    isLoadError: documentState.isLoadError,
    isCreatingDraft: documentState.isCreatingDraft,
    handleCreateBlankPalace,
    handleMindMapEditorStateChange,
    aiSplitBusy: aiSplitWorkbench.phase === 'generating',
    aiSplitAppliedSyncVersion,
    handleSaveMeta: meta.handleSaveMeta,
    handleEstablishCreatedAt: meta.handleEstablishCreatedAt,
    handleAttachmentUpload: meta.handleAttachmentUpload,
    handleAttachmentDelete: meta.handleAttachmentDelete,
    enterInlinePractice,
    exitInlinePractice,
    toggleInlinePractice,
    handleInlinePracticeNodeClick,
    handleInlinePracticeNodeContextMenu,
    handleAiSplitRequest,
    restartInlinePractice: practice.restartInlinePractice,
    handleOpenVersions: versions.handleOpenVersions,
    handleOpenCreateSegment: segments.handleOpenCreateSegment,
    handleOpenEditSegment: segments.handleOpenEditSegment,
    handleAdjustSegmentRange: segments.handleAdjustSegmentRange,
    handleSegmentRangeModeToggle: segments.handleSegmentRangeModeToggle,
    handleSegmentRangeDraftChange: segments.handleSegmentRangeDraftChange,
    handleSegmentRangeNodeClick: segments.handleSegmentRangeNodeClick,
    handleConfirmSegmentRange: segments.handleConfirmSegmentRange,
    handleSaveSegment: segments.handleSaveSegment,
    handleToggleSegmentPractice: segments.handleToggleSegmentPractice,
    handleDeleteSegment: segments.handleDeleteSegment,
    handleMergeSegment: segments.handleMergeSegment,
    handlePreviewVersion: versions.handlePreviewVersion,
    handleCloseVersions: versions.handleCloseVersions,
    handleRestoreVersion: versions.handleRestoreVersion,
    resetVersionPreview: versions.resetVersionPreview,
    statusBadge,
  }
}
