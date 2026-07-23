import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FreestyleMindMapBranchCard,
  MindMapEditorState,
  MindMapRecallRating,
  ReviewCompletionSummary,
} from '@/shared/api/contracts'
import {
  MindMapReviewFlow,
  submitReviewSessionApi,
  type CompleteFlowPayload,
} from '@/widgets/mindmap-review-flow'
import { FsrsCompletionDialog } from '@/modules/practice/ui/review/components/FsrsCompletionDialog'
import { useReviewCompletionCoordinator } from '@/modules/practice/ui/review/hooks/useReviewCompletionCoordinator'
import {
  getReviewSessionCompletionSummaryApi,
  rateUnratedReviewSessionNodesApi,
} from '@/modules/practice/ui/review/api'
import { FreestyleAnkiFlipPanel } from '@/modules/practice/ui/freestyle/components/FreestyleAnkiFlipPanel'
import {
  rateAnkiGroupAndMaybeSubmit,
  rateAnkiSingleAndMaybeSubmit,
  restudyFromSubmitResult,
} from '@/modules/practice/ui/freestyle/components/freestyleAnkiSettle'
import {
  type BranchSession,
  type BranchSettleFlash,
  branchSessionCache,
  clipBranchUnit,
  editorStateFingerprint,
  finishBranchCard,
  isStaleDueError,
  loadBranchSession,
  loadPalaceEditor,
  palaceEditorCache,
  persistPalaceEditor,
  plainContextLabel,
  settleFlashFromResult,
} from '@/modules/practice/ui/freestyle/components/freestyleBranchCardSupport'
import { cn } from '@/shared/lib/utils'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import type { ReviewSessionSubmitResponse } from '@/shared/api/contracts'

export function FreestyleMindMapBranchCardView({
  card,
  active,
  ratingMode,
  onToggleRatingMode,
  onBranchComplete,
  onStaleDrop,
  onSaveFailed,
  reducedMotion,
}: {
  card: FreestyleMindMapBranchCard
  active: boolean
  ratingMode: boolean
  onToggleRatingMode: () => void
  /**
   * Successful FSRS settlement. When ``restudy`` is true (忘记/困难 remain),
   * the unit is re-queued at the feed tail instead of completedIds.
   */
  onBranchComplete: (cardId: string, options?: { restudy?: boolean }) => void
  /**
   * Formal due vanished between queue build and open. Must not mark completed
   * (Insights may still list the palace); parent drops + silent rebuilds.
   */
  onStaleDrop: (cardId: string) => void
  onSaveFailed: (message: string) => void
  reducedMotion: boolean
}) {
  /** Full palace document — used for inline edit + rating subtree cascade. */
  const [fullEditorState, setFullEditorState] = useState<MindMapEditorState | null>(null)
  /** Clipped branch unit for freestyle flip/rating (not the whole palace). */
  const [reviewEditorState, setReviewEditorState] = useState<MindMapEditorState | null>(null)
  const [branchSession, setBranchSession] = useState<BranchSession | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [settleFlash, setSettleFlash] = useState<BranchSettleFlash | null>(null)
  const [bulkRating, setBulkRating] = useState(false)
  const [displayMode, setDisplayMode] = useState<'review' | 'edit'>('review')
  const [modeSyncVersion, setModeSyncVersion] = useState(0)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const completedRef = useRef(false)
  /** Survives silent queue rebuilds so we do not reload/drop a just-settled unit. */
  const settledCardIdRef = useRef<string | null>(null)
  const branchSessionRef = useRef<BranchSession | null>(null)
  const modeTransitioningRef = useRef(false)
  const fullEditorStateRef = useRef<MindMapEditorState | null>(null)
  /** Last successfully loaded/saved full-palace fingerprint; leave-edit skips save when equal. */
  const persistedFingerprintRef = useRef('')

  const contextLabel = useMemo(
    () => plainContextLabel(card.context_path, card.palace_title, card.palace_id),
    [card.context_path, card.palace_id, card.palace_title],
  )
  const palaceTitleLabel = useMemo(
    () => stripMindMapHtml(card.palace_title) || card.palace_title || `宫殿 ${card.palace_id}`,
    [card.palace_id, card.palace_title],
  )

  useEffect(() => {
    branchSessionRef.current = branchSession
  }, [branchSession])

  useEffect(() => {
    fullEditorStateRef.current = fullEditorState
  }, [fullEditorState])

  useEffect(() => {
    let cancelled = false
    // Silent rebuild after settle may replace the card object. Keep the settled
    // surface (and next-review bubble) — never auto-drop or reload under the user.
    if (settledCardIdRef.current === card.id || completedRef.current) {
      return
    }
    setLoading(true)
    setLoadError('')
    setFullEditorState(null)
    setReviewEditorState(null)
    setBranchSession(null)
    setDisplayMode('review')
    setModeSyncVersion(0)
    setEditError(null)
    setSettleFlash(null)
    void Promise.all([loadPalaceEditor(card.palace_id), loadBranchSession(card)])
      .then(([state, session]) => {
        if (cancelled) return
        // Clip to this queue unit for freestyle flip; keep full palace for edit mode.
        fullEditorStateRef.current = state
        setFullEditorState(state)
        persistedFingerprintRef.current = editorStateFingerprint(state)
        setReviewEditorState(clipBranchUnit(state, card))
        setBranchSession(session)
      })
      .catch((error) => {
        if (cancelled) return
        // Due set went stale after queue build (e.g. subtree rating earlier).
        // Drop + rebuild without marking completed — never practice, never hide for the day.
        if (isStaleDueError(error)) {
          branchSessionCache.delete(card.id)
          if (!completedRef.current && settledCardIdRef.current !== card.id) {
            completedRef.current = true
            onStaleDrop(card.id)
          }
          return
        }
        setLoadError(error instanceof Error ? error.message : '加载宫殿导图失败。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [card, onStaleDrop])

  const completion = useReviewCompletionCoordinator<
    { sessionId: string; summary: ReviewCompletionSummary },
    { note: string },
    ReviewSessionSubmitResponse
  >({
    prepare: async () => {
      const session = branchSessionRef.current
      if (!session) {
        throw new Error('当前没有可结算的正式复习会话。')
      }
      const summary = await getReviewSessionCompletionSummaryApi(session.id)
      return { sessionId: session.id, summary: summary.item }
    },
    submit: async ({ target, input, payload, operationId }) => {
      // Backend rejects complete while frozen due nodes remain unrated (409).
      if ((target.summary.unrated_due_node_count ?? 0) > 0) {
        throw new Error('本次还有未评分的到期节点，请先评分或一键补评后再结束。')
      }
      const result = await submitReviewSessionApi(
        target.sessionId,
        {
          duration_seconds: payload.durationSeconds,
          completion_mode: payload.completionMode,
          revealed_remaining: payload.revealedRemaining,
          red_marked_count: payload.redNodeIds.length,
          ...(input.note ? { note: input.note } : {}),
        },
        { mutationId: operationId },
      )
      return { result, persistTimeRecord: false }
    },
    onCompleted: (result) => {
      if (completedRef.current) return
      completedRef.current = true
      settledCardIdRef.current = card.id
      branchSessionCache.delete(card.id)
      const restudy = restudyFromSubmitResult(result)
      finishBranchCard(
        card.id,
        reducedMotion,
        onBranchComplete,
        setSettleFlash,
        settleFlashFromResult(result, restudy),
        { restudy },
      )
    },
  })

  const handleBulkRateUnrated = useCallback(
    async (rating: MindMapRecallRating) => {
      const target = completion.target
      if (!target || bulkRating) return
      if ((target.summary.unrated_due_node_count ?? 0) <= 0) return

      setBulkRating(true)
      try {
        const operationId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `bulk-rate-unrated-${Date.now()}-${Math.random().toString(36).slice(2)}`
        await rateUnratedReviewSessionNodesApi(target.sessionId, {
          rating,
          operation_id: operationId,
        })
        await completion.retryPreparation()
      } catch (error) {
        onSaveFailed(error instanceof Error && error.message ? error.message : '一键评分失败')
      } finally {
        setBulkRating(false)
      }
    },
    [bulkRating, completion, onSaveFailed],
  )

  const handleComplete = async (payload: CompleteFlowPayload) => {
    if (!branchSession) return
    try {
      // Formal settlement only: summary → FSRS dialog → submit.
      // Allowed again after a first complete so wrong scores can be amended.
      await completion.requestCompletion(payload)
    } catch (error) {
      onSaveFailed(error instanceof Error ? error.message : '评分保存失败，请重试。')
    }
  }

  /** Compact chrome: rate still-unrated due nodes then submit without the dialog. */
  const isAnkiCard = card.presentation === 'anki' || card.type === 'anki_card'

  const finishAnkiSettle = useCallback(
    (submitResult: ReviewSessionSubmitResponse) => {
      if (completedRef.current) return
      completedRef.current = true
      settledCardIdRef.current = card.id
      branchSessionCache.delete(card.id)
      const restudy = restudyFromSubmitResult(submitResult)
      finishBranchCard(
        card.id,
        reducedMotion,
        onBranchComplete,
        setSettleFlash,
        settleFlashFromResult(submitResult, restudy),
        { restudy },
      )
    },
    [card.id, onBranchComplete, reducedMotion],
  )

  const handleAnkiGroupRate = useCallback(
    async (rating: MindMapRecallRating) => {
      const session = branchSessionRef.current
      if (!session || bulkRating || completion.submitting) return
      setBulkRating(true)
      try {
        const outcome = await rateAnkiGroupAndMaybeSubmit(session.id, rating)
        if (outcome.submitted && outcome.result) finishAnkiSettle(outcome.result)
      } catch (error) {
        onSaveFailed(error instanceof Error ? error.message : 'Anki 评分结算失败，请重试。')
      } finally {
        setBulkRating(false)
      }
    },
    [bulkRating, completion.submitting, finishAnkiSettle, onSaveFailed],
  )

  const handleAnkiSingleRate = useCallback(
    async (rating: MindMapRecallRating, nodeUid: string) => {
      const session = branchSessionRef.current
      if (!session || bulkRating) return
      setBulkRating(true)
      try {
        const outcome = await rateAnkiSingleAndMaybeSubmit(
          card.palace_id,
          session.id,
          nodeUid,
          rating,
        )
        if (outcome.submitted && outcome.result) finishAnkiSettle(outcome.result)
      } catch (error) {
        onSaveFailed(error instanceof Error ? error.message : '单独评分失败，请重试。')
      } finally {
        setBulkRating(false)
      }
    },
    [bulkRating, card.palace_id, finishAnkiSettle, onSaveFailed],
  )

  const handleQuickSettle = useCallback(
    async (rating: MindMapRecallRating, payload: CompleteFlowPayload) => {
      const session = branchSessionRef.current
      if (!session) {
        payload.cancel()
        onSaveFailed('当前没有可结算的正式复习会话。')
        return
      }
      if (bulkRating || completion.submitting) {
        payload.cancel()
        return
      }

      setBulkRating(true)
      try {
        const rateOperationId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `quick-settle-rate-${Date.now()}-${Math.random().toString(36).slice(2)}`
        // Only fills still-unrated frozen-due nodes; already-scored cards stay as-is.
        await rateUnratedReviewSessionNodesApi(session.id, {
          rating,
          operation_id: rateOperationId,
        })
        const summary = await getReviewSessionCompletionSummaryApi(session.id)
        if ((summary.item.unrated_due_node_count ?? 0) > 0) {
          throw new Error('本次还有未评分的到期节点，请先评分后再结算。')
        }
        const submitOperationId =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `quick-settle-submit-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const submitResult = await submitReviewSessionApi(
          session.id,
          {
            duration_seconds: payload.durationSeconds,
            completion_mode: payload.completionMode,
            revealed_remaining: payload.revealedRemaining,
            red_marked_count: payload.redNodeIds.length,
          },
          { mutationId: submitOperationId },
        )
        await payload.finalize({ persistTimeRecord: false })
        if (!completedRef.current) {
          completedRef.current = true
          settledCardIdRef.current = card.id
          branchSessionCache.delete(card.id)
          const restudy = restudyFromSubmitResult(submitResult)
          finishBranchCard(
            card.id,
            reducedMotion,
            onBranchComplete,
            setSettleFlash,
            settleFlashFromResult(submitResult, restudy),
            { restudy },
          )
        }
      } catch (error) {
        payload.cancel()
        onSaveFailed(error instanceof Error ? error.message : '快捷结算失败，请重试。')
      } finally {
        setBulkRating(false)
      }
    },
    [bulkRating, card.id, completion.submitting, onBranchComplete, onSaveFailed, reducedMotion],
  )

  const handleModeToggle = useCallback(async () => {
    if (modeTransitioningRef.current || editSaving) return
    modeTransitioningRef.current = true
    try {
      if (displayMode === 'edit') {
        const pending = fullEditorStateRef.current
        if (!pending) return
        const pendingFingerprint = editorStateFingerprint(pending)
        const dirty = pendingFingerprint !== persistedFingerprintRef.current

        // Leave edit immediately so "返回随心" never waits on USB/API I/O.
        setDisplayMode('review')
        setModeSyncVersion((current) => current + 1)
        setEditError(null)

        if (!dirty) {
          // No structural/text edits — review unit already matches last persisted palace.
          return
        }

        // Apply local structure to the freestyle unit first; persist in background.
        setReviewEditorState(clipBranchUnit(pending, card))
        setEditSaving(true)
        try {
          const saved = await persistPalaceEditor(card.palace_id, pending)
          palaceEditorCache.set(card.palace_id, Promise.resolve(saved))
          setFullEditorState(saved)
          persistedFingerprintRef.current = editorStateFingerprint(saved)
          // Server may normalize fingerprints / local config — re-clip from saved doc.
          setReviewEditorState(clipBranchUnit(saved, card))
        } catch (error) {
          const message =
            error instanceof Error && error.message
              ? error.message
              : '保存宫殿失败，请重试。'
          setEditError(message)
          onSaveFailed(message)
        } finally {
          setEditSaving(false)
        }
        return
      }
      setDisplayMode('edit')
      setModeSyncVersion((current) => current + 1)
    } finally {
      modeTransitioningRef.current = false
    }
  }, [card, displayMode, editSaving, onSaveFailed])

  const handleEditEditorStateChange = useCallback((nextState: MindMapEditorState) => {
    // Keep the ref in lockstep so leave-edit dirty checks see the latest edit
    // even before React commits the state update.
    fullEditorStateRef.current = nextState
    setFullEditorState(nextState)
    setEditError(null)
  }, [])

  const reloadEditors = useCallback(() => {
    palaceEditorCache.delete(card.palace_id)
    setLoading(true)
    setLoadError('')
    void loadPalaceEditor(card.palace_id)
      .then((state) => {
        fullEditorStateRef.current = state
        setFullEditorState(state)
        persistedFingerprintRef.current = editorStateFingerprint(state)
        setReviewEditorState(clipBranchUnit(state, card))
        setDisplayMode('review')
        setModeSyncVersion((value) => value + 1)
      })
      .catch((error) =>
        setLoadError(error instanceof Error ? error.message : '加载失败'),
      )
      .finally(() => setLoading(false))
  }, [card])

  // Hide the second line when it only repeats the palace title (common when path is empty).
  const showContextLine = (() => {
    const title = palaceTitleLabel.trim()
    const context = contextLabel.trim()
    if (!context) return false
    if (!title) return true
    return context !== title
  })()

  return (
    <section
      className={cn(
        // Single outer frame owns radius/border; review flow fills flush (chromeFrame=host).
        'relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/12 bg-zinc-950/90 shadow-[0_12px_40px_rgba(0,0,0,0.35)]',
        active ? 'ring-1 ring-emerald-400/25' : 'opacity-95',
      )}
    >
      <header className="flex min-h-10 shrink-0 items-center gap-3 border-b border-white/10 bg-zinc-950/80 px-3 py-2 sm:px-3.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium leading-tight text-zinc-50">
            {palaceTitleLabel}
          </div>
          {showContextLine ? (
            <div className="mt-0.5 truncate text-xs leading-tight text-zinc-500">
              {contextLabel}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] tabular-nums text-zinc-400">
          <span>
            {card.node_count} 节点
            {typeof card.due_node_count === 'number' && card.due_node_count > 0
              ? ` · ${card.due_node_count} 到期`
              : ''}
          </span>
          {card.over_limit_delta > 0 ? (
            <span className="text-amber-200/80">略超 +{card.over_limit_delta}</span>
          ) : null}
          {displayMode === 'edit' ? (
            <span className="text-sky-200/90">完整宫殿 · 编辑中</span>
          ) : null}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col bg-card">
        {loading ? (
          <div className="flex h-full items-center justify-center bg-zinc-950 text-sm text-zinc-400">
            加载导图…
          </div>
        ) : loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 bg-zinc-950 px-6 text-center">
            <div className="text-sm text-rose-300">{loadError}</div>
            <button
              type="button"
              className="min-h-10 rounded-full border border-white/15 px-4 py-2 text-sm text-zinc-200"
              onClick={reloadEditors}
            >
              重试
            </button>
          </div>
        ) : reviewEditorState && fullEditorState && branchSession ? (
          isAnkiCard ? (
            <FreestyleAnkiFlipPanel
              card={card}
              editorState={fullEditorState}
              busy={bulkRating || completion.submitting}
              onRateGroup={handleAnkiGroupRate}
              onRateSingle={handleAnkiSingleRate}
            />
          ) : (
            <MindMapReviewFlow
              title={palaceTitleLabel}
              palaceId={card.palace_id}
              sessionKind="review"
              studySessionId={branchSession.id}
              displayMode={displayMode}
              modeSyncVersion={modeSyncVersion}
              viewMemoryScope={`freestyle-branch:${card.id}:${displayMode}`}
              reviewEditorState={reviewEditorState}
              editEditorState={fullEditorState}
              // Cascade on the unit document (synthetic root + folded spine + full unit
              // subtree), not the whole palace. Reveal filtering is separate — the unit
              // clip already includes every descendant under the branch, so single-child
              // spines still cascade into multi-grandchild branches.
              ratingTreeEditorState={reviewEditorState}
              // FSRS / rating limited to unit formal due freeze.
              reviewScopeNodeUids={branchSession.reviewScopeNodeUids}
              // Unit flip: every node goes placeholder → content (do not auto-open non-due).
              autoRevealNonDueCards={false}
              checkpointNodeUids={card.ratable_node_uids}
              ratingMode={ratingMode}
              onToggleRatingMode={onToggleRatingMode}
              modeToggleLabels={{ enterEdit: '编辑', leaveEdit: '返回随心' }}
              onModeToggle={() => {
                void handleModeToggle()
              }}
              onEditEditorStateChange={handleEditEditorStateChange}
              editSaving={editSaving}
              editError={editError}
              chromeDensity="compact"
              chromeFrame="host"
              persistProgress={false}
              submitting={completion.submitting || bulkRating}
              onComplete={(payload) => {
                void handleComplete(payload)
              }}
              onQuickSettle={(rating, payload) => {
                void handleQuickSettle(rating, payload)
              }}
            />
          )
        ) : null}

        {settleFlash ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3 sm:bottom-4">
            <div
              role="status"
              className={cn(
                'w-full max-w-sm animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300',
                'rounded-2xl border border-white/12 bg-zinc-950/95 px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-md',
              )}
            >
              <div className="text-[11px] font-medium tracking-wide text-zinc-400">
                {settleFlash.restudy ? '已评分 · 稍后复练' : '下次复习'}
              </div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-zinc-50">
                {settleFlash.nextReviewAbsolute}
              </div>
              <div className="mt-1 text-xs leading-snug text-zinc-400">
                {settleFlash.nextReviewDetail}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <FsrsCompletionDialog
        open={completion.open}
        summary={completion.target?.summary ?? null}
        durationSeconds={completion.durationSeconds}
        submitting={completion.submitting}
        preparing={completion.preparing}
        submissionFailed={completion.submissionFailed}
        bulkRating={bulkRating}
        error={completion.error}
        onRetry={() => void completion.retryPreparation()}
        onRetrySubmission={() => void completion.retrySubmission()}
        onBulkRateUnrated={
          (completion.target?.summary.unrated_due_node_count ?? 0) > 0
            ? (rating) => {
                void handleBulkRateUnrated(rating)
              }
            : undefined
        }
        onConfirm={() => {
          void completion.confirmCompletion({ note: '' })
        }}
        onCancel={completion.cancelCompletion}
      />
    </section>
  )
}
