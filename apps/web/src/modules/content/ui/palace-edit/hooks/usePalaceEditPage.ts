import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from '@/shared/feedback/toast'
import type { MindMapSelection } from '@/modules/content/domain/mindmap-document-entity'
import type { ImportApplyContext } from '@/shared/api/contracts/imports'
import type { MindMapFeedbackEvent, MindMapFeedbackFxPayload } from '@/shared/feedback/feedbackEvents'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { usePalaceEditorDocument } from '@/modules/content/ui/palace-edit/hooks/usePalaceEditorDocument'
import { usePalacePracticeMode } from '@/modules/content/ui/palace-edit/hooks/usePalacePracticeMode'
import { usePalaceVersionsController } from '@/modules/content/ui/palace-edit/hooks/usePalaceVersionsController'
import type { StatusBadgeState } from '@/modules/content/ui/palace-edit/model/palace-edit-types'
import { getEnglishContinueCourseApi } from '@/modules/english/public'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { useMemoryAnkiShortcuts } from '@/modules/settings/public'
import {
  notePalaceEditorClosed,
  notePalaceEditorOpen,
  trackPalaceEditorLeave,
} from '@/shared/events/palaceEditorLeaveGate'
export type { PalaceMeta } from '@/modules/content/ui/palace-edit/model/palace-edit-types'

function readSelectionNodeUid(nodes: MindMapSelection[]) {
  const node = nodes[0] ?? null
  return node?.uid ? String(node.uid) : null
}

export function usePalaceEditPage() {
  const { isActive, fullPath } = useRouteResidency()
  const { id } = useParams()
  const navigate = useNavigate()
  const parsedPalaceId = id ? Number(id) : null
  const palaceId =
    parsedPalaceId != null && Number.isFinite(parsedPalaceId) && parsedPalaceId > 0
      ? parsedPalaceId
      : null
  const [replaceSyncVersion, setReplaceSyncVersion] = useState(0)
  const [selectedNodes, setSelectedNodes] = useState<MindMapSelection[]>([])
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false)
  const [feedbackFxSignal, setFeedbackFxSignal] = useState<MindMapFeedbackFxPayload | null>(null)
  const hardUnloadRef = useRef(false)
  const feedbackFxNonceRef = useRef(0)
  const selectedNodeUidRef = useRef<string | null>(null)
  const documentStateRef = useRef<ReturnType<typeof usePalaceEditorDocument> | null>(null)

  const documentState = usePalaceEditorDocument({
    palaceId,
    setReplaceSyncVersion,
  })
  documentStateRef.current = documentState
  const palace = documentState.meta
  const palaceTitle = palace?.title || '未命名宫殿'
  const selectedNode = selectedNodes[0] ?? null
  const selectedNodeUid = selectedNode?.uid ? String(selectedNode.uid) : null

  const handlePracticeCurrentNodeUid = useCallback((uid: string | null) => {
    selectedNodeUidRef.current = uid
    if (!uid) {
      setSelectedNodes([])
      return
    }
    setSelectedNodes((current) => (
      current[0]?.uid === uid ? current : [{ uid } as MindMapSelection]
    ))
  }, [])
  const practice = usePalacePracticeMode({
    palaceId,
    editorState: documentState.editorState,
    title: palaceTitle,
    currentNodeUid: selectedNodeUid,
    onCurrentNodeUid: handlePracticeCurrentNodeUid,
    studyRoute: fullPath,
    isActive,
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

  // Mode switches re-anchor via the canvas sceneTransitionKey (previous center card).
  // Do not force-focus the selected node — that jumps the camera away from what the user was viewing.
  const enterInlinePractice = useCallback(() => {
    practice.enterInlinePractice()
  }, [practice])

  const exitInlinePractice = useCallback(() => {
    practice.exitInlinePractice()
  }, [practice])

  const toggleInlinePractice = useCallback(() => {
    practice.toggleInlinePractice()
  }, [practice])

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
      documentState.handleMindMapEditorStateChange(nextState)
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
      hide_child_cards: handleShortcutHideChildCards,
    }),
    [handleShortcutHideChildCards],
  )

  useMemoryAnkiShortcuts(
    'flip',
    shortcutHandlers,
    practice.editorMode !== 'edit' && Boolean(documentState.editorState),
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

  /**
   * In-place palace switch from the directory tree. The session already flushes
   * the previous owner when `entityId` changes, but awaiting the flush here keeps
   * a slow save from landing after the canvas has already moved on.
   */
  const openPalace = useCallback(async (nextPalaceId: number) => {
    if (!Number.isFinite(nextPalaceId) || nextPalaceId <= 0) return
    if (nextPalaceId === palaceId) return
    const current = documentStateRef.current
    if (current?.pendingConflict) {
      toast.warning('请先解决当前宫殿的文档冲突，再切换宫殿。')
      return
    }
    if (current && (current.hasUnsavedChanges || current.isSaving)) {
      try {
        await current.flushSaveWithReconcile('editor_leave', { reconcileUnits: true })
      } catch {
        // A failed flush still leaves the local draft; ask before discarding the view.
      }
      if (documentStateRef.current?.hasUnsavedChanges) {
        const proceed = await appConfirm('当前宫殿还有未保存的修改，切换后可能丢失。仍要切换吗？', {
          title: '切换宫殿',
          tone: 'danger',
        })
        if (!proceed) return
      }
    }
    navigate(`/palaces/${nextPalaceId}/edit`)
  }, [navigate, palaceId])

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
    const closingPalaceId = palaceId
    return () => {
      if (hardUnloadRef.current) return
      if (!closingPalaceId) return
      const state = documentStateRef.current
      // An in-place palace switch may already have moved the session to the new
      // owner; flushing then would write the old document onto the new palace.
      if (!state || state.readCurrentState().entityId !== closingPalaceId) return
      // Soft route leave (SPA navigation): palace-only reconcile flush.
      // Capture-phase leave arming covers tab hide/pagehide via the shared session flush.
      trackPalaceEditorLeave(
        state.flushSaveWithReconcile('editor_leave', { reconcileUnits: true }),
      )
    }
  }, [palaceId])

  useEffect(() => {
    setSelectedNodes([])
    selectedNodeUidRef.current = null
    setFeedbackFxSignal(null)
  }, [palaceId])

  useEffect(() => {
    if (!isActive || !palaceId) return undefined
    notePalaceEditorOpen()
    return () => notePalaceEditorClosed()
  }, [isActive, palaceId])

  useEffect(() => {
    if (isActive) return
    if (!palaceId) return
    // Keep-alive hide does not unmount the editor, so palaceId cleanup never runs.
    // Treat residency inactive as leave so marked units still enter the review list.
    trackPalaceEditorLeave(
      documentStateRef.current?.flushSaveWithReconcile('editor_leave', { reconcileUnits: true }),
    )
  }, [isActive, palaceId])

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
      emitFeedbackFx('mode_switch', { source: 'mind_map_immersive_toggle' })
      setMindMapFullscreen((current) => (typeof active === 'boolean' ? active : !current))
    },
    [emitFeedbackFx],
  )

  const handleOpenEnglishArea = useCallback(async () => {
    try {
      const result = await getEnglishContinueCourseApi()
      if (result.course?.id) {
        navigate(`/english/listening/courses/${result.course.id}`)
        return
      }
      navigate('/english')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '打开英语听力失败，请稍后再试。')
    }
  }, [navigate])

  const statusBadge: StatusBadgeState = versions.statusBadge

  return {
    palaceId,
    palace,
    reload: documentState.reload,
    title: palaceTitle,
    openPalace,
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
    editorState: documentState.editorState,
    applyImportedPalaceEditorState: documentState.applyImportedPalaceEditorState as (
      nextState: MindMapEditorState,
      context?: ImportApplyContext,
    ) => Promise<void>,
    activeMindMapEditorState: practice.activeMindMapEditorState,
    practiceVisibleEditorSyncKey: practice.practiceVisibleEditorSyncKey,
    modeFocusRequestNodeUid: null as string | null,
    modeFocusRequestNonce: 0,
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
    flushSave: documentState.flushSave,
    readCurrentDocumentState: documentState.readCurrentState,
    flushSaveWithReconcile: documentState.flushSaveWithReconcile,
    armNextSaveOverride: documentState.armNextSaveOverride,
    pendingConflict: documentState.pendingConflict,
    resolveConflict: documentState.resolveConflict,
    saveError: documentState.error,
    isLoadError: documentState.isLoadError,
    isCreatingDraft: documentState.isCreatingDraft,
    handleCreateBlankPalace,
    handleMindMapEditorStateChange,
    enterInlinePractice,
    exitInlinePractice,
    toggleInlinePractice,
    flipCardRevealSettings: practice.flipCardRevealSettings,
    handleInlinePracticeNodeClick,
    handleInlinePracticeNodeContextMenu,
    restartInlinePractice: practice.restartInlinePractice,
    handleOpenVersions: versions.handleOpenVersions,
    handlePreviewVersion: versions.handlePreviewVersion,
    handleCloseVersions: versions.handleCloseVersions,
    handleRestoreVersion: versions.handleRestoreVersion,
    resetVersionPreview: versions.resetVersionPreview,
    statusBadge,
  }
}
