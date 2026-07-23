import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readMindMapEditorState } from '@/modules/content/public'
import { getPalaceEditorApi } from '@/modules/content/public'
import { completeStudySessionApi, createStudySessionApi } from '@/modules/session/public'
import type {
  FreestyleMindMapBranchCard,
  MindMapEditorState,
  MindMapRecallRating,
  ReviewCompletionSummary,
} from '@/shared/api/contracts'
import {
  MindMapReviewFlow,
  startReviewSessionApi,
  submitReviewSessionApi,
  type CompleteFlowPayload,
} from '@/widgets/mindmap-review-flow'
import { FsrsCompletionDialog } from '@/modules/practice/ui/review/components/FsrsCompletionDialog'
import { useReviewCompletionCoordinator } from '@/modules/practice/ui/review/hooks/useReviewCompletionCoordinator'
import {
  getReviewSessionCompletionSummaryApi,
  rateUnratedReviewSessionNodesApi,
} from '@/modules/practice/ui/review/api'
import { cn } from '@/shared/lib/utils'
import { stripMindMapHtml } from '@/shared/lib/mindmapRichText'
import {
  clipEditorStateToBranchUnit,
  foldedParentUidsForBranch,
} from '@/modules/practice/ui/freestyle/model/clipBranchUnitEditor'

function plainContextLabel(
  contextPath: FreestyleMindMapBranchCard['context_path'] | undefined,
  palaceTitle: string | undefined,
  palaceId: number,
) {
  const path = (contextPath || [])
    .map((item) => stripMindMapHtml(item.text) || item.uid)
    .filter(Boolean)
  return path.length ? path.join(' / ') : palaceTitle || `宫殿 ${palaceId}`
}

const palaceEditorCache = new Map<number, Promise<MindMapEditorState>>()
type BranchSession = {
  id: string
  kind: 'practice' | 'review'
  reviewScopeNodeUids: string[]
}

const branchSessionCache = new Map<string, Promise<BranchSession>>()

function loadPalaceEditor(palaceId: number) {
  const cached = palaceEditorCache.get(palaceId)
  if (cached) return cached
  const promise = getPalaceEditorApi(palaceId)
    .then((response) => readMindMapEditorState(response))
    .catch((error) => {
      palaceEditorCache.delete(palaceId)
      throw error
    })
  palaceEditorCache.set(palaceId, promise)
  return promise
}

function loadBranchSession(card: FreestyleMindMapBranchCard) {
  const key = card.id
  const cached = branchSessionCache.get(key)
  if (cached) return cached
  const unitDue = (card.due_node_uids || []).filter(Boolean)
  const promise = unitDue.length
    ? startReviewSessionApi(card.palace_id, {
        entry_mode: 'node',
        branch_uid: card.branch_uid,
        scope_node_uids: unitDue,
      }).then((session) => {
        const frozen = (session.frozen_due_node_uids ?? []).filter(Boolean)
        const unitSet = new Set(card.ratable_node_uids || [])
        // Never expand beyond the freestyle unit, even if a legacy server
        // response is wider than the requested scope.
        const scoped = (frozen.length ? frozen : unitDue).filter((uid) => unitSet.has(uid))
        return {
          id: String(session.session_id ?? session.id),
          kind: 'review' as const,
          reviewScopeNodeUids: scoped.length ? scoped : unitDue,
        }
      })
    : createStudySessionApi({
        id: `freestyle-${card.palace_id}-${card.branch_uid}-${
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        }`,
        scene: 'freestyle',
        target_type: 'palace',
        target_id: card.palace_id,
        palace_id: card.palace_id,
        title: `随心：${card.palace_title || `宫殿 ${card.palace_id}`}`,
        status: 'active',
        started_at: new Date().toISOString(),
        progress: { branch_uid: card.branch_uid },
      }).then(({ item }) => ({
        id: item.id,
        kind: 'practice' as const,
        // Clipped unit tree: flip every ratable node in this batch.
        reviewScopeNodeUids: card.ratable_node_uids,
      }))
  branchSessionCache.set(
    key,
    promise.catch((error) => {
      branchSessionCache.delete(key)
      throw error
    }),
  )
  return branchSessionCache.get(key)!
}

function finishBranchCard(
  cardId: string,
  reducedMotion: boolean,
  onBranchComplete: (cardId: string) => void,
  setShowDoneFlash: (value: boolean) => void,
) {
  setShowDoneFlash(true)
  const delay = reducedMotion ? 0 : 800
  window.setTimeout(() => {
    setShowDoneFlash(false)
    onBranchComplete(cardId)
  }, delay)
}

export function FreestyleMindMapBranchCardView({
  card,
  active,
  ratingMode,
  onToggleRatingMode,
  onBranchComplete,
  onSaveFailed,
  reducedMotion,
}: {
  card: FreestyleMindMapBranchCard
  active: boolean
  ratingMode: boolean
  onToggleRatingMode: () => void
  onBranchComplete: (cardId: string) => void
  onSaveFailed: (message: string) => void
  reducedMotion: boolean
}) {
  const [editorState, setEditorState] = useState<MindMapEditorState | null>(null)
  const [branchSession, setBranchSession] = useState<BranchSession | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showDoneFlash, setShowDoneFlash] = useState(false)
  const [bulkRating, setBulkRating] = useState(false)
  const completedRef = useRef(false)
  const branchSessionRef = useRef<BranchSession | null>(null)

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
    let cancelled = false
    setLoading(true)
    setLoadError('')
    completedRef.current = false
    void Promise.all([loadPalaceEditor(card.palace_id), loadBranchSession(card)])
      .then(([state, session]) => {
        if (cancelled) return
        // Clip to this queue unit: small branch map, not the whole palace.
        const contextText = plainContextLabel(
          card.context_path,
          card.palace_title,
          card.palace_id,
        )
        const clipped = clipEditorStateToBranchUnit(
          state,
          card.branch_uid,
          contextText,
          {
            includeAncestorUids: foldedParentUidsForBranch(
              state,
              card.branch_uid,
              card.ratable_node_uids,
            ),
          },
        )
        setEditorState(clipped)
        setBranchSession(session)
      })
      .catch((error) => {
        if (cancelled) return
        setLoadError(error instanceof Error ? error.message : '加载宫殿导图失败。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [card])

  const completion = useReviewCompletionCoordinator<
    { sessionId: string; summary: ReviewCompletionSummary },
    { note: string },
    unknown
  >({
    prepare: async () => {
      const session = branchSessionRef.current
      if (!session || session.kind !== 'review') {
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
      await submitReviewSessionApi(
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
      return { result: null, persistTimeRecord: false }
    },
    onCompleted: () => {
      if (completedRef.current) return
      completedRef.current = true
      branchSessionCache.delete(card.id)
      finishBranchCard(card.id, reducedMotion, onBranchComplete, setShowDoneFlash)
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
    if (completedRef.current || !branchSession) return
    try {
      if (branchSession.kind === 'review') {
        // Same formal settlement path as palace review: summary → dialog → submit.
        await completion.requestCompletion(payload)
        return
      }
      await completeStudySessionApi(branchSession.id, {
        status: 'completed',
        ended_at: new Date().toISOString(),
        completion_method: payload.completionMode,
        summary: { branch_uid: card.branch_uid },
      })
      await payload.finalize({ persistTimeRecord: false })
      branchSessionCache.delete(card.id)
      completedRef.current = true
      finishBranchCard(card.id, reducedMotion, onBranchComplete, setShowDoneFlash)
    } catch (error) {
      onSaveFailed(error instanceof Error ? error.message : '评分保存失败，请重试。')
    }
  }

  return (
    <section
      className={cn(
        'relative flex h-full w-full min-h-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/80',
        active ? 'ring-1 ring-emerald-400/30' : 'opacity-90',
      )}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-zinc-100">{palaceTitleLabel}</div>
          <div className="truncate text-[11px] text-zinc-500">{contextLabel}</div>
        </div>
        <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">
          {card.node_count}节点
          {card.due_node_count ? ` · ${card.due_node_count}到期` : ''}
          {card.over_limit_delta > 0 ? ` · +${card.over_limit_delta}` : ''}
        </span>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">
            加载导图…
          </div>
        ) : loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <div className="text-sm text-rose-300">{loadError}</div>
            <button
              type="button"
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-zinc-200"
              onClick={() => {
                palaceEditorCache.delete(card.palace_id)
                setLoading(true)
                void loadPalaceEditor(card.palace_id)
                  .then((state) => {
                    const contextText = plainContextLabel(
                      card.context_path,
                      card.palace_title,
                      card.palace_id,
                    )
                    setEditorState(
                      clipEditorStateToBranchUnit(
                        state,
                        card.branch_uid,
                        contextText,
                        {
                          includeAncestorUids: foldedParentUidsForBranch(
                            state,
                            card.branch_uid,
                            card.ratable_node_uids,
                          ),
                        },
                      ),
                    )
                  })
                  .catch((error) =>
                    setLoadError(error instanceof Error ? error.message : '加载失败'),
                  )
                  .finally(() => setLoading(false))
              }}
            >
              重试
            </button>
          </div>
        ) : editorState && branchSession ? (
          <MindMapReviewFlow
            title={palaceTitleLabel}
            palaceId={card.palace_id}
            sessionKind={branchSession.kind}
            studySessionId={branchSession.id}
            reviewEditorState={editorState}
            ratingTreeEditorState={editorState}
            // FSRS / rating still limited to unit due (or full ratable in practice).
            reviewScopeNodeUids={branchSession.reviewScopeNodeUids}
            // Unit flip: every node goes placeholder → content (do not auto-open non-due).
            autoRevealNonDueCards={false}
            checkpointNodeUids={card.ratable_node_uids}
            ratingMode={ratingMode}
            onToggleRatingMode={onToggleRatingMode}
            chromeDensity="compact"
            persistProgress={false}
            submitting={completion.submitting}
            onComplete={(payload) => {
              void handleComplete(payload)
            }}
          />
        ) : null}

        {showDoneFlash ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-950/40">
            <div className="rounded-full border border-emerald-300/30 bg-emerald-400/15 px-4 py-2 text-sm text-emerald-100">
              本支完成
            </div>
          </div>
        ) : null}
      </div>

      {branchSession?.kind === 'review' ? (
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
      ) : null}
    </section>
  )
}
