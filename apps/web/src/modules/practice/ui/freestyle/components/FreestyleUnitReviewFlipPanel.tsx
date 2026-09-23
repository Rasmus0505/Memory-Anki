import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  type PalaceReviewUnitChangeHighlight,
} from '@/modules/practice/ui/review/components/PalaceReviewUnitsPanel'
import { PalaceLadderProgress } from '@/modules/practice/ui/review/components/PalaceLadderProgress'
import { useRevealSession } from '@/modules/memory/public'
import { isWeakerRevealMap, type RevealState } from '@/modules/session/public'
import { useFlipCardRevealSettings } from '@/modules/settings/public'
import {
  FreestyleUnitReviewFlipDialogs,
  FreestyleUnitReviewStatusBanner,
  type FreestyleEditorSaveState,
} from './FreestyleUnitReviewFlipCanvas'
import { useFreestyleUnitReviewNodeQuiz } from './freestyleUnitReviewFlipToolbar'
import { useFreestyleTextToMindMap } from './useFreestyleTextToMindMap'
import type {
  FreestyleReviewUnitCard,
  MindMapEditorState,
  PalaceUnitReconcileResult,
} from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/public'
import type {
  FreestyleFlipMode,
  ReviewUnitDto,
  UnitReviewSessionDto,
} from '@/modules/practice/public'
import { countUnitFlipProgress, unitFlipTargetUids } from '@/modules/practice/ui/freestyle/model/unitFlipProgress'
import { isFreestyleShortcutBlocked } from '@/modules/practice/ui/freestyle/model/freestyleKeyboard'
import { useFreestyleFlowFeedback } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFlowFeedback'
import {
  recordSessionRecorderUiAction,
  summarizeRevealMapChange,
} from '@/shared/debug/session-recorder'
import {
  buildEditorParentMap,
  buildSplitMarkStatusChips,
  collectPermanentMarkUids,
  collectRootUid,
  togglePermanentMarkInDoc,
  type EditorDoc,
} from '@/shared/lib/mindmap-split-marks/splitMarks'
import { computeRevealCollapsedNodeIdsFromParentMap } from '@/shared/ui/mindmap-canvas/mindMapCollapse'
import {
  FlipCardMindMapPanel,
  persistPalaceEditor,
  type PersistPalaceEditorOptions,
  type PersistPalaceEditorResult,
} from './freestyleBranchCardSupport'

export function FreestyleUnitReviewFlipPanel({
  card,
  session,
  unit,
  editorState,
  active = true,
  fullscreen,
  onToggleFullscreen,
  freestyleFlipMode = 'free',
  onFreestyleFlipModeChange,
  autoAdvance = false,
  onAutoAdvanceChange,
  preferredZoom,
  onUserZoomChange,
  onEditingChange,
  onSaveFailed,
  onEditorStateSaved,
  onUnitsReconciled,
  onRevealProgressChange,
  syncedRevealMap = null,
  onRevealMapChange,
  onOpenScopeQuiz,
}: {
  card: FreestyleReviewUnitCard
  session: UnitReviewSessionDto
  unit: ReviewUnitDto
  editorState: MindMapEditorState
  active?: boolean
  fullscreen: boolean
  onToggleFullscreen: (active?: boolean) => void
  freestyleFlipMode?: FreestyleFlipMode
  onFreestyleFlipModeChange?: (value: FreestyleFlipMode) => void
  autoAdvance?: boolean
  onAutoAdvanceChange?: (value: boolean) => void
  preferredZoom?: number
  onUserZoomChange?: (zoom: number) => void
  onEditingChange?: (editing: boolean) => void
  onSaveFailed?: (message: string) => void
  onUnitsReconciled?: () => void
  onRevealProgressChange?: (progress: { revealed: number; total: number }) => void
  onEditorStateSaved?: (state: MindMapEditorState) => void
  syncedRevealMap?: Record<string, string> | null
  onRevealMapChange?: (revealMap: Record<string, string>) => void
  onOpenScopeQuiz?: () => void
}) {
  const flipCardRevealSettings = useFlipCardRevealSettings()
  const [displayMode, setDisplayMode] = useState<'review' | 'edit'>('review')
  const [editEditorState, setEditEditorState] = useState<MindMapEditorState>(editorState)
  const editEditorStateRef = useRef(editorState)
  const displayModeRef = useRef<'review' | 'edit'>('review')
  const isEditMode = displayMode === 'edit'
  editEditorStateRef.current = editEditorState
  displayModeRef.current = displayMode

  const flipTargetUids = useMemo(
    () => unitFlipTargetUids(unit.node_uids, unit.anchor_uid, unit.unit_kind),
    [unit.anchor_uid, unit.node_uids, unit.unit_kind],
  )
  const allowedRevealNodeIds = useMemo(() => {
    if (freestyleFlipMode !== 'focused') return undefined
    const parentByUid = buildEditorParentMap(editorState.editor_doc as EditorDoc)
    const allowed = new Set<string>()
    const seeds = new Set(flipTargetUids)
    for (const seed of seeds) {
      let current: string | null = String(seed)
      while (current) {
        if (allowed.has(current)) break
        allowed.add(current)
        current = parentByUid.get(current) ?? null
      }
    }
    return [...allowed]
  }, [editorState.editor_doc, flipTargetUids, freestyleFlipMode])
  const reveal = useRevealSession({
    title: card.palace_title || session.title || `宫殿 ${card.palace_id}`,
    editorState: editEditorState,
    revealConfig: flipCardRevealSettings.settings,
    allowedNodeIds: allowedRevealNodeIds,
    syncedRevealMap: syncedRevealMap as Record<string, RevealState> | null,
  })
  const editRevealCollapsedNodeIds = useMemo(() => {
    if (!isEditMode) return null
    const doc = editEditorState.editor_doc as EditorDoc
    const parentByUid = buildEditorParentMap(doc)
    if (parentByUid.size === 0) return null
    return computeRevealCollapsedNodeIdsFromParentMap(parentByUid, reveal.revealMap, {
      rootId: collectRootUid(doc),
    })
  }, [editEditorState, isEditMode, reveal.revealMap])

  const { handleNodeContextMenu, handleTargetNodeClick, root } = reveal
  const { signalReveal } = useFreestyleFlowFeedback()

  const lastNotifiedRevealKeyRef = useRef('')
  // Header chip: this unit's membership only (not whole-palace node count).
  useEffect(() => {
    onRevealProgressChange?.(
      countUnitFlipProgress(reveal.revealMap, flipTargetUids),
    )
    const key = JSON.stringify(reveal.revealMap)
    if (key === lastNotifiedRevealKeyRef.current) return
    if (
      lastNotifiedRevealKeyRef.current === ''
      && syncedRevealMap
      && isWeakerRevealMap(reveal.revealMap, syncedRevealMap)
    ) {
      return
    }
    lastNotifiedRevealKeyRef.current = key
    onRevealMapChange?.(reveal.revealMap)
  }, [
    flipTargetUids,
    onRevealMapChange,
    onRevealProgressChange,
    reveal.revealMap,
    syncedRevealMap,
  ])

  /**
   * Immediate confirmation for the flip itself — the highest-frequency action in
   * freestyle, and the one that was completely silent while formal review has always
   * played a tone per reveal.
   *
   * Counted off the whole reveal map rather than the unit-scoped header progress:
   * the default flip mode is `free`, where any node in the palace is flippable, so a
   * unit-scoped count would leave most flips silent and simply relocate the defect.
   *
   * The baseline is keyed by encounter so a fresh card's first report cannot sound as
   * though the learner had just flipped something.
   */
  const revealedCount = useMemo(
    () => Object.values(reveal.revealMap).filter((state) => state === 'revealed').length,
    [reveal.revealMap],
  )
  const revealBaselineKey = `${card.id}:${unit.encounter?.id ?? 'none'}`
  const revealBaselineRef = useRef<{ key: string; revealed: number } | null>(null)

  useEffect(() => {
    const baseline = revealBaselineRef.current
    revealBaselineRef.current = { key: revealBaselineKey, revealed: revealedCount }
    if (!active) return
    if (baseline?.key !== revealBaselineKey) return
    if (revealedCount > baseline.revealed) signalReveal()
  }, [active, revealBaselineKey, revealedCount, signalReveal])

  const [modeSyncVersion, setModeSyncVersion] = useState(0)
  const [permanentMarkMode, setPermanentMarkMode] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [saveState, setSaveState] = useState<FreestyleEditorSaveState>('idle')
  const [quietStatus, setQuietStatus] = useState<string | null>(null)
  const quietStatusTimerRef = useRef<number | null>(null)
  const saveStatusTimerRef = useRef<number | null>(null)
  const [reviewUnitsPanelOpen, setReviewUnitsPanelOpen] = useState(false)
  const [lastUndoToken, setLastUndoToken] = useState<string | null>(null)
  const [recentUnitChanges, setRecentUnitChanges] = useState<PalaceReviewUnitChangeHighlight[]>([])
  const saveQueueRef = useRef<Promise<PersistPalaceEditorResult | null>>(Promise.resolve(null))
  const editBaselineRef = useRef(editorState)
  const persistGenerationRef = useRef(0)
  const pendingPersistRef = useRef<{
    state: MindMapEditorState
    persistOptions?: PersistPalaceEditorOptions
    generation: number
  } | null>(null)
  const activePersistRef = useRef(false)
  const lastSavedFingerprintRef = useRef(editorState.editor_fingerprint || '')
  const lastPersistResultRef = useRef<PersistPalaceEditorResult | null>(null)
  const lastFailedPersistRef = useRef<{
    state: MindMapEditorState
    persistOptions?: PersistPalaceEditorOptions
  } | null>(null)
  const editedSinceReconcileRef = useRef(false)
  const editRevealSnapshotRef = useRef<Record<string, RevealState> | null>(null)
  const lastRevealRecordKeyRef = useRef('')
  const revealApiRef = useRef(reveal)
  revealApiRef.current = reveal

  // While reviewing, external/session replacement wins. During edit, the local
  // document stays authoritative until the card leaves the editing session.
  useEffect(() => {
    if (displayModeRef.current !== 'review') return
    if (editEditorStateRef.current === editorState) return
    setEditEditorState(editorState)
    editBaselineRef.current = editorState
    editEditorStateRef.current = editorState
    lastSavedFingerprintRef.current = editorState.editor_fingerprint || ''
  }, [editorState])

  useLayoutEffect(() => {
    if (!active || isEditMode) return

    const anchorUid = String(unit.anchor_uid || '').trim()
    if (!anchorUid) return

    const targetSelection: MindMapSelection = {
      uid: anchorUid,
      text: unit.title || card.palace_title || '复习目标',
      note: '',
      memoryAnkiId: null,
      memoryAnkiNodeType: null,
      rawData: {},
    }
    const rootSelection: MindMapSelection = {
      ...targetSelection,
      uid: root.id,
      text: root.text || card.palace_title || '宫殿',
    }
    const handleTargetShortcut = (event: globalThis.KeyboardEvent) => {
      const isEnter = event.key === 'Enter'
      const isShift = event.key === 'Shift'
      if (
        event.defaultPrevented
        || (!isEnter && !isShift)
        || event.ctrlKey
        || event.altKey
        || event.metaKey
        || (isEnter && event.shiftKey)
        || (isShift && event.repeat)
        || isFreestyleShortcutBlocked(event.target)
      ) {
        return
      }
      if (event.target instanceof HTMLElement && event.target.closest('button, a')) return

      event.preventDefault()
      if (isShift) {
        // Right-clicking the root hides every descendant while retaining the
        // root card, which is the keyboard equivalent of returning to root.
        handleNodeContextMenu([rootSelection])
        return
      }
      handleTargetNodeClick([targetSelection])
    }

    window.addEventListener('keydown', handleTargetShortcut, true)
    return () => window.removeEventListener('keydown', handleTargetShortcut, true)
  }, [
    active,
    card.palace_title,
    handleNodeContextMenu,
    handleTargetNodeClick,
    isEditMode,
    root.id,
    root.text,
    unit.anchor_uid,
    unit.title,
  ])

  // Session reload (stale rebuild) refreshes the edit baseline only while learning.
  useEffect(() => {
    if (isEditMode) return
    setEditEditorState(editorState)
    editBaselineRef.current = editorState
    lastSavedFingerprintRef.current = editorState.editor_fingerprint || lastSavedFingerprintRef.current
  }, [editorState, isEditMode])

  useEffect(() => {
    onEditingChange?.(isEditMode)
  }, [isEditMode, onEditingChange])

  useEffect(() => {
    if (isEditMode) return
    const key = JSON.stringify(reveal.revealMap)
    if (key === lastRevealRecordKeyRef.current) return
    const previous = lastRevealRecordKeyRef.current
      ? JSON.parse(lastRevealRecordKeyRef.current) as Record<string, string>
      : null
    lastRevealRecordKeyRef.current = key
    if (!previous) return
    const detail = summarizeRevealMapChange(
      previous,
      reveal.revealMap,
      (id) => reveal.nodeMap.get(id)?.text ?? '',
    )
    if (detail) recordSessionRecorderUiAction('mindmap', '翻卡', detail)
  }, [isEditMode, reveal.nodeMap, reveal.revealMap])

  const showQuietStatus = useCallback((message: string) => {
    if (quietStatusTimerRef.current != null) {
      window.clearTimeout(quietStatusTimerRef.current)
    }
    setQuietStatus(message)
    quietStatusTimerRef.current = window.setTimeout(() => {
      quietStatusTimerRef.current = null
      setQuietStatus(null)
    }, 2_400)
  }, [])

  useEffect(() => {
    return () => {
      if (quietStatusTimerRef.current != null) {
        window.clearTimeout(quietStatusTimerRef.current)
      }
      if (saveStatusTimerRef.current != null) {
        window.clearTimeout(saveStatusTimerRef.current)
      }
    }
  }, [])

  const clearSaveStatusTimer = useCallback(() => {
    if (saveStatusTimerRef.current != null) {
      window.clearTimeout(saveStatusTimerRef.current)
      saveStatusTimerRef.current = null
    }
  }, [])

  const showSavedStatus = useCallback(() => {
    clearSaveStatusTimer()
    setSaveState('saved')
    saveStatusTimerRef.current = window.setTimeout(() => {
      saveStatusTimerRef.current = null
      setSaveState((current) => current === 'saved' ? 'idle' : current)
    }, 1_600)
  }, [clearSaveStatusTimer])

  const notifyUnitReconcile = useCallback((
    unitReconcile: PalaceUnitReconcileResult | null | undefined,
  ) => {
    if (unitReconcile?.changed) {
      const token = unitReconcile.undo_token ?? unitReconcile.schedule_batch_id ?? null
      if (token) setLastUndoToken(token)
      if (Array.isArray(unitReconcile.changes) && unitReconcile.changes.length > 0) {
        setRecentUnitChanges(
          unitReconcile.changes.flatMap((item) => {
            const row = item as PalaceReviewUnitChangeHighlight & { unit_id?: string }
            if (!row.unit_id) return []
            return [{
              unit_id: row.unit_id,
              action: row.action || 'update',
              before: row.before ?? null,
              after: row.after ?? null,
            }]
          }),
        )
      }
      showQuietStatus('复习进度已更新')
      onUnitsReconciled?.()
    }
  }, [onUnitsReconciled, showQuietStatus])

  const persistEdit = useCallback(async (
    state: MindMapEditorState,
    options?: PersistPalaceEditorOptions,
  ) => {
    pendingPersistRef.current = {
      state,
      persistOptions: options && Object.keys(options).length > 0 ? options : undefined,
      generation: persistGenerationRef.current,
    }
    clearSaveStatusTimer()
    setSaveState('saving')
    setSavingEdit(true)
    const previous = saveQueueRef.current.catch(() => null)
    const queued = previous.then(async () => {
      let lastResult = lastPersistResultRef.current
      activePersistRef.current = true
      try {
        while (pendingPersistRef.current) {
          const job = pendingPersistRef.current
          pendingPersistRef.current = null
          const fingerprintHint = lastSavedFingerprintRef.current || job.state.editor_fingerprint
          const payload = fingerprintHint
            ? { ...job.state, editor_fingerprint: fingerprintHint }
            : job.state
          try {
            const result = await persistPalaceEditor(
              session.palace_id,
              payload,
              job.persistOptions,
            )
            const fingerprint = result.state.editor_fingerprint
            if (fingerprint) lastSavedFingerprintRef.current = fingerprint
            const adopted = {
              ...job.state,
              editor_fingerprint: fingerprint || job.state.editor_fingerprint,
            }
            const isLatest = persistGenerationRef.current === job.generation
            if (isLatest) {
              // Fingerprint-only acknowledgement: never replace the local document.
              editBaselineRef.current = adopted
              onEditorStateSaved?.(adopted)
            }
            if (job.persistOptions?.reconcileUnits || job.persistOptions?.syncReason) {
              notifyUnitReconcile(result.unitReconcile)
            }
            lastResult = {
              state: isLatest
                ? adopted
                : {
                    ...editEditorStateRef.current,
                    editor_fingerprint: fingerprint || editEditorStateRef.current.editor_fingerprint,
                  },
              unitReconcile: result.unitReconcile,
            }
            lastPersistResultRef.current = lastResult
          } catch (error) {
            const message = error instanceof Error ? error.message : '保存宫殿失败'
            lastFailedPersistRef.current = {
              state: job.state,
              persistOptions: job.persistOptions,
            }
            onSaveFailed?.(message)
            lastResult = null
            lastPersistResultRef.current = null
          }
        }
        return lastResult
      } finally {
        activePersistRef.current = false
      }
    })
    saveQueueRef.current = queued
    void queued.finally(() => {
      if (saveQueueRef.current !== queued) return
      setSavingEdit(false)
      if (lastPersistResultRef.current) {
        lastFailedPersistRef.current = null
        showSavedStatus()
      } else {
        setSaveState('error')
      }
    })
    return queued
  }, [
    clearSaveStatusTimer,
    notifyUnitReconcile,
    onEditorStateSaved,
    onSaveFailed,
    session.palace_id,
    showSavedStatus,
  ])

  const retrySave = useCallback(() => {
    const failed = lastFailedPersistRef.current
    if (!failed) return
    void persistEdit(editEditorStateRef.current, failed.persistOptions)
  }, [persistEdit])

  /**
   * The active card never reconciles or rebuilds the queue. The same document is
   * reconciled only when this card leaves the editing session.
   */
  const flushEditorLeave = useCallback(() => {
    return persistEdit(editEditorStateRef.current, {
      reconcileUnits: true,
      syncReason: 'editor_leave',
    })
  }, [persistEdit])

  const flushEditorLeaveRef = useRef(flushEditorLeave)
  flushEditorLeaveRef.current = flushEditorLeave
  /** Avoid double editor_leave when card deactivates then unmounts. */
  const leaveReconcileSentRef = useRef(false)

  // Card deactivated after inline edits: flush with editor_leave + reconcile.
  useEffect(() => {
    if (active) {
      leaveReconcileSentRef.current = false
      editedSinceReconcileRef.current = false
      return
    }
    if (!editedSinceReconcileRef.current) return
    if (leaveReconcileSentRef.current) return
    leaveReconcileSentRef.current = true
    void flushEditorLeaveRef.current()
  }, [active])

  // Unmount after inline edits: same leave reconcile (no-op if deactivate already sent).
  useEffect(() => () => {
    if (!editedSinceReconcileRef.current) return
    if (leaveReconcileSentRef.current) return
    leaveReconcileSentRef.current = true
    void flushEditorLeaveRef.current()
  }, [])

  const restoreRevealSnapshot = useCallback((map: Record<string, RevealState> | null) => {
    if (!map) return
    revealApiRef.current.setRevealMap(map)
    onRevealMapChange?.(map)
  }, [onRevealMapChange])

  const handleToggleMode = useCallback(() => {
    const currentReveal = revealApiRef.current.revealMap
    const flipProgress = countUnitFlipProgress(currentReveal, flipTargetUids)
    const flipDetail = `翻卡 ${flipProgress.revealed}/${flipProgress.total}`
    if (!isEditMode) {
      editRevealSnapshotRef.current = { ...currentReveal }
      onRevealMapChange?.(currentReveal)
      recordSessionRecorderUiAction('mindmap', '进入编辑', flipDetail)
      setEditEditorState(editBaselineRef.current)
      setPermanentMarkMode(false)
      setDisplayMode('edit')
      setModeSyncVersion((value) => value + 1)
      return
    }
    restoreRevealSnapshot(editRevealSnapshotRef.current)
    recordSessionRecorderUiAction('mindmap', '返回学习', flipDetail)
    setPermanentMarkMode(false)

    // Local-first return: adopt the latest committed document before any HTTP work.
    const localState = {
      ...editEditorStateRef.current,
      editor_fingerprint:
        lastSavedFingerprintRef.current
        || editEditorStateRef.current.editor_fingerprint
        || '',
    }
    editBaselineRef.current = localState
    onEditorStateSaved?.(localState)
    setDisplayMode('review')
    setModeSyncVersion((value) => value + 1)
  }, [
    flipTargetUids,
    isEditMode,
    onEditorStateSaved,
    onRevealMapChange,
    restoreRevealSnapshot,
  ])

  const handleEditorStateChange = useCallback((nextState: MindMapEditorState) => {
    persistGenerationRef.current += 1
    setEditEditorState(nextState)
    editBaselineRef.current = nextState
    editEditorStateRef.current = nextState
    editedSinceReconcileRef.current = true
    void persistEdit(nextState)
  }, [persistEdit])

  /**
   * Permanent-mark toggles update locally and save immediately as plain document
   * writes. Schedule reconcile waits until the card leaves this editing session.
   */
  const handlePermanentMarkClick = useCallback((nodes: MindMapSelection[]) => {
    const uid = nodes[0]?.uid
    if (!uid) return
    const doc = editEditorStateRef.current.editor_doc as EditorDoc
    const result = togglePermanentMarkInDoc(doc, String(uid))
    if (result.doc === doc) return
    const nextState = { ...editEditorStateRef.current, editor_doc: result.doc }
    persistGenerationRef.current += 1
    setEditEditorState(nextState)
    editBaselineRef.current = nextState
    editEditorStateRef.current = nextState
    editedSinceReconcileRef.current = true
    void persistEdit(nextState)
    // Per-node feedback: the chip on the node already shows the mark; a toast per
    // toggle turned a marking pass into a stream of interruptions.
    showQuietStatus(result.marked ? '已标记' : '已取消标记')
  }, [persistEdit, showQuietStatus])

  const handleTogglePermanentMarkMode = useCallback(() => {
    setPermanentMarkMode((current) => {
      const next = !current
      showQuietStatus(next ? '永久标记：点击节点标记 / 取消' : '已退出永久标记')
      return next
    })
  }, [showQuietStatus])

  const permanentMarkChips = useMemo(() => {
    const doc = editEditorState.editor_doc as EditorDoc
    const marked = collectPermanentMarkUids(doc)
    const parentMap = buildEditorParentMap(doc)
    const rootUid = collectRootUid(doc)
    return buildSplitMarkStatusChips(marked, parentMap, rootUid)
  }, [editEditorState])

  const permanentMarkHighlights = useMemo(
    () => Object.keys(permanentMarkChips),
    [permanentMarkChips],
  )

  const {
    quizNodeBindings,
    nodeQuizOpen,
    setNodeQuizOpen,
    nodeQuizNodeUid,
    nodeQuizQuestionIds,
    nodeQuizInitialIndex,
    handleOpenNodeQuiz,
  } = useFreestyleUnitReviewNodeQuiz({
    palaceId: session.palace_id,
    editorDoc: (isEditMode ? editEditorState : editorState).editor_doc,
  })
  const textToMindMap = useFreestyleTextToMindMap({
    palaceId: session.palace_id, card, sessionTitle: session.title || '', isEditMode,
    editorState, editEditorState, handleToggleMode, setReviewUnitsPanelOpen,
    permanentMarkMode, permanentMarkHighlightsLength: permanentMarkHighlights.length,
    handleTogglePermanentMarkMode, savingEdit, onRevealMapChange, revealApiRef,
    displayModeRef, editRevealSnapshotRef, setPermanentMarkMode, setDisplayMode,
    setModeSyncVersion, handleEditorStateChange,
  })

  return (
    <>
      <FreestyleUnitReviewStatusBanner
        saveState={saveState}
        onRetry={retrySave}
        quietStatus={quietStatus ?? ''}
      />

      <FlipCardMindMapPanel
        fullscreen={fullscreen}
        displayMode={displayMode}
        sessionKind="review"
        chromeDensity="compact"
        hidePresentationOverflowActions
        hostFullscreenControl
        modeSyncVersion={modeSyncVersion}
        onToggleFullscreen={onToggleFullscreen}
        visibleEditorState={
          isEditMode
            ? editEditorState
            : (reveal.visibleEditorState ?? editorState)
        }
        editableEditorState={editEditorState}
        visibleEditorSyncKey={
          isEditMode
            ? `freestyle-edit:${session.palace_id}:${modeSyncVersion}`
            : reveal.visibleEditorSyncKey
        }
        unitScopeEditorState={editorState}
        activeUnitNodeUids={flipTargetUids}
        scopeBranchUid={isEditMode && flipCardRevealSettings.settings.editScope !== 'palace' ? (unit.anchor_uid || null) : null}
        forceExpanded={isEditMode && flipCardRevealSettings.settings.editScope !== 'palace'}
        revealCollapsedNodeIds={editRevealCollapsedNodeIds}
        countBadgeByNodeUid={quizNodeBindings.countBadgeByNodeUid}
        onCountBadgeClick={handleOpenNodeQuiz}
        onEditorStateChange={isEditMode ? handleEditorStateChange : undefined}
        onNodeClick={isEditMode ? () => undefined : reveal.handleNodeClick}
        onNodeContextMenu={
          isEditMode ? () => undefined : reveal.handleNodeContextMenu
        }
        onEditNodeClick={
          permanentMarkMode ? handlePermanentMarkClick : undefined
        }
        onEditNodeContextMenu={
          permanentMarkMode ? handlePermanentMarkClick : undefined
        }
        statusChipsByNodeUid={
          isEditMode && (permanentMarkMode || permanentMarkHighlights.length > 0)
            ? permanentMarkChips
            : undefined
        }
        highlightedNodeUids={
          isEditMode && permanentMarkHighlights.length > 0
            ? permanentMarkHighlights
            : undefined
        }
        toolbarExtensions={{
          moreActions: textToMindMap.moreActions,
          quizAction: onOpenScopeQuiz
            ? { label: '做题', onClick: onOpenScopeQuiz, opensOverlay: true }
            : null,
        }}
        textActionLabel="文字"
        revealSettings={flipCardRevealSettings}
        freestyleFlipMode={onFreestyleFlipModeChange
          ? { value: freestyleFlipMode, onChange: onFreestyleFlipModeChange }
          : undefined}
        freestyleAutoAdvance={onAutoAdvanceChange
          ? { value: autoAdvance, onChange: onAutoAdvanceChange }
          : undefined}
        preferredZoom={preferredZoom}
        onUserZoomChange={onUserZoomChange}
        toolbarCenterContent={
          <PalaceLadderProgress
            palaceId={session.palace_id}
            unitId={unit.id}
            refreshKey={`${unit.id}:${unit.stage_index}:${unit.due_date}:${unit.encounter?.id ?? ''}`}
          />
        }
        onNodeActive={textToMindMap.onNodeActive}
        onNodeHover={isEditMode ? undefined : reveal.handleNodeHover}
        onPaneDoubleClick={handleToggleMode}
        preserveViewOnSync
        initialViewPolicy="preserve"
        sceneTransitionFallbackNodeId={unit.anchor_uid || null}
        className="min-h-0 flex-1"
        surfaceClassName="h-full min-h-0"
      />
      <FreestyleUnitReviewFlipDialogs
        nodeQuizOpen={nodeQuizOpen}
        setNodeQuizOpen={setNodeQuizOpen}
        palaceId={session.palace_id}
        nodeQuizNodeUid={nodeQuizNodeUid}
        nodeQuizQuestionIds={nodeQuizQuestionIds}
        nodeQuizInitialIndex={nodeQuizInitialIndex}
        questionStates={quizNodeBindings.questionStates}
        updateQuestionState={quizNodeBindings.updateQuestionState}
        markQuestionCompleted={quizNodeBindings.markQuestionCompleted}
        reviewUnitsPanelOpen={reviewUnitsPanelOpen}
        setReviewUnitsPanelOpen={setReviewUnitsPanelOpen}
        lastUndoToken={lastUndoToken}
        recentUnitChanges={recentUnitChanges}
        onUnitsReconciled={onUnitsReconciled}
      />
      {textToMindMap.drawer}
    </>
  )
}
