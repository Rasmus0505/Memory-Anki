import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RevealState } from '@/entities/session/model'
import { useRevealSession } from '@/entities/review/model/useRevealSession'
import {
  allNodesRevealed,
  buildInitialRevealState,
} from '@/entities/review/model/review-flow-tree'
import {
  clearPracticeSessionProgressApi,
  getPracticeSessionProgressApi,
  savePracticeSessionProgressApi,
} from '@/entities/palace/api'
import type { MindMapSelection } from '@/shared/components/mindmap-host'
import type { MindMapEditorState, SessionProgressSnapshot } from '@/shared/api/contracts'
import type { EditorMode } from '@/features/palace-edit/model/mindmap-editor'
import { useReviewFeedback } from '@/features/review/hooks/useReviewFeedback'

interface PalacePracticeModeOptions {
  palaceId: number | null
  editorState: MindMapEditorState | null
  title: string
  timer: {
    registerActivity: (kind: string, meta?: Record<string, unknown>) => void
  }
}

export function usePalacePracticeMode({
  palaceId,
  editorState,
  title,
  timer,
}: PalacePracticeModeOptions) {
  const [editorMode, setEditorMode] = useState<EditorMode>('edit')
  const reveal = useRevealSession({
    title,
    editorState,
    initialSnapshot: null,
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
    timer.registerActivity('practice_interaction', { source: 'inline_practice_enter' })
    setEditorMode('recall')
  }, [timer])

  const exitInlinePractice = useCallback(() => {
    timer.registerActivity('practice_interaction', { source: 'inline_practice_exit' })
    setEditorMode('edit')
  }, [timer])

  const enterPreview = useCallback(() => {
    timer.registerActivity('practice_interaction', { source: 'inline_preview_enter' })
    setEditorMode('preview')
  }, [timer])

  const toggleInlinePractice = useCallback(() => {
    if (editorMode === 'recall') {
      exitInlinePractice()
      return
    }
    enterInlinePractice()
  }, [editorMode, enterInlinePractice, exitInlinePractice])

  const handleInlinePracticeNodeClick = useCallback((nodes: MindMapSelection[]) => {
    if (editorMode !== 'recall') return
    timer.registerActivity('practice_interaction', { source: 'inline_practice_click' })
    handleNodeClick(nodes)
  }, [editorMode, handleNodeClick, timer])

  const handleInlinePracticeNodeContextMenu = useCallback((nodes: MindMapSelection[]) => {
    if (editorMode !== 'recall') return
    timer.registerActivity('practice_interaction', { source: 'inline_practice_contextmenu' })
    handleNodeContextMenu(nodes)
  }, [editorMode, handleNodeContextMenu, timer])

  const restartInlinePractice = useCallback(async () => {
    reset()
    feedback.emitManualEvent('session_reset')
    if (palaceId) {
      await clearPracticeSessionProgressApi(palaceId)
    }
    timer.registerActivity('practice_interaction', { source: 'inline_practice_restart' })
  }, [feedback, palaceId, reset, timer])

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
  }
}
