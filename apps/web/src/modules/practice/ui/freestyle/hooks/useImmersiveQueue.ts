import { useCallback, useEffect, useRef, useState } from 'react'
import { buildFreestyleQueueApi } from '@/modules/practice/ui/freestyle/api'
import {
  applyDeferredPalaceOrder,
  applyRoundPlanOrder,
  createRoundPlan,
  createOperationId,
  deferPalace,
  filterMutedPalaces,
  FREESTYLE_FEED_CONFIG_UPDATED_EVENT,
  markCompleted,
  markIncomplete,
  hideCards,
  restoreCards,
  mergeQueuePreservingHistory,
  mergeRefreshQueue,
  moveCardToTail,
  moveRemainingPalaceToTail,
  mutePalace,
  placeRestudyCardWithMaxGap,
  createRetryOccurrence,
  insertRetryOccurrenceAfterGap,
  removeRetryOccurrencesForSource,
  sourceCardId,
  readFreestyleFeedConfig,
  readQueueState,
  resolveRebuildIndex,
  saveFreestyleFeedConfig,
  saveQueueState,
  updateRoundPlanCard,
  reorderRoundPlan,
  type FreestyleRoundPlanState,
  setUnitEncounterState,
  clearUnitEncounterState,
  applySkip,
  sanitizeFreestyleFeedConfig,
  freestylePalaceScopeSignature,
  startNewRound,
  undoSkip,
  type FreestyleSkipState,
  type FreestyleUnitEncounterState,
} from '@/modules/practice/public'
import type { FreestyleCard, FreestyleFeedConfig } from '@/shared/api/contracts'
import {
  applyFreestyleEntryScope,
} from '@/modules/practice/ui/freestyle/model/freestyle-entry-scope'
import { onAppEvent } from '@/shared/events/appEvents'
import { logAppError } from '@/shared/logs/model/appLogs'

const QUEUE_BUILD_TIMEOUT_MS = 15_000

function queueBuildDiagnostic(input: {
  operationId: string
  roundId: string
  cardId?: string | null
  elapsedMs: number
  reason: string
  config: FreestyleFeedConfig
  error: unknown
}) {
  const requestError = input.error as { message?: string; requestId?: string; status?: number; url?: string }
  const message = input.error instanceof Error ? input.error.message : String(input.error || '未知错误')
  const selectedPalaces = input.config.specific_palace_ids.length
    ? input.config.specific_palace_ids.join(', ')
    : '全部宫殿'
  return [
    '随心队列重建失败',
    `操作 ID: ${input.operationId}`,
    `回合 ID: ${input.roundId}`,
    `当前卡片: ${input.cardId || '无'}`,
    `触发原因: ${input.reason}`,
    `耗时: ${input.elapsedMs}ms`,
    `宫殿筛选: ${selectedPalaces}`,
    `内容: 宫殿=${input.config.content.mindmap_branch}，正反面=${input.config.content.anki_card}，题目=${input.config.content.quiz_question}`,
    `目标队列长度: ${input.config.queue_length}`,
    requestError?.requestId ? `请求 ID: ${requestError.requestId}` : null,
    requestError?.status != null ? `HTTP 状态: ${requestError.status}` : null,
    requestError?.url ? `接口: ${requestError.url}` : null,
    `错误: ${message}`,
  ].filter(Boolean).join('\n')
}

function buildQueueWithTimeout(payload: Parameters<typeof buildFreestyleQueueApi>[0]) {
  return new Promise<Awaited<ReturnType<typeof buildFreestyleQueueApi>>>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error(`队列构建超过 ${QUEUE_BUILD_TIMEOUT_MS / 1000} 秒仍未完成`))
    }, QUEUE_BUILD_TIMEOUT_MS)
    void buildFreestyleQueueApi(payload).then(
      (response) => {
        window.clearTimeout(timeout)
        resolve(response)
      },
      (error) => {
        window.clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function sameFeedConfig(left: FreestyleFeedConfig, right: FreestyleFeedConfig) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

export function useImmersiveQueue(entryPalaceId: number | null = null) {
  const scopeEntryConfig = useCallback(
    (next: FreestyleFeedConfig) => applyFreestyleEntryScope(next, entryPalaceId),
    [entryPalaceId],
  )
  const [config, setConfig] = useState<FreestyleFeedConfig>(() =>
    scopeEntryConfig(readFreestyleFeedConfig()),
  )
  const [queueState, setQueueState] = useState<FreestyleSkipState>(() => readQueueState())
  const [cards, setCards] = useState<FreestyleCard[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [phaseStats, setPhaseStats] = useState<Record<string, number | string>>({})
  const [roundMeta, setRoundMeta] = useState({
    candidate_count: 0,
    scheduled_count: 0,
    queue_limit: config.queue_length,
    limit_reached: false,
  })
  const operationIdRef = useRef<string>('')
  const cardsRef = useRef<FreestyleCard[]>([])
  const queueStateRef = useRef(queueState)
  const configRef = useRef(config)
  const currentIndexRef = useRef(0)
  /**
   * Weak-rated units waiting for gap re-insertion. Placement runs only after the
   * learner leaves the unit so the viewport is never reordered under them.
   * Value is the index at settle time (anchor for max-gap insert).
   */
  const pendingRestudyByIdRef = useRef<Map<string, number>>(new Map())
  cardsRef.current = cards
  queueStateRef.current = queueState
  configRef.current = config
  currentIndexRef.current = currentIndex

  const persistQueueState = useCallback((next: FreestyleSkipState) => {
    const sanitized = saveQueueState(next)
    queueStateRef.current = sanitized
    setQueueState(sanitized)
    return sanitized
  }, [])

  /** Remember the card under the viewport across route leave / remount. */
  const persistCurrentCardId = useCallback(
    (cardId: string | null | undefined) => {
      const nextId = cardId ? String(cardId).trim() : ''
      const normalized = nextId || null
      if (queueStateRef.current.currentCardId === normalized) return
      persistQueueState({
        ...queueStateRef.current,
        currentCardId: normalized,
      })
    },
    [persistQueueState],
  )

  const ensureUnitEncounter = useCallback(
    (cardId: string, unitRevision: number, allowRenew: boolean) => {
      const existing = queueStateRef.current.unitEncountersByCardId[cardId]
      if (
        existing
        && existing.unitRevision === unitRevision
        && !(allowRenew && existing.status === 'closed' && existing.passed === false)
      ) {
        return existing
      }
      const next: FreestyleUnitEncounterState = {
        encounterId: createOperationId(),
        roundId: queueStateRef.current.roundId,
        unitRevision,
        status: 'pending',
        sessionId: null,
        selectedRating: null,
        passed: null,
        retryAfterCards: 0,
      }
      persistQueueState(setUnitEncounterState(queueStateRef.current, cardId, next))
      return next
    },
    [persistQueueState],
  )

  const updateUnitEncounter = useCallback(
    (cardId: string, encounter: FreestyleUnitEncounterState) => {
      const current = queueStateRef.current.unitEncountersByCardId[cardId]
      if (
        current
        && current.encounterId === encounter.encounterId
        && current.roundId === encounter.roundId
        && current.unitRevision === encounter.unitRevision
        && current.status === encounter.status
        && current.sessionId === encounter.sessionId
        && current.selectedRating === encounter.selectedRating
        && current.passed === encounter.passed
        && current.retryAfterCards === encounter.retryAfterCards
      ) {
        return
      }
      const nextPlan = queueStateRef.current.roundPlan && encounter.selectedRating != null
        ? updateRoundPlanCard(queueStateRef.current.roundPlan, cardId, {
            lastRating: encounter.selectedRating,
            retryAfterCards: encounter.retryAfterCards,
          })
        : queueStateRef.current.roundPlan
      persistQueueState({
        ...setUnitEncounterState(queueStateRef.current, cardId, encounter),
        roundPlan: nextPlan,
      })
    },
    [persistQueueState],
  )

  const applyCurrentIndex = useCallback(
    (index: number, cardsForIndex: FreestyleCard[] = cardsRef.current) => {
      const max = Math.max(0, cardsForIndex.length - 1)
      const next = cardsForIndex.length === 0 ? 0 : Math.max(0, Math.min(index, max))
      currentIndexRef.current = next
      setCurrentIndex(next)
      persistCurrentCardId(cardsForIndex[next]?.id ?? null)
      return next
    },
    [persistCurrentCardId],
  )

  const buildQueue = useCallback(
    async (
      nextConfig: FreestyleFeedConfig,
      options?: {
        preserveCompleted?: boolean
        completedIds?: string[]
        hiddenIds?: string[]
        /** Rebuild without full-screen loading (e.g. after card complete). */
        silent?: boolean
        /** Prefer keeping this card under the viewport after rebuild. */
        preferCardId?: string | null
        /** Included in a user-copyable error report. */
        reason?: string
        /**
         * Weak-rated unit still due for same-session restudy: leave out of
         * completedIds (caller). Gap re-insertion is applied when the learner
         * leaves the unit — not here under the viewport.
         */
        restudyCardId?: string | null
      },
    ) => {
      const operationId = createOperationId()
      const startedAt = Date.now()
      operationIdRef.current = operationId
      const silent = Boolean(options?.silent)
      if (!silent) {
        setLoading(true)
        setError('')
      }
      try {
        const scopeSignature = freestylePalaceScopeSignature(nextConfig)
        const storedScopeChanged =
          queueStateRef.current.palaceScopeSignature !== scopeSignature
        if (storedScopeChanged) {
          pendingRestudyByIdRef.current.clear()
          const freshRound = persistQueueState(startNewRound(queueStateRef.current, nextConfig.seed))
          persistQueueState({ ...freshRound, palaceScopeSignature: scopeSignature })
        }
        const completedIds =
          options?.completedIds ??
          (options?.preserveCompleted === false || storedScopeChanged
            ? []
            : queueStateRef.current.completedIds)
        const hiddenIds =
          options?.hiddenIds ??
          (options?.preserveCompleted === false || storedScopeChanged
            ? []
            : queueStateRef.current.hiddenIds)
        const response = await buildQueueWithTimeout({
          operation_id: operationId,
          round_id: queueStateRef.current.roundId,
          config: nextConfig,
          completed_ids: completedIds,
          hidden_ids: hiddenIds,
        })
        // Stale response protection: only accept latest operation.
        if (
          response.operation_id !== operationIdRef.current
          || (response.round_id && response.round_id !== queueStateRef.current.roundId)
        ) {
          return
        }
        const muted = filterMutedPalaces(
          response.cards || [],
          queueStateRef.current.mutedPalaceIds,
        )
        const deferred = applyDeferredPalaceOrder(
          muted,
          queueStateRef.current.deferredPalaceIds,
          completedIds,
        )
        const previousCards = cardsRef.current
        // Capture where the user is *before* we replace the list. A silent
        // rebuild after complete must not yank them back if they already swiped.
        const clampedUserIndex = Math.max(
          0,
          Math.min(currentIndexRef.current, Math.max(0, previousCards.length - 1)),
        )
        // Live viewport wins; fall back to persisted id after remount / cold start.
        const userCardId =
          previousCards[clampedUserIndex]?.id ??
          queueStateRef.current.currentCardId ??
          null
        let nextCards =
          options?.preserveCompleted === false
            ? deferred
            : silent
              ? // Keep answered cards that are still in the local feed so swipe-back
                // shows the real previous question with analysis.
                applyDeferredPalaceOrder(
                  mergeQueuePreservingHistory(
                    previousCards,
                    deferred,
                    queueStateRef.current.completedIds,
                  ),
                  queueStateRef.current.deferredPalaceIds,
                  queueStateRef.current.completedIds,
                )
              : mergeRefreshQueue(previousCards, deferred)
        const restudyCardId = options?.restudyCardId
          ? String(options.restudyCardId).trim()
          : ''
        // Weak unit: keep position while still under the viewport. If the learner
        // already left, re-insert with max intervening gap (not full queue tail).
        if (restudyCardId && userCardId && userCardId !== restudyCardId) {
          const anchor = pendingRestudyByIdRef.current.get(restudyCardId)
          nextCards = placeRestudyCardWithMaxGap(nextCards, restudyCardId, {
            fromIndex: typeof anchor === 'number' ? anchor : undefined,
          })
          pendingRestudyByIdRef.current.delete(restudyCardId)
        }
        const rawMeta = response.round_meta ?? {
          candidate_count: Number(response.phase_stats?.remaining_before_limit ?? nextCards.length),
          scheduled_count: nextCards.length,
          queue_limit: nextConfig.queue_length,
          limit_reached: Number(response.phase_stats?.remaining_before_limit ?? 0) > nextCards.length,
        }
        // Local mute/exclude preferences can remove cards after the backend
        // build. The HUD should report the actually arranged viewport count.
        const incomingMeta = {
          ...rawMeta,
          scheduled_count: nextCards.length,
        }
        const nextPlan = createRoundPlan(
          queueStateRef.current.roundId,
          nextCards,
          nextConfig,
          incomingMeta,
          queueStateRef.current.roundPlan,
        )
        nextCards = applyRoundPlanOrder(nextCards, nextPlan)
        const plannedState = {
          ...queueStateRef.current,
          palaceScopeSignature: scopeSignature,
          roundPlan: nextPlan,
        }
        persistQueueState(plannedState)
        // Stay on the card the user is viewing (or the just-settled unit). Manual
        // swipe / 下一题 is the only way to advance — no restudy auto-jump.
        // Cold start / remount: preferCardId falls through to persisted currentCardId.
        const preferCardId =
          options?.preferCardId ?? userCardId ?? queueStateRef.current.currentCardId
        cardsRef.current = nextCards
        setCards(nextCards)
        setPhaseStats(response.phase_stats || {})
        setRoundMeta(incomingMeta)
        const resolved = resolveRebuildIndex({
          nextCards,
          preferCardId,
          userCardId,
          fallbackIndex: currentIndexRef.current,
        })
        applyCurrentIndex(resolved, nextCards)
      } catch (err) {
        if (operationIdRef.current !== operationId) return
        const diagnostic = queueBuildDiagnostic({
          operationId,
          roundId: queueStateRef.current.roundId,
          cardId: queueStateRef.current.currentCardId,
          elapsedMs: Date.now() - startedAt,
          reason: options?.reason ?? 'unknown',
          config: nextConfig,
          error: err,
        })
        logAppError({
          feature: '随心队列重建',
          stage: 'queue_build_failed',
          error: diagnostic,
          requestSummary: `POST /freestyle/queue/build (${options?.reason ?? 'unknown'})`,
          meta: { operationId, elapsedMs: Date.now() - startedAt, config: nextConfig },
        })
        // Silent rebuild failures must not blank the feed mid-session.
        if (!silent) {
          setError(diagnostic)
        }
      } finally {
        if (operationIdRef.current === operationId && !silent) {
          setLoading(false)
        }
      }
    },
    [applyCurrentIndex, persistQueueState],
  )

  useEffect(() => {
    void buildQueue(config, { preserveCompleted: true, reason: 'initial_load' })
    // Initial load only; subsequent rebuilds are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const next = scopeEntryConfig(readFreestyleFeedConfig())
    if (sameFeedConfig(next, configRef.current)) return
    pendingRestudyByIdRef.current.clear()
    const freshRound = persistQueueState({
      ...startNewRound(queueStateRef.current, next.seed),
      palaceScopeSignature: freestylePalaceScopeSignature(next),
    })
    configRef.current = next
    setConfig(next)
    cardsRef.current = []
    applyCurrentIndex(0, [])
    setCards([])
    void buildQueue(next, {
      preserveCompleted: false,
      completedIds: freshRound.completedIds,
      hiddenIds: freshRound.hiddenIds,
      reason: 'entry_scope_changed',
    })
  }, [applyCurrentIndex, buildQueue, entryPalaceId, persistQueueState, scopeEntryConfig])

  // Backend preference bootstrap / cross-client updates can arrive after mount.
  useEffect(() => {
    return onAppEvent(FREESTYLE_FEED_CONFIG_UPDATED_EVENT, (detail) => {
      const next = scopeEntryConfig(sanitizeFreestyleFeedConfig(detail))
      if (sameFeedConfig(next, configRef.current)) return
      configRef.current = next
      setConfig(next)
      void buildQueue(next, { preserveCompleted: true, reason: 'config_event' })
    })
  }, [buildQueue, scopeEntryConfig])

  const setConfigAndPersist = useCallback(
    (updater: FreestyleFeedConfig | ((current: FreestyleFeedConfig) => FreestyleFeedConfig)) => {
      const current = configRef.current
      const requested = scopeEntryConfig(
        typeof updater === 'function'
          ? (updater as (c: FreestyleFeedConfig) => FreestyleFeedConfig)(current)
          : updater,
      )
      const stored = readFreestyleFeedConfig()
      const nextToPersist = entryPalaceId == null
        ? requested
        : {
            ...requested,
            specific_palace_ids: stored.specific_palace_ids,
            subject_scope: stored.subject_scope,
          }
      const saved = saveFreestyleFeedConfig(nextToPersist)
      const next = scopeEntryConfig(saved)
      const scopeChanged =
        freestylePalaceScopeSignature(current) !== freestylePalaceScopeSignature(next)
      configRef.current = next
      setConfig(next)
      if (scopeChanged) {
        pendingRestudyByIdRef.current.clear()
        const freshRound = persistQueueState({
          ...startNewRound(queueStateRef.current, next.seed),
          palaceScopeSignature: freestylePalaceScopeSignature(next),
        })
        cardsRef.current = []
        applyCurrentIndex(0, [])
        setCards([])
        void buildQueue(next, {
          preserveCompleted: false,
          completedIds: freshRound.completedIds,
          hiddenIds: freshRound.hiddenIds,
          reason: 'palace_scope_changed',
        })
        return
      }
      void buildQueue(next, { preserveCompleted: true, reason: 'settings_save' })
    },
    [applyCurrentIndex, buildQueue, entryPalaceId, persistQueueState, scopeEntryConfig],
  )

  const refreshQueue = useCallback(() => {
    void buildQueue(config, { preserveCompleted: true, reason: 'manual_refresh' })
  }, [buildQueue, config])

  /** Reshuffle + clear this round's completed/hidden so still-due units can return. */
  const reshuffleQueue = useCallback(() => {
    const nextSeed = config.seed + 1
    const nextConfig = scopeEntryConfig(
      saveFreestyleFeedConfig({ ...readFreestyleFeedConfig(), seed: nextSeed }),
    )
    configRef.current = nextConfig
    setConfig(nextConfig)
    const nextState = persistQueueState(startNewRound(queueStateRef.current, nextSeed))
    applyCurrentIndex(0, [])
    void buildQueue(nextConfig, {
      preserveCompleted: false,
      completedIds: nextState.completedIds,
      hiddenIds: nextState.hiddenIds,
    })
  }, [applyCurrentIndex, buildQueue, config, persistQueueState, scopeEntryConfig])

  /**
   * Mark a card done for this round without removing it from the local feed.
   * Quiz cards stay in place so the user can read analysis and swipe back.
   */
  const acknowledgeCard = useCallback(
    (cardId: string) => {
      const currentPlan = queueStateRef.current.roundPlan
      const nextPlan = currentPlan
        ? updateRoundPlanCard(currentPlan, cardId, { status: 'completed', attemptCount: (currentPlan.cardsById[cardId]?.attemptCount ?? 0) + 1 })
        : null
      persistQueueState({ ...markCompleted(queueStateRef.current, cardId), roundPlan: nextPlan })
    },
    [persistQueueState],
  )

  /**
   * Unit rating outcome: update completed membership and silently rebuild
   * due projections, but keep the card under the viewport so the user can review
   * results and advance manually. Do not use for quiz — use acknowledgeCard.
   *
   * When ``restudy`` is true (忘记/困难 still on this unit), skip completedIds so
   * the round cannot end until the unit is rated 记得/轻松. Never auto-advance.
   * Re-insert with at most RESTUDY_MAX_INTERVENING other cards after the learner
   * leaves (see goToIndex / skip paths).
   */
  const completeCard = useCallback(
    (cardId: string, options?: { restudy?: boolean; cleared?: boolean; rating?: number; retryAfterCards?: number }) => {
      const logicalCardId = sourceCardId(cardsRef.current.find((card) => card.id === cardId)) || cardId
      // Pin the settled unit under the viewport before the async rebuild returns.
      // Do not bump currentIndex forward under any settle path.
      const settledIndex = cardsRef.current.findIndex((card) => card.id === cardId)
      if (settledIndex >= 0) {
        applyCurrentIndex(settledIndex)
      }
      if (options?.cleared) {
        pendingRestudyByIdRef.current.delete(cardId)
        let plan = queueStateRef.current.roundPlan
          ? updateRoundPlanCard(queueStateRef.current.roundPlan, cardId, { status: 'pending', lastRating: null })
          : null
        if (plan && logicalCardId !== cardId) {
          plan = updateRoundPlanCard(plan, logicalCardId, { status: 'pending', lastRating: null })
        }
        const clearedCards = removeRetryOccurrencesForSource(cardsRef.current, sourceCardId(cardsRef.current.find((card) => card.id === cardId)))
        cardsRef.current = clearedCards
        setCards(clearedCards)
        const incomplete = persistQueueState({ ...markIncomplete(queueStateRef.current, logicalCardId), roundPlan: plan })
        void buildQueue(configRef.current, {
          preserveCompleted: true,
          completedIds: incomplete.completedIds,
          silent: true,
          preferCardId: cardId,
        })
        return
      }
      if (options?.restudy) {
        const sourceCard = cardsRef.current.find((card) => card.id === cardId)
        const currentPlan = queueStateRef.current.roundPlan
        const attempt = (currentPlan?.cardsById[cardId]?.attemptCount ?? currentPlan?.cardsById[logicalCardId]?.attemptCount ?? 0) + 1
        const retryOccurrence = sourceCard
          ? createRetryOccurrence(sourceCard, queueStateRef.current.roundId, attempt, options.retryAfterCards ?? 3)
          : null
        if (retryOccurrence) {
          const inserted = insertRetryOccurrenceAfterGap(
            cardsRef.current,
            retryOccurrence,
            settledIndex >= 0 ? settledIndex : currentIndexRef.current,
            options.retryAfterCards ?? 3,
          )
          cardsRef.current = inserted
          setCards(inserted)
        }
        let plan = currentPlan
          ? updateRoundPlanCard(currentPlan, cardId, {
              status: 'retry',
              lastRating: options.rating ?? currentPlan.cardsById[cardId]?.lastRating ?? null,
              retryAfterCards: options.retryAfterCards ?? currentPlan.cardsById[cardId]?.retryAfterCards ?? 3,
              attemptCount: (currentPlan.cardsById[cardId]?.attemptCount ?? 0) + 1,
            })
          : null
        if (plan && retryOccurrence) {
          const retryPlan = createRoundPlan(
            queueStateRef.current.roundId,
            cardsRef.current,
            configRef.current,
            undefined,
            plan,
          )
          plan = updateRoundPlanCard(retryPlan, retryOccurrence.id, {
            status: 'retry',
            lastRating: options.rating ?? null,
            retryAfterCards: options.retryAfterCards ?? 3,
            attemptCount: attempt,
          })
        }
        const incomplete = persistQueueState({ ...markIncomplete(queueStateRef.current, logicalCardId), roundPlan: plan })
        void buildQueue(configRef.current, {
          preserveCompleted: true,
          completedIds: incomplete.completedIds,
          silent: true,
          preferCardId: cardId,
        })
        return
      }
      // Graduated: clear any pending restudy bookkeeping for this unit.
      pendingRestudyByIdRef.current.delete(cardId)
      const graduatedSourceId = sourceCardId(cardsRef.current.find((card) => card.id === cardId)) || cardId
      const graduatedCards = removeRetryOccurrencesForSource(cardsRef.current, graduatedSourceId)
      if (graduatedCards.length !== cardsRef.current.length) {
        cardsRef.current = graduatedCards
        setCards(graduatedCards)
      }
      const currentPlan = queueStateRef.current.roundPlan
      let plan = currentPlan
        ? updateRoundPlanCard(currentPlan, cardId, {
            status: 'completed',
            lastRating: options?.rating ?? currentPlan.cardsById[cardId]?.lastRating ?? null,
            retryAfterCards: 0,
            attemptCount: (currentPlan.cardsById[cardId]?.attemptCount ?? 0) + 1,
          })
        : null
      if (plan && logicalCardId !== cardId) {
        plan = updateRoundPlanCard(plan, logicalCardId, {
          status: 'completed',
          lastRating: options?.rating ?? plan.cardsById[logicalCardId]?.lastRating ?? null,
          retryAfterCards: 0,
          attemptCount: (plan.cardsById[logicalCardId]?.attemptCount ?? 0) + 1,
        })
      }
      const next = persistQueueState({
        ...markCompleted(markCompleted(queueStateRef.current, logicalCardId), cardId),
        roundPlan: plan,
      })
      // Silent rebuild refreshes unit due projections so later cards cannot open stale revisions.
      // preferCardId + order-preserving merge keep the finished unit in place.
      void buildQueue(configRef.current, {
        preserveCompleted: true,
        completedIds: next.completedIds,
        silent: true,
        preferCardId: cardId,
      })
    },
    [applyCurrentIndex, buildQueue, persistQueueState],
  )

  /**
   * Apply pending max-gap restudy placement for units the learner just left.
   * Safe to call on every index change; no-ops when nothing is pending or when
   * the weak unit is still under the viewport.
   */
  const applyPendingRestudyPlacement = useCallback((leavingCardId: string | null | undefined) => {
    const leftId = leavingCardId ? String(leavingCardId).trim() : ''
    if (!leftId || !pendingRestudyByIdRef.current.has(leftId)) return
    const anchor = pendingRestudyByIdRef.current.get(leftId)
    const previous = cardsRef.current
    const nextCards = placeRestudyCardWithMaxGap(previous, leftId, {
      fromIndex: typeof anchor === 'number' ? anchor : undefined,
    })
    pendingRestudyByIdRef.current.delete(leftId)
    if (nextCards === previous) return
    // If order unchanged (already correctly placed), still drop the pending flag.
    const sameOrder =
      nextCards.length === previous.length &&
      nextCards.every((card, index) => card.id === previous[index]?.id)
    if (sameOrder) return
    cardsRef.current = nextCards
    setCards(nextCards)
  }, [])

  /**
   * Drop a card whose formal due vanished between queue build and open.
   * Does **not** mark completed — still-due units must remain eligible after rebuild.
   * Clears local encounter state so a renewed card does not reuse a bad encounter_id.
   */
  const dropStaleCard = useCallback(
    (cardId: string) => {
      const previous = cardsRef.current
      const index = previous.findIndex((card) => card.id === cardId)
      const filtered = previous.filter((card) => card.id !== cardId)
      const preferCardId =
        index >= 0
          ? (filtered[Math.min(index, Math.max(0, filtered.length - 1))]?.id ?? null)
          : (filtered[currentIndexRef.current]?.id ?? filtered[0]?.id ?? null)
      // Stale encounter_id / unit revision must not survive rebuild — next ensure mints fresh.
      const stalePlan = queueStateRef.current.roundPlan
        ? updateRoundPlanCard(queueStateRef.current.roundPlan, cardId, {
            status: 'stale',
            updatedAt: Date.now(),
          })
        : null
      persistQueueState({
        ...clearUnitEncounterState(queueStateRef.current, cardId),
        roundPlan: stalePlan,
      })
      cardsRef.current = filtered
      setCards(filtered)
      applyCurrentIndex(
        Math.min(currentIndexRef.current, Math.max(0, filtered.length - 1)),
        filtered,
      )
      void buildQueue(configRef.current, {
        preserveCompleted: true,
        silent: true,
        preferCardId,
      })
    },
    [applyCurrentIndex, buildQueue, persistQueueState],
  )

  const skipCurrent = useCallback(() => {
    const card = cardsRef.current[currentIndexRef.current]
    if (!card) return
    // Weak-rated units: max-gap re-insert only (do not also shove to full tail).
    const wasRestudy = pendingRestudyByIdRef.current.has(card.id)
    applyPendingRestudyPlacement(card.id)
    const { state, action } = applySkip(queueStateRef.current, card.id)
    persistQueueState(state)
    if (action === 'hide') {
      // Hidden: drop restudy pending so a reshuffle/rebuild can surface it again.
      pendingRestudyByIdRef.current.delete(card.id)
      const filtered = cardsRef.current.filter((item) => item.id !== card.id)
      cardsRef.current = filtered
      setCards(filtered)
      applyCurrentIndex(
        Math.min(currentIndexRef.current, Math.max(0, filtered.length - 1)),
        filtered,
      )
      return
    }
    if (wasRestudy) {
      // Already re-ordered with max intervening gap; keep index so the next unit fills the slot.
      persistCurrentCardId(cardsRef.current[currentIndexRef.current]?.id)
      return
    }
    const nextCards = moveCardToTail(cardsRef.current, card.id)
    cardsRef.current = nextCards
    setCards(nextCards)
    // Stay at same index so next item slides into place after tail move.
    persistCurrentCardId(nextCards[currentIndexRef.current]?.id)
  }, [applyCurrentIndex, applyPendingRestudyPlacement, persistCurrentCardId, persistQueueState])

  const undoLastSkip = useCallback(() => {
    const next = undoSkip(queueStateRef.current)
    persistQueueState(next)
    void buildQueue(config, {
      preserveCompleted: true,
      completedIds: next.completedIds,
      hiddenIds: next.hiddenIds,
    })
  }, [buildQueue, config, persistQueueState])

  const muteCurrentPalace = useCallback(() => {
    const card = cardsRef.current[currentIndexRef.current]
    if (!card) return
    const palaceId =
      card.type === 'mindmap_branch' || card.type === 'anki_card'
        ? card.palace_id
        : card.type === 'quiz_question'
          ? card.palace_context?.id
          : card.palace_context?.id
    if (!palaceId) return
    const next = persistQueueState(mutePalace(queueStateRef.current, palaceId))
    const filtered = filterMutedPalaces(cardsRef.current, next.mutedPalaceIds)
    cardsRef.current = filtered
    setCards(filtered)
    applyCurrentIndex(
      Math.min(currentIndexRef.current, Math.max(0, filtered.length - 1)),
      filtered,
    )
  }, [applyCurrentIndex, persistQueueState])

  const reorderPlan = useCallback((orderIds: string[]) => {
    const currentPlan = queueStateRef.current.roundPlan
    if (!currentPlan) return
    const currentCardId = queueStateRef.current.currentCardId
    const nextPlan = reorderRoundPlan(currentPlan, orderIds)
    const nextCards = applyRoundPlanOrder(cardsRef.current, nextPlan)
    persistQueueState({ ...queueStateRef.current, roundPlan: nextPlan })
    cardsRef.current = nextCards
    setCards(nextCards)
    const resolvedIndex = currentCardId
      ? nextCards.findIndex((card) => card.id === currentCardId)
      : -1
    applyCurrentIndex(
      resolvedIndex >= 0 ? resolvedIndex : Math.min(currentIndexRef.current, Math.max(0, nextCards.length - 1)),
      nextCards,
    )
  }, [applyCurrentIndex, persistQueueState])

  const excludePlanCards = useCallback((cardIds: string[]) => {
    const ids = cardIds.map((id) => String(id || '').trim()).filter(Boolean)
    if (!ids.length) return
    let nextPlan: FreestyleRoundPlanState | null = queueStateRef.current.roundPlan
    ids.forEach((id) => {
      if (nextPlan) nextPlan = updateRoundPlanCard(nextPlan, id, { status: 'excluded' })
    })
    const nextState = hideCards({ ...queueStateRef.current, roundPlan: nextPlan }, ids)
    persistQueueState(nextState)
    const filtered = cardsRef.current.filter((card) => !ids.includes(card.id))
    cardsRef.current = filtered
    setCards(filtered)
    applyCurrentIndex(Math.min(currentIndexRef.current, Math.max(0, filtered.length - 1)), filtered)
    void buildQueue(configRef.current, {
      preserveCompleted: true,
      hiddenIds: nextState.hiddenIds,
      completedIds: nextState.completedIds,
      silent: true,
      preferCardId: filtered[currentIndexRef.current]?.id ?? null,
      reason: 'plan_exclude',
    })
  }, [applyCurrentIndex, buildQueue, persistQueueState])

  const restorePlanCards = useCallback((cardIds: string[]) => {
    const ids = cardIds.map((id) => String(id || '').trim()).filter(Boolean)
    if (!ids.length) return
    let nextPlan: FreestyleRoundPlanState | null = queueStateRef.current.roundPlan
    ids.forEach((id) => {
      if (nextPlan) nextPlan = updateRoundPlanCard(nextPlan, id, { status: 'pending' })
    })
    const nextState = restoreCards({ ...queueStateRef.current, roundPlan: nextPlan }, ids)
    persistQueueState(nextState)
    void buildQueue(configRef.current, {
      preserveCompleted: true,
      hiddenIds: nextState.hiddenIds,
      completedIds: nextState.completedIds,
      reason: 'plan_restore',
    })
  }, [buildQueue, persistQueueState])

  /**
   * Jump past the rest of the current palace: move remaining cards to the tail
   * (and record deferred palace) so a later rebuild cannot reinsert them at the front.
   *
   * Returns the landing index so the page can force the scroll viewport — React may
   * bail out of setState when nextIndex === currentIndex after reorder, and CSS
   * scroll-snap can keep the old card snapped without an explicit scrollTo.
   */
  const skipToNextPalace = useCallback((): number => {
    const index = currentIndexRef.current
    const leaving = cardsRef.current[index]
    applyPendingRestudyPlacement(leaving?.id)
    // Restudy placement may reorder; re-resolve the card we intended to leave.
    let workingIndex = index
    if (leaving) {
      const found = cardsRef.current.findIndex((card) => card.id === leaving.id)
      if (found >= 0) workingIndex = found
    }
    const result = moveRemainingPalaceToTail(cardsRef.current, workingIndex)
    if (result.deferredPalaceId != null) {
      persistQueueState(deferPalace(queueStateRef.current, result.deferredPalaceId))
    }
    cardsRef.current = result.cards
    setCards(result.cards)
    return applyCurrentIndex(result.nextIndex, result.cards)
  }, [applyCurrentIndex, applyPendingRestudyPlacement, persistQueueState])

  const goToIndex = useCallback(
    (index: number, options?: { reorderRestudy?: boolean }) => {
      const previous = cardsRef.current
      const max = Math.max(0, previous.length - 1)
      const next = Math.max(0, Math.min(index, max))
      const previousIndex = currentIndexRef.current
      const reorderRestudy = options?.reorderRestudy !== false
      if (next !== previousIndex) {
        // Capture destination by id before restudy reorders the feed.
        const targetId = previous[next]?.id ?? null
        const leaving = previous[previousIndex]
        // Finger/wheel scroll must NOT reorder under the gesture — that shifts
        // indices while scrollTop stays put and makes swipe-back show the wrong card.
        // Button/keyboard paths may reorder immediately; scroll defers via flush.
        if (reorderRestudy) {
          applyPendingRestudyPlacement(leaving?.id)
        }
        if (targetId) {
          const reordered = cardsRef.current
          const resolved = reordered.findIndex((card) => card.id === targetId)
          const resolvedIndex =
            resolved >= 0
              ? resolved
              : Math.max(0, Math.min(next, Math.max(0, reordered.length - 1)))
          return applyCurrentIndex(resolvedIndex, reordered)
        }
      }
      return applyCurrentIndex(next, previous)
    },
    [applyCurrentIndex, applyPendingRestudyPlacement],
  )

  /**
   * After a finger/wheel swipe settles: place any weak-rated units the learner
   * already left, then re-pin the card still under the viewport by id.
   * Returns the index that should stay on screen (never auto-advances).
   */
  const flushDeferredRestudy = useCallback((): number => {
    const viewingId = cardsRef.current[currentIndexRef.current]?.id ?? null
    const pendingIds = [...pendingRestudyByIdRef.current.keys()]
    for (const cardId of pendingIds) {
      if (viewingId && cardId === viewingId) continue
      applyPendingRestudyPlacement(cardId)
    }
    if (viewingId) {
      const resolved = cardsRef.current.findIndex((card) => card.id === viewingId)
      if (resolved >= 0) {
        return applyCurrentIndex(resolved, cardsRef.current)
      }
    }
    return currentIndexRef.current
  }, [applyCurrentIndex, applyPendingRestudyPlacement])

  /** Reshuffle clears in-memory restudy anchors (new round membership). */
  const reshuffleQueueWithRestudyClear = useCallback(() => {
    pendingRestudyByIdRef.current.clear()
    reshuffleQueue()
  }, [reshuffleQueue])

  return {
    config,
    setConfigAndPersist,
    queueState,
    cards,
    setCards,
    currentIndex,
    setCurrentIndex,
    goToIndex,
    flushDeferredRestudy,
    loading,
    error,
    phaseStats,
    roundMeta,
    roundPlan: queueState.roundPlan,
    refreshQueue,
    reshuffleQueue: reshuffleQueueWithRestudyClear,
    completeCard,
    ensureUnitEncounter,
    updateUnitEncounter,
    acknowledgeCard,
    dropStaleCard,
    skipCurrent,
    skipToNextPalace,
    undoLastSkip,
    muteCurrentPalace,
    reorderPlan,
    excludePlanCards,
    restorePlanCards,
    buildQueue,
  }
}
