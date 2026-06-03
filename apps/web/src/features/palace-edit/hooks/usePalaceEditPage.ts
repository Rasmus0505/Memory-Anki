import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useBilinkOverlay } from '@/features/bilink'
import { useBilinkCounts } from '@/features/bilink/hooks/useBilinkCounts'
import { useBilinks } from '@/features/bilink/hooks/useBilinks'
import type { MindMapAiSplitRequestPayload, MindMapSelection } from '@/shared/components/mindmap-host'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'
import { logAiCall } from '@/shared/logs/model/appLogs'
import { parseMindMapDoc } from '@/features/palace-edit/model/mindmap-editor'
import { usePalaceEditorDocument } from '@/features/palace-edit/hooks/usePalaceEditorDocument'
import { usePalaceMetaController } from '@/features/palace-edit/hooks/usePalaceMetaController'
import { usePalacePracticeMode } from '@/features/palace-edit/hooks/usePalacePracticeMode'
import { usePalaceSegmentsController } from '@/features/palace-edit/hooks/usePalaceSegmentsController'
import { usePalaceVersionsController } from '@/features/palace-edit/hooks/usePalaceVersionsController'
import type { StatusBadgeState } from '@/features/palace-edit/model/palace-edit-types'
import type { ImportApplyContext } from '@/features/palace-edit/model/mindmap-import-types'
import { splitMindMapNodeApi } from '@/shared/api/modules/palaces'
import type { MindMapEditorState } from '@/shared/api/contracts'

export function usePalaceEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const palaceId = id ? Number(id) : null
  const [replaceSyncVersion, setReplaceSyncVersion] = useState(0)
  const [selectedNodes, setSelectedNodes] = useState<MindMapSelection[]>([])
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)
  const [aiSplitBusy, setAiSplitBusy] = useState(false)
  const [aiSplitAppliedSyncVersion, setAiSplitAppliedSyncVersion] = useState(0)
  const suppressNativeFullscreenExitUntilRef = useRef(0)
  const hardUnloadRef = useRef(false)

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
  const parsedEditorDoc = useMemo(
    () => parseMindMapDoc(documentState.editorState?.editor_doc ?? null),
    [documentState.editorState?.editor_doc],
  )

  const meta = usePalaceMetaController({
    palace,
    reload: documentState.reload,
    timer,
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

  const bilinks = useBilinks(palaceId)
  const bilinkCounts = useBilinkCounts(palaceId)
  const refreshBilinks = useCallback(() => {
    bilinks.refresh()
    bilinkCounts.refresh()
  }, [bilinkCounts, bilinks])

  const bilinkOverlay = useBilinkOverlay({
    currentPalaceId: palaceId,
    allowCreate: true,
    onBilinkCreated: refreshBilinks,
    onBilinkDeleted: refreshBilinks,
    onJumpToContext: (context) => {
      navigate(`/palaces/${context.palace_id}/edit`)
    },
  })

  const selectedNode = selectedNodes[0] ?? null

  const handleMindMapEditorStateChange = useCallback(
    (nextState: MindMapEditorState) => {
      documentState.handleMindMapEditorStateChange(nextState, () => {
        timerRef.current.registerActivity('edit_operation', { source: 'mind_map_edit' })
      })
    },
    [documentState],
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
    if (timer.status !== 'idle') return
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig())) return
    timer.start({ source: 'page_enter' })
  }, [documentState.editorState, palaceId, timer])

  useEffect(() => {
    timerRef.current = timer
  }, [timer])

  useEffect(() => {
    const markHardUnload = () => {
      hardUnloadRef.current = true
    }
    window.addEventListener('beforeunload', markHardUnload)
    window.addEventListener('pagehide', markHardUnload)
    return () => {
      window.removeEventListener('beforeunload', markHardUnload)
      window.removeEventListener('pagehide', markHardUnload)
    }
  }, [])

  useEffect(() => {
    return () => {
      const currentTimer = timerRef.current
      if (hardUnloadRef.current) return
      if (currentTimer.startedAt && currentTimer.status !== 'completed') {
        void currentTimer.complete('left_page')
      }
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
      if (active === true) {
        suppressNativeFullscreenExitUntilRef.current = Date.now() + 1500
      }
      setMindMapFullscreen((current) => (typeof active === 'boolean' ? active : !current))
    },
    [timer],
  )

  const handleMindMapNativeFullscreenChange = useCallback((active: boolean) => {
    if (active) return
    if (Date.now() < suppressNativeFullscreenExitUntilRef.current) return
    setMindMapFullscreen(false)
  }, [])

  const handleAiSplitRequest = useCallback(
    async (payload: MindMapAiSplitRequestPayload) => {
      if (practice.editorMode !== 'edit' || !palaceId || !documentState.editorState) return
      setAiSplitBusy(true)
      timer.registerActivity('edit_operation', { source: 'mindmap_ai_split' })
      const requestSummary = `节点: ${payload.target_node_uid || 'unknown'}`
      logAiCall({
        feature: 'AI 分卡',
        stage: 'start',
        requestSummary,
        meta: {
          palaceId,
          targetNodeUid: payload.target_node_uid,
        },
      })
      try {
        const result = await splitMindMapNodeApi(palaceId, {
          editor_doc: documentState.editorState.editor_doc,
          target_node_uid: payload.target_node_uid,
        })
        if (!result.ok || !result.editor_doc) {
          throw new Error(result.error || 'AI 分卡失败，请稍后重试。')
        }
        logAiCall({
          feature: 'AI 分卡',
          stage: 'success',
          requestSummary,
          responseSummary: `新增 ${result.generated_children_count ?? 0} 个分类，重归类 ${result.reassigned_existing_children_count ?? 0} 个旧节点`,
          requestId:
            typeof (result as { request_id?: unknown }).request_id === 'string'
              ? (result as { request_id?: string }).request_id
              : '',
          meta: {
            palaceId,
            targetNodeUid: payload.target_node_uid,
            model: result.model ?? '',
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
        const generatedCount = result.generated_children_count ?? 0
        const movedCount = result.reassigned_existing_children_count ?? 0
        toast.success(
          movedCount > 0
            ? `AI 分卡完成，新增 ${generatedCount} 个分类并重新归类了 ${movedCount} 个旧节点。`
            : `AI 分卡完成，新增 ${generatedCount} 个分类节点。`,
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'AI 分卡失败，请稍后重试。'
        const requestId =
          error instanceof Error && 'requestId' in error && typeof error.requestId === 'string'
            ? error.requestId
            : ''
        logAiCall({
          feature: 'AI 分卡',
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
        toast.error(message)
      } finally {
        setAiSplitBusy(false)
      }
    },
    [documentState, palaceId, practice.editorMode, timer],
  )

  const statusBadge: StatusBadgeState = versions.statusBadge

  return {
    palaceId,
    palace,
    timer,
    title: meta.title,
    setTitle: meta.setTitle,
    createdAt: meta.createdAt,
    setCreatedAt: meta.setCreatedAt,
    editorMode: practice.editorMode,
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
    replaceSyncVersion,
    selectedNodes,
    selectedNode,
    setSelectedNodes,
    setEditorState: documentState.setEditorState,
    handleMindMapEditorStateChange,
    aiSplitBusy,
    aiSplitAppliedSyncVersion,
    handleSaveMeta: meta.handleSaveMeta,
    handleEstablishCreatedAt: meta.handleEstablishCreatedAt,
    handleAttachmentUpload: meta.handleAttachmentUpload,
    handleAttachmentDelete: meta.handleAttachmentDelete,
    handleChapterToggle: meta.handleChapterToggle,
    enterInlinePractice: practice.enterInlinePractice,
    exitInlinePractice: practice.exitInlinePractice,
    toggleInlinePractice: practice.toggleInlinePractice,
    bilinks: bilinks.items,
    bilinksLoading: bilinks.loading,
    bilinksError: bilinks.error,
    bilinkCounts: bilinkCounts.counts,
    bilinkCountsLoading: bilinkCounts.loading,
    ...bilinkOverlay,
    handleInlinePracticeNodeClick: practice.handleInlinePracticeNodeClick,
    handleInlinePracticeNodeContextMenu: practice.handleInlinePracticeNodeContextMenu,
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
