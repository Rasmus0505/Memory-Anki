import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { type PalaceReviewUnitChangeHighlight } from '@/modules/practice/ui/review/components/PalaceReviewUnitsPanel'
import { toast } from '@/shared/feedback/toast'
import { ReviewLevelBar } from '@/modules/practice/ui/review/components/ReviewLevelBar'
import { useRevealSession, type RevealState } from '@/modules/memory/public'
import { useFlipCardRevealSettings } from '@/modules/settings/public'
import {
  FreestyleUnitReviewFlipDialogs,
  FreestyleUnitReviewStatusBanner,
} from './FreestyleUnitReviewFlipCanvas'
import { buildReviewToolbarExtensions, useFreestyleUnitReviewNodeQuiz } from './freestyleUnitReviewFlipToolbar'
import { useFreestyleTextToMindMap } from './useFreestyleTextToMindMap'
import type {
  FreestyleReviewUnitCard,
  MindMapEditorState,
} from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/public'
import type {
  FreestyleFlipMode,
  ReviewUnitDto,
  UnitReviewSessionDto,
} from '@/modules/practice/public'
import { countUnitFlipProgress, unitFlipTargetUids } from '@/modules/practice/ui/freestyle/model/unitFlipProgress'
import { useFreestyleFlowFeedback } from '@/modules/practice/ui/freestyle/hooks/useFreestyleFlowFeedback'
import { useFreestyleFlipCardShortcuts } from './useFreestyleFlipCardShortcuts'
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
import { FlipCardMindMapPanel } from './freestyleBranchCardSupport'
import { useFreestyleUnitReviewPersistence } from './useFreestyleUnitReviewPersistence'

export function FreestyleUnitReviewFlipPanel({
  card,
  session,
  unit,
  editorState,
  active = true,
  reviewOnly = false,
  scopeNodeUids,
  fullscreen,
  onToggleFullscreen,
  freestyleFlipMode = 'free',
  onFreestyleFlipModeChange,
  preferredZoom,
  onUserZoomChange,
  onEditingChange,
  onSaveFailed,
  onEditorStateSaved,
  onUnitsReconciled,
  onBeforeReturnReconcile,
  onReturnReconcilePending,
  onRevealProgressChange,
  onOpenScopeQuiz,
  belowToolbarSlot = null,
  roundId = null,
  wrongThisRound = false,
}: {
  card: FreestyleReviewUnitCard
  session: UnitReviewSessionDto
  unit: ReviewUnitDto
  editorState: MindMapEditorState
  active?: boolean
  /** 睡前复习: reveal-only map; no editing, permanent marks, or document writes. */
  reviewOnly?: boolean
  scopeNodeUids?: string[]
  fullscreen: boolean
  onToggleFullscreen: (active?: boolean) => void
  freestyleFlipMode?: FreestyleFlipMode
  onFreestyleFlipModeChange?: (value: FreestyleFlipMode) => void
  preferredZoom?: number
  onUserZoomChange?: (zoom: number) => void
  onEditingChange?: (editing: boolean) => void
  onSaveFailed?: (message: string) => void
  onUnitsReconciled?: () => void | Promise<void>
  onBeforeReturnReconcile?: () => Promise<void>
  onReturnReconcilePending?: (pending: boolean) => void
  onRevealProgressChange?: (progress: { revealed: number; total: number }) => void
  onEditorStateSaved?: (state: MindMapEditorState) => void
  onOpenScopeQuiz?: () => void
  /** Unit identity row, drawn under the map toolbar (the toolbar owns the sheet edge). */
  belowToolbarSlot?: ReactNode
  /** The 随心 round, so 关联题目 can badge each question with its this-round rating. */
  roundId?: string | null
  wrongThisRound?: boolean
}) {
  const flipCardRevealSettings = useFlipCardRevealSettings()
  // Sticky: once this card has been the active one, keep its ladder so swiping back
  // doesn't blank and refetch it.
  const [ladderEnabled, setLadderEnabled] = useState(active)
  if (active && !ladderEnabled) setLadderEnabled(true)
  const [displayMode, setDisplayMode] = useState<'review' | 'edit'>('review')
  const [editEditorState, setEditEditorState] = useState<MindMapEditorState>(editorState)
  const editEditorStateRef = useRef(editorState)
  const displayModeRef = useRef<'review' | 'edit'>('review')
  const isEditMode = displayMode === 'edit'
  // 当前专线 only narrows the projection. A structure edit on a spine card asks
  // for the whole palace so the created/removed card stays on screen; the
  // override lasts for this edit session, not the stored setting.
  const [fullPalaceEdit, setFullPalaceEdit] = useState(false)
  const scopedEdit = isEditMode
    && flipCardRevealSettings.settings.editScope !== 'palace'
    && !fullPalaceEdit
  useEffect(() => {
    setFullPalaceEdit(false)
  }, [isEditMode, unit.anchor_uid, flipCardRevealSettings.settings.editScope])
  // A 进入编辑 tap received while this panel is still a read-only preview.
  const pendingEditRef = useRef(false)
  editEditorStateRef.current = editEditorState
  displayModeRef.current = displayMode

  const flipTargetUids = useMemo(
    () => (scopeNodeUids?.length ? Array.from(new Set(scopeNodeUids)) : unitFlipTargetUids(unit.node_uids, unit.anchor_uid)),
    [scopeNodeUids, unit.anchor_uid, unit.node_uids],
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
    pendingAdvancePolicy: 'latest-only',
    allowedNodeIds: allowedRevealNodeIds,
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

  const { signalReveal } = useFreestyleFlowFeedback()
  useEffect(() => onRevealProgressChange?.(
    countUnitFlipProgress(reveal.revealMap, flipTargetUids),
  ), [flipTargetUids, onRevealProgressChange, reveal.revealMap])
  const revealedCount = Object.values(reveal.revealMap).filter((state) => state === 'revealed').length
  const revealBaselineKey = `${card.id}:${unit.encounter?.id ?? 'none'}`
  const revealBaselineRef = useRef<{ key: string; revealed: number } | null>(null)

  useEffect(() => {
    const baseline = revealBaselineRef.current
    revealBaselineRef.current = { key: revealBaselineKey, revealed: revealedCount }
    if (!active || baseline?.key !== revealBaselineKey) return
    if (revealedCount > baseline.revealed) signalReveal()
  }, [active, revealBaselineKey, revealedCount, signalReveal])

  const [modeSyncVersion, setModeSyncVersion] = useState(0)
  const [permanentMarkMode, setPermanentMarkMode] = useState(false)
  const [quietStatus, setQuietStatus] = useState<string | null>(null)
  const quietStatusTimerRef = useRef<number | null>(null)
  const [reviewUnitsPanelOpen, setReviewUnitsPanelOpen] = useState(false)
  const [lastUndoToken, setLastUndoToken] = useState<string | null>(null)
  const [recentUnitChanges, setRecentUnitChanges] = useState<PalaceReviewUnitChangeHighlight[]>([])
  const editBaselineRef = useRef(editorState)
  const editRevealSnapshotRef = useRef<Record<string, RevealState> | null>(null)
  const lastRevealRecordKeyRef = useRef('')
  const revealApiRef = useRef(reveal)
  revealApiRef.current = reveal
  const revealFollow = useFreestyleFlipCardShortcuts({
    active,
    isEditMode,
    palaceTitle: card.palace_title || '',
    unitTitle: unit.title || '',
    anchorUid: unit.anchor_uid || '',
    revealApiRef,
    followEnabled: flipCardRevealSettings.settings.enterRevealFollow !== false,
  })

  // While reviewing, external/session replacement wins. During edit, the local
  // document stays authoritative until the card leaves the editing session.
  useEffect(() => {
    if (displayModeRef.current !== 'review') return
    if (editEditorStateRef.current === editorState) return
    setEditEditorState(editorState)
    editBaselineRef.current = editorState
    editEditorStateRef.current = editorState
  }, [editorState])

  // Session reload (stale rebuild) refreshes the edit baseline only while learning.
  useEffect(() => {
    if (isEditMode) return
    setEditEditorState(editorState)
    editBaselineRef.current = editorState
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
    const detail = summarizeRevealMapChange(previous, reveal.revealMap)
    if (detail) recordSessionRecorderUiAction('mindmap', '翻卡', detail)
  }, [isEditMode, reveal.revealMap])

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
    unitReconcile: import('@/shared/api/contracts').PalaceUnitReconcileResult | null | undefined,
    refreshQueue = false,
  ): void | Promise<void> => {
    if (unitReconcile?.changed || refreshQueue) {
      const token = unitReconcile?.undo_token ?? unitReconcile?.schedule_batch_id ?? null
      if (token) setLastUndoToken(token)
      if (Array.isArray(unitReconcile?.changes) && unitReconcile.changes.length > 0) {
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
      return onUnitsReconciled?.()
    }
  }, [onUnitsReconciled, showQuietStatus])

  const handlePersistReconcile = useCallback((
    result: import('./freestyleBranchCardSupport').PersistPalaceEditorResult,
    refreshQueue = false,
  ) => notifyUnitReconcile(result.unitReconcile, refreshQueue), [notifyUnitReconcile])

  const persistence = useFreestyleUnitReviewPersistence({
    palaceId: session.palace_id,
    editorState,
    editEditorStateRef,
    displayModeRef,
    onEditorStateSaved,
    onSaveFailed,
    onReconcile: handlePersistReconcile,
    onBeforeReturnReconcile,
    onReturnReconcilePending,
  })
  const {
    savingEdit, saveState, persistGenerationRef, editedSinceReconcileRef,
    returnReconcileRef, leaveReconcileSentRef, persistEdit, reconcileReturn, retrySave,
    flushEditorLeave, lastSavedFingerprintRef,
  } = persistence
  const flushEditorLeaveRef = useRef(flushEditorLeave)
  flushEditorLeaveRef.current = flushEditorLeave

  // Card deactivation and unmount are the idempotent fallback boundary.
  useEffect(() => {
    if (active) {
      leaveReconcileSentRef.current = false
      return
    }
    if (returnReconcileRef.current) return
    if (!editedSinceReconcileRef.current) return
    if (leaveReconcileSentRef.current) return
    leaveReconcileSentRef.current = true
    void flushEditorLeaveRef.current()
  }, [active, editedSinceReconcileRef, leaveReconcileSentRef, returnReconcileRef])

  useEffect(() => () => {
    if (!editedSinceReconcileRef.current || returnReconcileRef.current || leaveReconcileSentRef.current) return
    leaveReconcileSentRef.current = true
    void flushEditorLeaveRef.current()
  }, [editedSinceReconcileRef, leaveReconcileSentRef, returnReconcileRef])

  const restoreRevealSnapshot = useCallback((map: Record<string, RevealState> | null) => {
    if (!map) return
    revealApiRef.current.setRevealMap(map)
  }, [])

  const handleToggleMode = useCallback(() => {
    if (reviewOnly) return
    if (!active) {
      // Still a read-only preview: the live glance is opening. Keep the edit tap
      // and apply it when the glance arrives, instead of silently dropping it.
      if (!isEditMode && !pendingEditRef.current) {
        pendingEditRef.current = true
        toast.message('图还在打开，打开后自动进入编辑')
      }
      return
    }
    const currentReveal = revealApiRef.current.revealMap
    const flipProgress = countUnitFlipProgress(currentReveal, flipTargetUids)
    const flipDetail = `翻卡 ${flipProgress.revealed}/${flipProgress.total}`
    if (!isEditMode) {
      editRevealSnapshotRef.current = { ...currentReveal }
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
    displayModeRef.current = 'review'
    setDisplayMode('review')
    setModeSyncVersion((value) => value + 1)
    reconcileReturn()
  }, [
    active,
    reviewOnly,
    flipTargetUids,
    isEditMode,
    onEditorStateSaved,
    reconcileReturn,
    restoreRevealSnapshot,
    lastSavedFingerprintRef,
  ])

  useEffect(() => {
    if (!active) {
      pendingEditRef.current = false
      return
    }
    if (!pendingEditRef.current) return
    pendingEditRef.current = false
    handleToggleMode()
  }, [active, handleToggleMode])

  const handleEditorStateChange = useCallback((nextState: MindMapEditorState) => {
    persistGenerationRef.current += 1
    setEditEditorState(nextState)
    editBaselineRef.current = nextState
    editEditorStateRef.current = nextState
    editedSinceReconcileRef.current = true
    void persistEdit(nextState)
  }, [editedSinceReconcileRef, persistEdit, persistGenerationRef])

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
  }, [editedSinceReconcileRef, persistEdit, persistGenerationRef, showQuietStatus])

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
    handleQuestionDeleted,
  } = useFreestyleUnitReviewNodeQuiz({
    palaceId: session.palace_id,
    editorDoc: (isEditMode ? editEditorState : editorState).editor_doc,
    enabled: active,
  })
  const textToMindMap = useFreestyleTextToMindMap({
    palaceId: session.palace_id, card, sessionTitle: session.title || '', isEditMode,
    editorState, editEditorState, handleToggleMode, setReviewUnitsPanelOpen,
    revealApiRef,
    displayModeRef, editRevealSnapshotRef, setPermanentMarkMode, setDisplayMode,
    setModeSyncVersion, handleEditorStateChange,
  })

  return (
    <>
      {active ? <span hidden data-recorder-current="true" data-recorder-context="review" data-recorder-count={flipTargetUids.length} /> : null}
      <FreestyleUnitReviewStatusBanner
        saveState={saveState}
        onRetry={retrySave}
        quietStatus={quietStatus ?? ''}
      />

      <FlipCardMindMapPanel
        viewMemoryScope={`palace:${session.palace_id}`}
        fullscreen={fullscreen}
        displayMode={displayMode}
        keyboardViewPan={active}
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
        scopeBranchUid={scopedEdit ? (unit.anchor_uid || null) : null}
        // The escape widens to the whole palace, so keep it unfolded: the card
        // the learner just created or removed must be on screen.
        forceExpanded={isEditMode && (flipCardRevealSettings.settings.editScope !== 'palace' || fullPalaceEdit)}
        onRequestFullScope={isEditMode ? () => {
          if (!fullPalaceEdit) showQuietStatus('已展开整座宫殿')
          setFullPalaceEdit(true)
        } : undefined}
        revealCollapsedNodeIds={editRevealCollapsedNodeIds}
        countBadgeByNodeUid={quizNodeBindings.countBadgeByNodeUid}
        nodeProgressByNodeUid={quizNodeBindings.nodeProgressByNodeUid}
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
        toolbarExtensions={buildReviewToolbarExtensions({
          reviewOnly, moreActions: textToMindMap.moreActions, isEditMode, permanentMarkMode,
          markedCount: permanentMarkHighlights.length, savingEdit,
          onTogglePermanentMarkMode: handleTogglePermanentMarkMode, onOpenScopeQuiz,
        })}
        textActionLabel="文字"
        revealSettings={flipCardRevealSettings}
        freestyleFlipMode={onFreestyleFlipModeChange
          ? { value: freestyleFlipMode, onChange: onFreestyleFlipModeChange }
          : undefined}
        preferredZoom={preferredZoom}
        onUserZoomChange={onUserZoomChange}
        toolbarCenterContent={
          // Neighbour previews skip it (~1s fetch); a bedtime palace pass has no unit interval.
          ladderEnabled && !reviewOnly ? (
            <ReviewLevelBar
              wrongThisRound={wrongThisRound}
              unitId={unit.id}
              stageIndex={unit.stage_index}
              intervalDays={unit.interval_days}
              dueDate={unit.due_date}
              due={unit.due}
              adjustable
              onScheduleAdjusted={() => onUnitsReconciled?.()}
            />
          ) : null
        }
        onNodeActive={textToMindMap.onNodeActive}
        onNodeHover={isEditMode ? undefined : reveal.handleNodeHover}
        revealFollowNodeIds={revealFollow.nodeIds}
        revealFollowNonce={revealFollow.nonce}
        onPaneDoubleClick={reviewOnly ? undefined : handleToggleMode}
        preserveViewOnSync
        initialViewPolicy="preserve"
        sceneTransitionFallbackNodeId={unit.anchor_uid || null}
        belowToolbarSlot={belowToolbarSlot}
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
        onQuestionDeleted={handleQuestionDeleted}
        reviewUnitsPanelOpen={reviewUnitsPanelOpen}
        setReviewUnitsPanelOpen={setReviewUnitsPanelOpen}
        lastUndoToken={lastUndoToken}
        recentUnitChanges={recentUnitChanges}
        onUnitsReconciled={onUnitsReconciled}
        roundId={roundId}
      />
      {textToMindMap.drawer}
    </>
  )
}
