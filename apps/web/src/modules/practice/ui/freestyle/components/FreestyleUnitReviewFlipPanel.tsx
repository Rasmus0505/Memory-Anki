import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PalaceReviewUnitsPanel,
  type PalaceReviewUnitChangeHighlight,
} from '@/modules/practice/ui/review/components/PalaceReviewUnitsPanel'
import { useRevealSession } from '@/modules/memory/public'
import { usePalaceQuizNodeBindings } from '@/modules/quiz/public'
import type {
  FreestyleReviewUnitCard,
  MindMapEditorState,
  PalaceUnitReconcileResult,
} from '@/shared/api/contracts'
import type { MindMapSelection } from '@/modules/content/public'
import type { ReviewUnitDto, UnitReviewSessionDto } from '@/modules/practice/public'
import { toast } from '@/shared/feedback/toast'
import {
  buildEditorParentMap,
  buildSplitMarkStatusChips,
  collectPermanentMarkUids,
  collectRootUid,
  togglePermanentMarkInDoc,
  type EditorDoc,
} from '@/shared/lib/mindmap-split-marks/splitMarks'
import { NodeBoundQuizDialog } from '@/widgets/node-bound-quiz'
import {
  FlipCardMindMapPanel,
  persistPalaceEditor,
  type PersistPalaceEditorOptions,
  readBranchRevealSnapshot,
  writeBranchRevealSnapshot,
} from './freestyleBranchCardSupport'

export function FreestyleUnitReviewFlipPanel({
  card,
  session,
  unit,
  editorState,
  active = true,
  fullscreen,
  onToggleFullscreen,
  onEditingChange,
  onSaveFailed,
  onUnitsReconciled,
}: {
  card: FreestyleReviewUnitCard
  session: UnitReviewSessionDto
  unit: ReviewUnitDto
  editorState: MindMapEditorState
  /** When false (card left / inactive), flush edit with leave reconcile. */
  active?: boolean
  fullscreen: boolean
  onToggleFullscreen: (active?: boolean) => void
  /** Parent hides rating overlay while inline editing. */
  onEditingChange?: (editing: boolean) => void
  onSaveFailed?: (message: string) => void
  /** Optional silent freestyle queue rebuild after unit reconcile changes. */
  onUnitsReconciled?: () => void
}) {
  // A weak rating creates a new encounter when this unit returns to the queue.
  // Its reveal state must start at the root; only a remount of the same encounter
  // is allowed to restore the learner's in-progress flips.
  const revealSnapshotKey = `${card.id}:${unit.encounter.id}`
  const initialRevealSnapshot = useMemo(
    () => readBranchRevealSnapshot(revealSnapshotKey),
    [revealSnapshotKey],
  )
  const reveal = useRevealSession({
    title: card.palace_title || session.title || `宫殿 ${card.palace_id}`,
    editorState,
    initialSnapshot: initialRevealSnapshot,
  })

  useEffect(() => {
    writeBranchRevealSnapshot(revealSnapshotKey, {
      revealMap: reveal.revealMap,
      redNodeIds: [...reveal.redNodeIds],
      completed: reveal.completed,
    })
  }, [reveal.completed, reveal.redNodeIds, reveal.revealMap, revealSnapshotKey])

  const [displayMode, setDisplayMode] = useState<'review' | 'edit'>('review')
  const [editEditorState, setEditEditorState] = useState<MindMapEditorState>(editorState)
  const [modeSyncVersion, setModeSyncVersion] = useState(0)
  const [permanentMarkMode, setPermanentMarkMode] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [reviewUnitsPanelOpen, setReviewUnitsPanelOpen] = useState(false)
  const [lastUndoToken, setLastUndoToken] = useState<string | null>(null)
  const [recentUnitChanges, setRecentUnitChanges] = useState<PalaceReviewUnitChangeHighlight[]>([])
  const saveTimerRef = useRef<number | null>(null)
  const editBaselineRef = useRef(editorState)
  const editEditorStateRef = useRef(editorState)
  const displayModeRef = useRef<'review' | 'edit'>('review')
  /** Mark-pass reconcile may finish while still editing; rebuild freestyle only after leaving edit. */
  const pendingQueueRebuildRef = useRef(false)
  const isEditMode = displayMode === 'edit'
  editEditorStateRef.current = editEditorState
  displayModeRef.current = displayMode

  // Session reload (stale rebuild) refreshes the edit baseline only while learning.
  useEffect(() => {
    if (isEditMode) return
    setEditEditorState(editorState)
    editBaselineRef.current = editorState
  }, [editorState, isEditMode])

  useEffect(() => {
    onEditingChange?.(isEditMode)
  }, [isEditMode, onEditingChange])

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
        toast.message('复习进度已更新（返回学习后同步队列）')
        return
      }
      pendingQueueRebuildRef.current = false
      toast.message('复习进度已更新')
      onUnitsReconciled?.()
      return
    }
    if (rebuildQueue && pendingQueueRebuildRef.current) {
      pendingQueueRebuildRef.current = false
      toast.message('复习进度已更新')
      onUnitsReconciled?.()
    }
  }, [onUnitsReconciled])

  const persistEdit = useCallback(async (
    state: MindMapEditorState,
    options?: PersistPalaceEditorOptions & { quiet?: boolean },
  ) => {
    setSavingEdit(true)
    try {
      const { quiet, ...persistOptions } = options ?? {}
      const result = await persistPalaceEditor(
        session.palace_id,
        state,
        persistOptions && Object.keys(persistOptions).length > 0 ? persistOptions : undefined,
      )
      setEditEditorState(result.state)
      editBaselineRef.current = result.state
      editEditorStateRef.current = result.state
      if (!quiet) {
        toast.success('已保存宫殿编辑')
      }
      // Only surface reconcile feedback for explicit mark/leave flushes, not keystroke autosave.
      if (persistOptions?.reconcileUnits || persistOptions?.syncReason) {
        // mark_change while still editing must not rebuild freestyle mid-pass.
        const stayEditingAfterMarkFlush = (
          persistOptions.syncReason === 'mark_change'
          && displayModeRef.current === 'edit'
        )
        notifyUnitReconcile(result.unitReconcile, {
          rebuildQueue: !stayEditingAfterMarkFlush,
        })
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存宫殿失败'
      onSaveFailed?.(message)
      toast.error(message)
      return null
    } finally {
      setSavingEdit(false)
    }
  }, [notifyUnitReconcile, onSaveFailed, session.palace_id])

  const clearPersistTimer = useCallback(() => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [])

  /** Typing autosave: plain path, no force reconcile. */
  const schedulePersist = useCallback((state: MindMapEditorState) => {
    clearPersistTimer()
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      void persistEdit(state)
    }, 700)
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

  const handleToggleMode = useCallback(() => {
    setDisplayMode((current) => {
      const next = current === 'edit' ? 'review' : 'edit'
      if (next === 'edit') {
        setEditEditorState(editBaselineRef.current)
        setPermanentMarkMode(false)
      } else {
        setPermanentMarkMode(false)
        // Leaving edit: always reconcile (even if autosave already wrote the doc).
        // Quiet save toast — only surface "复习进度已更新" when units actually changed.
        void flushPersistWithReconcile('return_to_review', editEditorStateRef.current, true)
      }
      return next
    })
    setModeSyncVersion((value) => value + 1)
  }, [flushPersistWithReconcile])

  const handleEditorStateChange = useCallback((nextState: MindMapEditorState) => {
    setEditEditorState(nextState)
    editBaselineRef.current = nextState
    editEditorStateRef.current = nextState
    schedulePersist(nextState)
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
    setEditEditorState(nextState)
    editBaselineRef.current = nextState
    editEditorStateRef.current = nextState
    schedulePersist(nextState)
    toast.success(result.marked ? '已添加永久标记（层级自动）' : '已取消永久标记')
  }, [schedulePersist])

  const handleTogglePermanentMarkMode = useCallback(() => {
    setPermanentMarkMode((current) => {
      const next = !current
      if (current && !next) {
        // Finished this mark pass: one reconcile for the whole batch.
        void flushPersistWithReconcile('mark_change', editEditorStateRef.current, true)
        toast.success('已退出永久标记；复习进度整理中')
      } else {
        toast.success(
          next
            ? '永久标记：点击卡片标记/取消；改完后再退出，才会整理复习进度'
            : '已退出永久标记',
        )
      }
      return next
    })
  }, [flushPersistWithReconcile])

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
        disabled: savingEdit,
      },
      {
        label: '复习进度',
        onClick: () => setReviewUnitsPanelOpen(true),
        separatorBefore: true,
      },
    ]
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
    handleToggleMode,
    handleTogglePermanentMarkMode,
    isEditMode,
    permanentMarkHighlights.length,
    permanentMarkMode,
    savingEdit,
  ])

  return (
    <>
      <FlipCardMindMapPanel
        fullscreen={fullscreen}
        displayMode={displayMode}
        sessionKind="review"
        chromeDensity="compact"
        hidePresentationOverflowActions
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
        currentPalaceId={session.palace_id}
        activeUnitNodeUids={isEditMode ? null : unit.node_uids}
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
        onNodeActive={() => undefined}
        onNodeHover={isEditMode ? undefined : reveal.handleNodeHover}
        preserveViewOnSync
        initialViewPolicy={isEditMode ? 'preserve' : 'reset'}
        className="h-full min-h-0"
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
