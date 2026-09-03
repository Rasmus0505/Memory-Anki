import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RevealState } from '@/modules/session/public'
import { useRevealSession } from '@/modules/memory/public'
import {
  allNodesRevealed,
  buildInitialRevealState,
} from '@/modules/memory/public'
import {
  clearPracticeSessionProgressApi,
  getPracticeSessionProgressApi,
  savePracticeSessionProgressApi,
} from '@/modules/content/domain/palace-entity/api'
import type { MindMapSelection } from '@/modules/content/domain/mindmap-document-entity'
import type { MindMapEditorState, SessionProgressSnapshot } from '@/shared/api/contracts'
import type { EditorMode } from '@/modules/content/ui/palace-edit/model/mindmap-editor'
import { useReviewFeedback } from '@/modules/memory/public'
import { useFlipCardRevealSettings } from '@/modules/settings/public'
import { useLiveStudySurfaceMirror } from '@/modules/session/public'
import {
  applyPalacePracticeLiveView,
  decodePalacePracticeLiveView,
  palacePracticeSameInteraction,
  type PalacePracticeLiveView,
} from '@/modules/content/ui/palace-edit/model/palacePracticeLiveView'

interface PalacePracticeModeOptions {
  palaceId: number | null
  editorState: MindMapEditorState | null
  title: string
  currentNodeUid?: string | null
  onCurrentNodeUid?: (uid: string | null) => void
  studyRoute?: string
  isActive?: boolean
}

export function usePalacePracticeMode({
  palaceId,
  editorState,
  title,
  currentNodeUid = null,
  onCurrentNodeUid,
  studyRoute,
  isActive = true,
}: PalacePracticeModeOptions) {
  const [editorMode, setEditorMode] = useState<EditorMode>('edit')
  const flipCardRevealSettings = useFlipCardRevealSettings()
  const reveal = useRevealSession({
    title,
    editorState,
    initialSnapshot: null,
    revealConfig: flipCardRevealSettings.settings,
  })
  const {
    docFingerprint,
    handleNodeClick,
    handleNodeContextMenu,
    redNodeIds,
    reset,
    revealMap,
    root,
    setRedNodeIds,
    setRevealMap,
    visibleEditorState,
  } = reveal
  const [practiceSnapshotLoaded, setPracticeSnapshotLoaded] = useState(false)
  const loadedPracticeSnapshotKeyRef = useRef<string | null>(null)
  const practiceSnapshotKey = useMemo(
    () => (palaceId && editorState ? `${palaceId}:${docFingerprint}` : null),
    [docFingerprint, editorState, palaceId],
  )
  const feedback = useReviewFeedback({
    root,
    revealMap,
    revealedNonRootCount: Object.entries(revealMap).filter(
      ([nodeId, state]) => nodeId !== root.id && state === 'revealed',
    ).length,
    totalNodeCount: Object.keys(revealMap).length,
  })

  useEffect(() => {
    loadedPracticeSnapshotKeyRef.current = null
    setPracticeSnapshotLoaded(false)
  }, [practiceSnapshotKey])

  useEffect(() => {
    if (!palaceId || !editorState || !practiceSnapshotKey) return
    if (loadedPracticeSnapshotKeyRef.current === practiceSnapshotKey) return
    let cancelled = false

    const loadPracticeSnapshot = async () => {
      try {
        const response = await getPracticeSessionProgressApi(palaceId)
        if (cancelled) return
        const progress = response.progress
        if (progress && !progress.completed) {
          setRevealMap(buildInitialRevealState(root, progress.reveal_map))
          setRedNodeIds(new Set((progress.red_node_ids ?? []).filter(Boolean)))
        } else {
          reset()
        }
      } catch {
        if (!cancelled) {
          reset()
        }
      } finally {
        if (!cancelled) {
          loadedPracticeSnapshotKeyRef.current = practiceSnapshotKey
          setPracticeSnapshotLoaded(true)
        }
      }
    }

    void loadPracticeSnapshot()
    return () => {
      cancelled = true
    }
  }, [editorState, palaceId, practiceSnapshotKey, reset, root, setRedNodeIds, setRevealMap])

  useEffect(() => {
    if (!palaceId || !practiceSnapshotLoaded) return

    const persistSnapshot = async () => {
      if (allNodesRevealed(root, revealMap)) {
        await clearPracticeSessionProgressApi(palaceId)
        return
      }

      const snapshot = {
        completed: false,
        reveal_map: revealMap as Record<string, RevealState>,
        red_node_ids: [...redNodeIds],
      } satisfies Pick<SessionProgressSnapshot, 'completed' | 'reveal_map' | 'red_node_ids'>

      await savePracticeSessionProgressApi(palaceId, snapshot)
    }

    void persistSnapshot()
  }, [palaceId, practiceSnapshotLoaded, redNodeIds, revealMap, root])

  const enterInlinePractice = useCallback(() => {
    setEditorMode('recall')
  }, [])

  const exitInlinePractice = useCallback(() => {
    setEditorMode('edit')
  }, [])

  const enterPreview = useCallback(() => {
    setEditorMode('preview')
  }, [])

  const toggleInlinePractice = useCallback(() => {
    if (editorMode === 'recall') {
      exitInlinePractice()
      return
    }
    enterInlinePractice()
  }, [editorMode, enterInlinePractice, exitInlinePractice])

  const handleInlinePracticeNodeClick = useCallback((nodes: MindMapSelection[]) => {
    if (editorMode !== 'recall') return
    handleNodeClick(nodes)
  }, [editorMode, handleNodeClick])

  const handleInlinePracticeNodeContextMenu = useCallback((nodes: MindMapSelection[]) => {
    if (editorMode !== 'recall') return
    handleNodeContextMenu(nodes)
  }, [editorMode, handleNodeContextMenu])

  const restartInlinePractice = useCallback(async () => {
    reset()
    feedback.emitManualEvent('session_reset')
    if (palaceId) {
      await clearPracticeSessionProgressApi(palaceId)
    }
  }, [feedback, palaceId, reset])

  const activeMindMapEditorState = useMemo<MindMapEditorState | null>(
    () => (editorMode === 'recall' ? (visibleEditorState ?? editorState ?? null) : (editorState ?? null)),
    [editorMode, editorState, visibleEditorState],
  )
  const practiceVisibleEditorSyncKey = useMemo(
    () =>
      JSON.stringify({
        docFingerprint,
        revealMap,
        redNodeIds: [...redNodeIds].sort(),
      }),
    [docFingerprint, redNodeIds, revealMap],
  )

  const practiceLiveView = useMemo<PalacePracticeLiveView>(() => ({
    palaceId,
    editorMode,
    currentNodeUid,
    revealMap,
    redNodeIds: [...redNodeIds],
  }), [currentNodeUid, editorMode, palaceId, redNodeIds, revealMap])
  const applyPracticeLiveView = useCallback((remote: PalacePracticeLiveView) => {
    const next = applyPalacePracticeLiveView(practiceLiveView, remote)
    setEditorMode(next.editorMode)
    if (next.revealMap) setRevealMap(next.revealMap as Record<string, RevealState>)
    setRedNodeIds(new Set(next.redNodeIds))
    onCurrentNodeUid?.(next.currentNodeUid)
  }, [onCurrentNodeUid, practiceLiveView, setRedNodeIds, setRevealMap])
  const practiceStudyRoute = editorMode === 'recall' && palaceId
    ? `/palaces/${palaceId}`
    : (studyRoute || (palaceId ? `/palaces/${palaceId}` : ''))
  useLiveStudySurfaceMirror({
    surface: 'mindmap_review',
    route: practiceStudyRoute,
    view: practiceLiveView,
    decode: decodePalacePracticeLiveView,
    apply: applyPracticeLiveView,
    sameInteraction: palacePracticeSameInteraction,
    publishWhen: editorMode === 'recall',
    isActive,
  })

  return {
    activeMindMapEditorState,
    editorMode,
    enterPreview,
    enterInlinePractice,
    exitInlinePractice,
    handleInlinePracticeNodeClick,
    handleInlinePracticeNodeContextMenu,
    practiceVisibleEditorState: visibleEditorState,
    practiceVisibleEditorSyncKey,
    practiceRevealMap: revealMap,
    practiceRedNodeIds: redNodeIds,
    practiceRoot: root,
    feedback,
    restartInlinePractice,
    setEditorMode,
    toggleInlinePractice,
    flipCardRevealSettings,
  }
}
