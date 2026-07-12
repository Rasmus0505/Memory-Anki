import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from '@/shared/feedback/toast'
import { useAiRunConfigDialog } from '@/entities/ai-runtime'
import type { MindMapSelection } from '@/entities/mindmap-document'
import type { ImportApplyContext } from '@/shared/api/contracts/imports'
import type { MindMapAiSplitRequestPayload } from '@/shared/ui/mindmap-canvas/capabilities'
import type { MindMapFeedbackEvent, MindMapFeedbackFxPayload } from '@/shared/feedback/feedbackEvents'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { useGlobalTimerRegistration } from '@/shared/components/session/GlobalTimerProvider'
import { logAiCall, requestOpenAiLogDetail } from '@/shared/logs/model/appLogs'
import { parseMindMapDoc } from '@/features/palace-edit/model/mindmap-editor'
import { usePalaceEditorDocument } from '@/features/palace-edit/hooks/usePalaceEditorDocument'
import { usePalaceMetaController } from '@/features/palace-edit/hooks/usePalaceMetaController'
import { usePalacePracticeMode } from '@/features/palace-edit/hooks/usePalacePracticeMode'
import { usePalaceSegmentsController } from '@/features/palace-edit/hooks/usePalaceSegmentsController'
import { usePalaceVersionsController } from '@/features/palace-edit/hooks/usePalaceVersionsController'
import type { StatusBadgeState } from '@/features/palace-edit/model/palace-edit-types'
import { splitMindMapNodeApi, togglePalaceFocusNodeApi } from '@/entities/palace/api'
import { getEnglishContinueCourseApi } from '@/entities/english/api'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { useMemoryAnkiShortcuts } from '@/entities/preferences/model/memoryAnkiShortcuts'
export type { ChapterOption, PalaceMeta } from '@/features/palace-edit/model/palace-edit-types'

function readSelectionNodeUid(nodes: MindMapSelection[]) {
  const node = nodes[0] ?? null
  return node?.uid ? String(node.uid) : null
}

export function usePalaceEditPage() {
  const { isActive, becameActiveAt, fullPath } = useRouteResidency()
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const palaceId = id ? Number(id) : null
  const [replaceSyncVersion, setReplaceSyncVersion] = useState(0)
  const [selectedNodes, setSelectedNodes] = useState<MindMapSelection[]>([])
  const [modeFocusRequest, setModeFocusRequest] = useState<{
    nodeUid: string | null
    nonce: number
  }>({ nodeUid: null, nonce: 0 })
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)
  const [aiSplitBusy, setAiSplitBusy] = useState(false)
  const [aiSplitAppliedSyncVersion, setAiSplitAppliedSyncVersion] = useState(0)
  const [focusNodeUids, setFocusNodeUids] = useState<string[]>([])
  const [feedbackFxSignal, setFeedbackFxSignal] = useState<MindMapFeedbackFxPayload | null>(null)
  const suppressNativeFullscreenExitUntilRef = useRef(0)
  const hardUnloadRef = useRef(false)
  const feedbackFxNonceRef = useRef(0)
  const selectedNodeUidRef = useRef<string | null>(null)
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()

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

  useEffect(() => {
    const nextFocusNodeUids = Array.isArray(palace?.focus_node_uids)
      ? palace.focus_node_uids.map((value) => String(value)).filter(Boolean)
      : []
    setFocusNodeUids(nextFocusNodeUids)
  }, [palace?.focus_node_uids])

  const handleMindMapEditorStateChange = useCallback(
    (nextState: MindMapEditorState) => {
      documentState.handleMindMapEditorStateChange(nextState, () => {
        timerRef.current.registerActivity('edit_operation', { source: 'mind_map_edit' })
      })
    },
    [documentState],
  )

  const toggleFocusNodeUid = useCallback(
    async (nodeUid: string, source: string) => {
      if (!palaceId || !nodeUid) return
      const previousFocusNodeUids = focusNodeUids
      const wasFocused = previousFocusNodeUids.includes(nodeUid)
      const optimisticFocusNodeUids = wasFocused
        ? previousFocusNodeUids.filter((uid) => uid !== nodeUid)
        : [...previousFocusNodeUids, nodeUid]
      setFocusNodeUids(optimisticFocusNodeUids)
      timer.registerActivity('edit_operation', { source })
      try {
        const response = await togglePalaceFocusNodeApi(palaceId, nodeUid, !wasFocused)
        setFocusNodeUids(response.focus_node_uids ?? optimisticFocusNodeUids)
        emitFeedbackFx(response.focused ? 'node_create' : 'node_delete', {
          nodeUid,
          relatedNodeUids: [nodeUid],
          source: 'toggle_focus_node',
        })
        toast.success(response.focused ? '已标记为专项卡' : '已取消专项卡标记')
      } catch (error) {
        setFocusNodeUids(previousFocusNodeUids)
        emitFeedbackFx('save_error', {
          nodeUid,
          relatedNodeUids: [nodeUid],
          source: 'toggle_focus_node_error',
        })
        toast.error(error instanceof Error ? error.message : '专项卡标记失败，请稍后重试。')
      }
    },
    [emitFeedbackFx, focusNodeUids, palaceId, timer],
  )

  const handleEditNodeContextMenu = useCallback(
    (nodes: MindMapSelection[]) => {
      if (practice.editorMode !== 'edit') return
      const nodeUid = nodes[0]?.uid ? String(nodes[0].uid) : ''
      if (!nodeUid) return
      void toggleFocusNodeUid(nodeUid, 'mindmap_focus_contextmenu')
    },
    [practice.editorMode, toggleFocusNodeUid],
  )

  const handleShortcutToggleFocusNode = useCallback(() => {
    if (practice.editorMode !== 'edit') return
    const nodeUid = selectedNode?.uid ? String(selectedNode.uid) : ''
    if (!nodeUid) {
      toast.info('请先选中一个知识点，再标记专项卡。')
      return
    }
    void toggleFocusNodeUid(nodeUid, 'shortcut_toggle_focus_node')
  }, [practice.editorMode, selectedNode?.uid, toggleFocusNodeUid])

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
      toggle_focus_node: handleShortcutToggleFocusNode,
      hide_child_cards_practice: handleShortcutHideChildCards,
    }),
    [handleShortcutHideChildCards, handleShortcutToggleFocusNode],
  )

  useMemoryAnkiShortcuts(
    practice.editorMode === 'edit' ? 'edit' : 'practice',
    shortcutHandlers,
    Boolean(documentState.editorState),
  )

  useEffect(() => {
    if (palaceId || documentState.isCreatingDraft) return
    if (id !== undefined) return
    documentState.setIsCreatingDraft(true)
    void documentState.requestDraftPalaceId(location.key).then((createdId) => {
      navigate(`/palaces/${createdId}/edit`, { replace: true })
    })
  }, [documentState, id, location.key, navigate, palaceId])

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
      if (active === true) {
        suppressNativeFullscreenExitUntilRef.current = Date.now() + 1500
      }
      setMindMapFullscreen((current) => (typeof active === 'boolean' ? active : !current))
    },
    [emitFeedbackFx, timer],
  )

  const handleMindMapNativeFullscreenChange = useCallback((active: boolean) => {
    if (active) return
    if (Date.now() < suppressNativeFullscreenExitUntilRef.current) return
    setMindMapFullscreen(false)
  }, [])

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

  const handleAiSplitRequest = useCallback(
    async (payload: MindMapAiSplitRequestPayload) => {
      if (practice.editorMode !== 'edit' || !palaceId || !documentState.editorState) return
      setAiSplitBusy(true)
      timer.registerActivity('edit_operation', { source: 'mindmap_ai_split' })
      const requestSummary = `知识点: ${payload.target_node_uid || 'unknown'}`
      logAiCall({
        feature: 'AI 整理',
        stage: 'start',
        requestSummary,
        meta: {
          palaceId,
          targetNodeUid: payload.target_node_uid,
        },
      })
      try {
        const aiOptions = await promptForAiOptions({
          scenarioKey: 'ai_split',
          entrypointKey: 'mindmap-ai-split',
          title: 'AI 整理配置',
        })
        if (!aiOptions) {
          return
        }
        const result = await splitMindMapNodeApi(palaceId, {
          editor_doc: documentState.editorState.editor_doc,
          target_node_uid: payload.target_node_uid,
          ai_options: aiOptions,
        })
        if (!result.ok || !result.editor_doc) {
          throw new Error(result.error || 'AI 整理失败，请稍后重试。')
        }
        logAiCall({
          feature: 'AI 整理',
          stage: 'success',
          requestSummary,
          responseSummary: `新增 ${result.generated_children_count ?? 0} 个分类，重归类 ${result.reassigned_existing_children_count ?? 0} 个旧知识点`,
          requestId:
            typeof (result as { request_id?: unknown }).request_id === 'string'
              ? (result as { request_id?: string }).request_id
              : '',
          meta: {
            palaceId,
            targetNodeUid: payload.target_node_uid,
            model: result.model ?? '',
            aiCallLogId: result.ai_call_log_id ?? '',
            requestId:
              typeof (result as { request_id?: unknown }).request_id === 'string'
                ? (result as { request_id?: string }).request_id
                : '',
          },
        })
        setAiSplitAppliedSyncVersion((value) => value + 1)
        documentState.setEditorState({
          ...documentState.editorState,
          editor_doc: result.editor_doc,
        })
        emitFeedbackFx('node_create', {
          nodeUid: payload.target_node_uid,
          relatedNodeUids: payload.target_node_uid ? [payload.target_node_uid] : [],
          source: 'mindmap_ai_split_success',
        })
        const generatedCount = result.generated_children_count ?? 0
        const movedCount = result.reassigned_existing_children_count ?? 0
        const reviewPreview = result.review_preview
        const reviewSummary = reviewPreview
          ? `预计形成 ${reviewPreview.node_count} 个知识点，约 ${reviewPreview.estimated_review_time || `${Math.max(1, Math.round(reviewPreview.estimated_review_seconds / 60))} 分钟`}。`
          : ''
        toast.success(
          movedCount > 0
            ? `AI 已整理知识点，新增 ${generatedCount} 个分类并重新归类了 ${movedCount} 个旧知识点。${reviewSummary}`
            : `AI 已整理知识点，新增 ${generatedCount} 个分类。${reviewSummary}`,
          result.ai_call_log_id
            ? {
                action: {
                  label: '查看AI详情',
                  onClick: () =>
                    requestOpenAiLogDetail({
                      aiCallLogId: result.ai_call_log_id,
                      title: 'AI 整理',
                    }),
                },
              }
            : undefined,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI 整理失败，请稍后重试。'
        const requestId =
          error instanceof Error && 'requestId' in error && typeof error.requestId === 'string'
            ? error.requestId
            : ''
        logAiCall({
          feature: 'AI 整理',
          stage: 'failure',
          requestSummary,
          errorMessage: message,
          requestId,
          meta: {
            palaceId,
            targetNodeUid: payload.target_node_uid,
            requestId,
          },
        })
        emitFeedbackFx('save_error', {
          nodeUid: payload.target_node_uid,
          relatedNodeUids: payload.target_node_uid ? [payload.target_node_uid] : [],
          source: 'mindmap_ai_split_failure',
        })
        toast.error(message)
      } finally {
        setAiSplitBusy(false)
      }
    },
    [documentState, emitFeedbackFx, palaceId, practice.editorMode, promptForAiOptions, timer],
  )

  const statusBadge: StatusBadgeState = versions.statusBadge

  return {
    aiRunConfigDialog,
    palaceId,
    palace,
    timer,
    title: meta.title,
    setTitle: meta.setTitle,
    createdAt: meta.createdAt,
    setCreatedAt: meta.setCreatedAt,
    editorMode: practice.editorMode,
    enterPreview: practice.enterPreview,
    chapterOptions: meta.chapterOptions,
    explicitChapterIds: meta.explicitChapterIds,
    inheritedChapterIds: meta.inheritedChapterIds,
    primaryChapterId: meta.primaryChapterId,
    chapterSelectionPending: meta.chapterSelectionPending,
    versionOpen: versions.versionOpen,
    setVersionOpen: versions.setVersionOpen,
    mindMapFullscreen,
    setMindMapFullscreen,
    toggleMindMapFullscreen,
    handleMindMapNativeFullscreenChange,
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
    focusNodeUids,
    feedbackFxSignal,
    reviewFxSignal: practice.feedback.reviewFxSignal,
    setSelectedNodes,
    handleMindMapNodeActive,
    setEditorState: documentState.setEditorState,
    hasUnsavedChanges: documentState.hasUnsavedChanges,
    saveStatus: documentState.saveStatus,
    saveError: documentState.error,
    handleMindMapEditorStateChange,
    aiSplitBusy,
    aiSplitAppliedSyncVersion,
    handleSaveMeta: meta.handleSaveMeta,
    handleEstablishCreatedAt: meta.handleEstablishCreatedAt,
    handleAttachmentUpload: meta.handleAttachmentUpload,
    handleAttachmentDelete: meta.handleAttachmentDelete,
    handleChapterToggle: meta.handleChapterToggle,
    enterInlinePractice,
    exitInlinePractice,
    toggleInlinePractice,
    handleInlinePracticeNodeClick,
    handleInlinePracticeNodeContextMenu,
    handleEditNodeContextMenu,
    handleAiSplitRequest,
    restartInlinePractice: practice.restartInlinePractice,
    handleOpenVersions: versions.handleOpenVersions,
    handleOpenCreateSegment: segments.handleOpenCreateSegment,
    handleOpenEditSegment: segments.handleOpenEditSegment,
    handleAdjustSegmentRange: segments.handleAdjustSegmentRange,
    handleSegmentRangeModeToggle: segments.handleSegmentRangeModeToggle,
    handleSegmentRangeDraftChange: segments.handleSegmentRangeDraftChange,
    handleConfirmSegmentRange: segments.handleConfirmSegmentRange,
    handleSaveSegment: segments.handleSaveSegment,
    handleDeleteSegment: segments.handleDeleteSegment,
    handleMergeSegment: segments.handleMergeSegment,
    handlePreviewVersion: versions.handlePreviewVersion,
    handleCloseVersions: versions.handleCloseVersions,
    handleRestoreVersion: versions.handleRestoreVersion,
    resetVersionPreview: versions.resetVersionPreview,
    statusBadge,
  }
}
