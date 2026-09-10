import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import {
  PalaceReviewUnitsPanel,
  type PalaceReviewUnitChangeHighlight,
} from '@/modules/practice/ui/review/components/PalaceReviewUnitsPanel'
import { PalaceLadderProgress } from '@/modules/practice/ui/review/components/PalaceLadderProgress'
import { useRevealSession } from '@/modules/memory/public'
import { isWeakerRevealMap, type RevealState } from '@/modules/session/public'
import { useFlipCardRevealSettings } from '@/modules/settings/public'
import { usePalaceQuizNodeBindings } from '@/modules/quiz/public'
import type {
  FreestyleReviewUnitCard,
  MindMapEditorState,
  PalaceUnitReconcileResult,
} from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/public'
import { copyMindMapToClipboard, exportMindMapToFile } from '@/modules/content/public'
import type {
  FreestyleFlipMode,
  ReviewUnitDto,
  UnitReviewSessionDto,
} from '@/modules/practice/public'
import { countUnitFlipProgress } from '@/modules/practice/ui/freestyle/model/unitFlipProgress'
import { isFreestyleShortcutBlocked } from '@/modules/practice/ui/freestyle/model/freestyleKeyboard'
import { useFreestyleFlowFeedback } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFlowFeedback'
import { toast } from '@/shared/feedback/toast'
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
import {
  FlipCardMindMapPanel,
  NodeBoundQuizDialog,
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
}: {
  card: FreestyleReviewUnitCard
  session: UnitReviewSessionDto
  unit: ReviewUnitDto
  editorState: MindMapEditorState
  /** When false (card left / inactive), flush edit with leave reconcile. */
  active?: boolean
  fullscreen: boolean
  onToggleFullscreen: (active?: boolean) => void
  freestyleFlipMode?: FreestyleFlipMode
  onFreestyleFlipModeChange?: (value: FreestyleFlipMode) => void
  /** Advance after a passing rate; surfaced in 翻卡设置. */
  autoAdvance?: boolean
  onAutoAdvanceChange?: (value: boolean) => void
  preferredZoom?: number
  onUserZoomChange?: (zoom: number) => void
  /** Parent hides rating overlay while inline editing. */
  onEditingChange?: (editing: boolean) => void
  onSaveFailed?: (message: string) => void
  /** Optional silent freestyle queue rebuild after unit reconcile changes. */
  onUnitsReconciled?: () => void
  /** Live flip progress for the card header chip (revealed / flippable total). */
  onRevealProgressChange?: (progress: { revealed: number; total: number }) => void
  /** Adopt the saved doc so review shows the edited content after returning. */
  onEditorStateSaved?: (state: MindMapEditorState) => void
  syncedRevealMap?: Record<string, string> | null
  onRevealMapChange?: (revealMap: Record<string, string>) => void
}) {
  const flipCardRevealSettings = useFlipCardRevealSettings()
  const allowedRevealNodeIds = useMemo(() => {
    if (freestyleFlipMode !== 'focused') return undefined
    const parentByUid = buildEditorParentMap(editorState.editor_doc as EditorDoc)
    const allowed = new Set<string>()
    const seeds = new Set([...(unit.node_uids || []), unit.anchor_uid].filter(Boolean))
    for (const seed of seeds) {
      let current: string | null = String(seed)
      while (current) {
        if (allowed.has(current)) break
        allowed.add(current)
        current = parentByUid.get(current) ?? null
      }
    }
    return [...allowed]
  }, [editorState.editor_doc, freestyleFlipMode, unit.anchor_uid, unit.node_uids])
  const reveal = useRevealSession({
    title: card.palace_title || session.title || `宫殿 ${card.palace_id}`,
    editorState,
    revealConfig: flipCardRevealSettings.settings,
    allowedNodeIds: allowedRevealNodeIds,
    syncedRevealMap: syncedRevealMap as Record<string, RevealState> | null,
  })
  const { handleNodeContextMenu, handleTargetNodeClick, root } = reveal
  const { signalReveal } = useFreestyleFlowFeedback()

  const lastNotifiedRevealKeyRef = useRef('')
  // Header chip: this unit's membership only (not whole-palace node count).
  useEffect(() => {
    onRevealProgressChange?.(
      countUnitFlipProgress(reveal.revealMap, unit.node_uids, unit.anchor_uid),
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
    onRevealMapChange,
    onRevealProgressChange,
    reveal.revealMap,
    syncedRevealMap,
    unit.anchor_uid,
    unit.node_uids,
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

  const [displayMode, setDisplayMode] = useState<'review' | 'edit'>('review')
  const [editEditorState, setEditEditorState] = useState<MindMapEditorState>(editorState)
  const [modeSyncVersion, setModeSyncVersion] = useState(0)
  const [permanentMarkMode, setPermanentMarkMode] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [returnSaveState, setReturnSaveState] = useState<'idle' | 'saving' | 'failed'>('idle')
  /**
   * Quiet status replaces the old toast stack. Save / mark / reconcile notices
   * belong on the card that changed, not flying into a screen corner mid-recall.
   */
  const [quietStatus, setQuietStatus] = useState<string | null>(null)
  const quietStatusTimerRef = useRef<number | null>(null)
  const [reviewUnitsPanelOpen, setReviewUnitsPanelOpen] = useState(false)
  const [lastUndoToken, setLastUndoToken] = useState<string | null>(null)
  const [recentUnitChanges, setRecentUnitChanges] = useState<PalaceReviewUnitChangeHighlight[]>([])
  const saveTimerRef = useRef<number | null>(null)
  const saveQueueRef = useRef<Promise<PersistPalaceEditorResult | null>>(Promise.resolve(null))
  const editBaselineRef = useRef(editorState)
  const editEditorStateRef = useRef(editorState)
  const displayModeRef = useRef<'review' | 'edit'>('review')
  const persistGenerationRef = useRef(0)
  const pendingPersistRef = useRef<{
    state: MindMapEditorState
    persistOptions?: PersistPalaceEditorOptions
    quiet: boolean
    generation: number
  } | null>(null)
  const activePersistRef = useRef(false)
  const lastSavedFingerprintRef = useRef(editorState.editor_fingerprint || '')
  const lastPersistResultRef = useRef<PersistPalaceEditorResult | null>(null)
  /** Mark-pass reconcile may finish while still editing; rebuild freestyle only after leaving edit. */
  const pendingQueueRebuildRef = useRef(false)
  const editRevealSnapshotRef = useRef<Record<string, RevealState> | null>(null)
  const lastRevealRecordKeyRef = useRef('')
  const revealApiRef = useRef(reveal)
  const isEditMode = displayMode === 'edit'
  editEditorStateRef.current = editEditorState
  displayModeRef.current = displayMode
  revealApiRef.current = reveal

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
    }
  }, [])

  const notifyUnitReconcile = useCallback((
    unitReconcile: PalaceUnitReconcileResult | null | undefined,
    options?: { rebuildQueue?: boolean },
  ) => {
    const rebuildQueue = options?.rebuildQueue !== false
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
      if (!rebuildQueue) {
        // Stay in inline edit after a finished mark pass: keep card mounted and
        // rebuild freestyle only when returning to review / leaving the card.
        pendingQueueRebuildRef.current = true
        showQuietStatus('复习进度已更新，返回学习后同步')
        return
      }
      pendingQueueRebuildRef.current = false
      showQuietStatus('复习进度已更新')
      onUnitsReconciled?.()
      return
    }
    if (rebuildQueue && pendingQueueRebuildRef.current) {
      pendingQueueRebuildRef.current = false
      showQuietStatus('复习进度已更新')
      onUnitsReconciled?.()
    }
  }, [onUnitsReconciled, showQuietStatus])

  const persistEdit = useCallback(async (
    state: MindMapEditorState,
    options?: PersistPalaceEditorOptions & { quiet?: boolean },
  ) => {
    const { quiet, ...persistOptions } = options ?? {}
    pendingPersistRef.current = {
      state,
      persistOptions: Object.keys(persistOptions).length > 0 ? persistOptions : undefined,
      quiet: Boolean(quiet),
      generation: persistGenerationRef.current,
    }
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
              setEditEditorState(adopted)
              editBaselineRef.current = adopted
              editEditorStateRef.current = adopted
              if (!job.quiet) {
                showQuietStatus('已保存宫殿编辑')
              }
            }
            if (job.persistOptions?.reconcileUnits || job.persistOptions?.syncReason) {
              const stayEditingAfterFlush = (
                (job.persistOptions.syncReason === 'mark_change' || job.persistOptions.syncReason === 'return_to_review')
                && displayModeRef.current === 'edit'
              )
              notifyUnitReconcile(result.unitReconcile, {
                rebuildQueue: !stayEditingAfterFlush,
              })
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
            onSaveFailed?.(message)
            toast.error(message)
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
      if (saveQueueRef.current === queued) setSavingEdit(false)
    })
    return queued
  }, [notifyUnitReconcile, onSaveFailed, session.palace_id, showQuietStatus])

  const clearPersistTimer = useCallback(() => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [])

  /** Typing autosave: plain path, no force reconcile, quiet toast. */
  const schedulePersist = useCallback(() => {
    if (activePersistRef.current) {
      clearPersistTimer()
      return
    }
    clearPersistTimer()
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void persistEdit(editEditorStateRef.current, { quiet: true })
    }, 2000)
  }, [clearPersistTimer, persistEdit])

  /**
   * Flush pending or current edit with leave/mark reconcile flags.
   * Always sends reconcile so backend can demote even if the debounced
   * autosave already wrote the same doc without reconcile.
   */
  const flushPersistWithReconcile = useCallback((
    syncReason: 'return_to_review' | 'editor_leave' | 'mark_change',
    state?: MindMapEditorState,
    quiet = false,
  ) => {
    clearPersistTimer()
    const nextState = state ?? editEditorStateRef.current
    return persistEdit(nextState, {
      reconcileUnits: true,
      syncReason,
      quiet,
    })
  }, [clearPersistTimer, persistEdit])

  const flushPersistWithReconcileRef = useRef(flushPersistWithReconcile)
  flushPersistWithReconcileRef.current = flushPersistWithReconcile
  /** Avoid double editor_leave when card deactivates then unmounts. */
  const leaveReconcileSentRef = useRef(false)

  // Card deactivated while still editing: flush with editor_leave + reconcile.
  useEffect(() => {
    if (active) {
      leaveReconcileSentRef.current = false
      return
    }
    if (displayModeRef.current !== 'edit') return
    if (leaveReconcileSentRef.current) return
    leaveReconcileSentRef.current = true
    void flushPersistWithReconcileRef.current('editor_leave', undefined, true)
  }, [active])

  // Unmount while editing: same leave reconcile (no-op if deactivate already sent).
  useEffect(() => () => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (displayModeRef.current !== 'edit') return
    if (leaveReconcileSentRef.current) return
    leaveReconcileSentRef.current = true
    void flushPersistWithReconcileRef.current('editor_leave', undefined, true)
  }, [])

  const restoreRevealSnapshot = useCallback((map: Record<string, RevealState> | null) => {
    if (!map) return
    revealApiRef.current.setRevealMap(map)
    onRevealMapChange?.(map)
  }, [onRevealMapChange])

  const handleToggleMode = useCallback(() => {
    const currentReveal = revealApiRef.current.revealMap
    const flipProgress = countUnitFlipProgress(currentReveal, unit.node_uids, unit.anchor_uid)
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
    // Optimistic return: switch to review right away and save in the background.
    // The card adopts the saved doc (onEditorStateSaved) once the flush settles;
    // a failed save leaves the editor usable instead of trapping the user.
    setDisplayMode('review')
    setModeSyncVersion((value) => value + 1)
    setReturnSaveState('saving')
    void flushPersistWithReconcile('return_to_review', editEditorStateRef.current, true)
      .then((result) => {
        if (!result) {
          setReturnSaveState('failed')
          setDisplayMode('edit')
          setModeSyncVersion((value) => value + 1)
          return
        }
        restoreRevealSnapshot(editRevealSnapshotRef.current)
        setReturnSaveState('idle')
        onEditorStateSaved?.(result.state)
      })
  }, [
    flushPersistWithReconcile,
    isEditMode,
    onEditorStateSaved,
    onRevealMapChange,
    restoreRevealSnapshot,
    unit.anchor_uid,
    unit.node_uids,
  ])

  const handleEditorStateChange = useCallback((nextState: MindMapEditorState) => {
    persistGenerationRef.current += 1
    setEditEditorState(nextState)
    editBaselineRef.current = nextState
    editEditorStateRef.current = nextState
    pendingPersistRef.current = {
      state: nextState,
      quiet: true,
      generation: persistGenerationRef.current,
    }
    schedulePersist()
  }, [schedulePersist])

  /**
   * Permanent-mark toggles stay local + plain debounced autosave while the user
   * is still marking. Reconcile only when exiting mark mode / returning to review /
   * leaving the card — so continuous mark edits do not rebuild freestyle mid-pass.
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
    pendingPersistRef.current = {
      state: nextState,
      quiet: true,
      generation: persistGenerationRef.current,
    }
    schedulePersist()
    // Per-node feedback: the chip on the node already shows the mark; a toast per
    // toggle turned a marking pass into a stream of interruptions.
    showQuietStatus(result.marked ? '已标记' : '已取消标记')
  }, [schedulePersist, showQuietStatus])

  const handleTogglePermanentMarkMode = useCallback(() => {
    setPermanentMarkMode((current) => {
      const next = !current
      if (current && !next) {
        // Finished this mark pass: one reconcile for the whole batch.
        void flushPersistWithReconcile('mark_change', editEditorStateRef.current, true)
        showQuietStatus('已退出永久标记，正在整理复习进度')
      } else {
        showQuietStatus(next ? '永久标记：点击节点标记 / 取消' : '已退出永久标记')
      }
      return next
    })
  }, [flushPersistWithReconcile, showQuietStatus])

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

  // Badge counts must use the full palace doc (not the flip-reveal visible subtree),
  // matching formal review — otherwise parent badges grow as children are revealed.
  const quizNodeBindings = usePalaceQuizNodeBindings({
    palaceId: session.palace_id,
    editorDoc: (isEditMode ? editEditorState : editorState).editor_doc,
    enabled: Boolean(session.palace_id),
  })
  const getOpenQuestionIds = quizNodeBindings.getOpenQuestionIds
  const getInitialQuestionIndex = quizNodeBindings.getInitialQuestionIndex
  const [nodeQuizOpen, setNodeQuizOpen] = useState(false)
  const [nodeQuizNodeUid, setNodeQuizNodeUid] = useState<string | null>(null)
  const [nodeQuizQuestionIds, setNodeQuizQuestionIds] = useState<number[]>([])
  const [nodeQuizInitialIndex, setNodeQuizInitialIndex] = useState(0)

  const handleOpenNodeQuiz = useCallback(
    (nodeUid: string) => {
      const ids = getOpenQuestionIds(nodeUid)
      if (!ids.length) {
        toast.message('该卡片没有关联题目。')
        return
      }
      setNodeQuizNodeUid(nodeUid)
      setNodeQuizQuestionIds(ids)
      setNodeQuizInitialIndex(getInitialQuestionIndex(ids))
      setNodeQuizOpen(true)
    },
    [getInitialQuestionIndex, getOpenQuestionIds],
  )

  const moreActions = useMemo(() => {
    const actions: Array<{
      label: string
      onClick: () => void
      disabled?: boolean
      separatorBefore?: boolean
    }> = [
      {
        label: isEditMode ? '返回学习' : '进入编辑',
        onClick: handleToggleMode,
      },
      {
        label: '复习进度',
        onClick: () => setReviewUnitsPanelOpen(true),
        separatorBefore: true,
      },
    ]
    const palaceTitle = card.palace_title || session.title || `宫殿 ${card.palace_id}`
    actions.push({
      label: '复制导图',
      onClick: () => {
        void copyMindMapToClipboard(editorState, palaceTitle)
          .then(() => toast.success('脑图已复制到剪切板'))
          .catch((error: unknown) => toast.error(error instanceof Error ? error.message : '复制脑图失败。'))
      },
      separatorBefore: true,
    })
    actions.push({
      label: '导出脑图',
      onClick: () => {
        try {
          exportMindMapToFile(editorState, palaceTitle)
          toast.success('脑图已导出')
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '导出脑图失败。')
        }
      },
      disabled: !editorState?.editor_doc,
    })
    if (isEditMode) {
      actions.push({
        label: permanentMarkMode
          ? `退出永久标记${permanentMarkHighlights.length ? `（已标 ${permanentMarkHighlights.length}）` : ''}`
          : permanentMarkHighlights.length
            ? `永久标记（已标 ${permanentMarkHighlights.length}）`
            : '永久标记',
        onClick: handleTogglePermanentMarkMode,
        // Keep mark mode usable while a plain autosave is in flight.
        disabled: permanentMarkMode ? false : savingEdit,
        separatorBefore: true,
      })
    }
    return actions
  }, [
    card.palace_id,
    card.palace_title,
    editorState,
    handleToggleMode,
    handleTogglePermanentMarkMode,
    isEditMode,
    permanentMarkHighlights.length,
    permanentMarkMode,
    savingEdit,
    session.title,
  ])

  return (
    <>
      {returnSaveState === 'saving' ? (
        <div
          data-testid="freestyle-return-saving"
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center sm:bottom-6"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-300/80 bg-white/95 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-lg backdrop-blur-sm dark:border-white/20 dark:bg-zinc-900/92 dark:text-zinc-100">
            <LoaderCircle className="size-3.5 animate-spin" />
            正在保存宫殿…
          </span>
        </div>
      ) : quietStatus ? (
        <div
          data-testid="freestyle-quiet-status"
          role="status"
          className="pointer-events-none absolute inset-x-0 bottom-20 z-30 flex justify-center sm:bottom-16"
        >
          <span className="max-w-[min(20rem,90%)] truncate rounded-full border border-black/8 bg-white/92 px-3 py-1 text-[11px] font-medium text-zinc-700 shadow-sm backdrop-blur-sm">
            {quietStatus}
          </span>
        </div>
      ) : null}

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
        activeUnitNodeUids={[...new Set([...(unit.node_uids || []), unit.anchor_uid].filter(Boolean))]}
        scopeBranchUid={isEditMode && flipCardRevealSettings.settings.editScope !== 'palace' ? (unit.anchor_uid || null) : null}
        forceExpanded={isEditMode && flipCardRevealSettings.settings.editScope !== 'palace'}
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
        toolbarExtensions={{ moreActions }}
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
        onNodeActive={() => undefined}
        onNodeHover={isEditMode ? undefined : reveal.handleNodeHover}
        onPaneDoubleClick={handleToggleMode}
        preserveViewOnSync
        initialViewPolicy="preserve"
        sceneTransitionFallbackNodeId={unit.anchor_uid || null}
        /* flex-1 rather than h-full: the card surface is now a flex column whose first
           row is the unit identity chip, so h-full would overflow it by that row.
           Rating-bar inset lives on the map shell so fitView stays above the overlay. */
        className="min-h-0 flex-1"
        surfaceClassName="h-full min-h-0"
      />
      <NodeBoundQuizDialog
        open={nodeQuizOpen}
        onOpenChange={setNodeQuizOpen}
        palaceId={session.palace_id}
        nodeUid={nodeQuizNodeUid}
        questionIds={nodeQuizQuestionIds}
        initialIndex={nodeQuizInitialIndex}
        initialQuestionStates={quizNodeBindings.questionStates}
        onQuestionStateChange={quizNodeBindings.updateQuestionState}
        onQuestionCompleted={quizNodeBindings.markQuestionCompleted}
      />
      <PalaceReviewUnitsPanel
        open={reviewUnitsPanelOpen}
        palaceId={session.palace_id}
        onClose={() => setReviewUnitsPanelOpen(false)}
        undoToken={lastUndoToken}
        recentChanges={recentUnitChanges}
        onScheduleChanged={() => onUnitsReconciled?.()}
      />
    </>
  )
}
