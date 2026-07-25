import { useCallback, useEffect, useRef, useState } from 'react'
import { buildFreestyleQueueApi } from '@/modules/practice/ui/freestyle/api'
import {
  applyDeferredPalaceOrder,
  createOperationId,
  deferPalace,
  filterMutedPalaces,
  FREESTYLE_FEED_CONFIG_UPDATED_EVENT,
  markCompleted,
  mergeQueuePreservingHistory,
  mergeRefreshQueue,
  moveCardToTail,
  moveRemainingPalaceToTail,
  mutePalace,
  placeRestudyCardWithMaxGap,
  readFreestyleFeedConfig,
  readQueueState,
  resolveRebuildIndex,
  saveFreestyleFeedConfig,
  saveQueueState,
  applySkip,
  sanitizeFreestyleFeedConfig,
  startNewRound,
  undoSkip,
  type FreestyleSkipState,
} from '@/modules/practice/public'
import type { FreestyleCard, FreestyleFeedConfig } from '@/shared/api/contracts'
import { onAppEvent } from '@/shared/events/appEvents'

function sameFeedConfig(left: FreestyleFeedConfig, right: FreestyleFeedConfig) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

export function useImmersiveQueue() {
  const [config, setConfig] = useState<FreestyleFeedConfig>(() => readFreestyleFeedConfig())
  const [queueState, setQueueState] = useState<FreestyleSkipState>(() => readQueueState())
  const [cards, setCards] = useState<FreestyleCard[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [phaseStats, setPhaseStats] = useState<Record<string, number | string>>({})
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
        /**
         * Weak-rated unit still due for same-session restudy: leave out of
         * completedIds (caller). Gap re-insertion is applied when the learner
         * leaves the unit — not here under the viewport.
         */
        restudyCardId?: string | null
      },
    ) => {
      const operationId = createOperationId()
      operationIdRef.current = operationId
      const silent = Boolean(options?.silent)
      if (!silent) {
        setLoading(true)
        setError('')
      }
      try {
        const completedIds =
          options?.completedIds ??
          (options?.preserveCompleted === false ? [] : queueStateRef.current.completedIds)
        const hiddenIds =
          options?.hiddenIds ??
          (options?.preserveCompleted === false ? [] : queueStateRef.current.hiddenIds)
        const response = await buildFreestyleQueueApi({
          operation_id: operationId,
          config: nextConfig,
          completed_ids: completedIds,
          hidden_ids: hiddenIds,
        })
        // Stale response protection: only accept latest operation.
        if (response.operation_id !== operationIdRef.current) {
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
        // Stay on the card the user is viewing (or the just-settled unit). Manual
        // swipe / 下一题 is the only way to advance — no restudy auto-jump.
        // Cold start / remount: preferCardId falls through to persisted currentCardId.
        const preferCardId =
          options?.preferCardId ?? userCardId ?? queueStateRef.current.currentCardId
        cardsRef.current = nextCards
        setCards(nextCards)
        setPhaseStats(response.phase_stats || {})
        const resolved = resolveRebuildIndex({
          nextCards,
          preferCardId,
          userCardId,
          fallbackIndex: currentIndexRef.current,
        })
        applyCurrentIndex(resolved, nextCards)
      } catch (err) {
        if (operationIdRef.current !== operationId) return
        // Silent rebuild failures must not blank the feed mid-session.
        if (!silent) {
          setError(err instanceof Error ? err.message : '构建随心队列失败。')
        }
      } finally {
        if (operationIdRef.current === operationId && !silent) {
          setLoading(false)
        }
      }
    },
    [applyCurrentIndex],
  )

  useEffect(() => {
    void buildQueue(config, { preserveCompleted: true })
    // Initial load only; subsequent rebuilds are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Backend preference bootstrap / cross-client updates can arrive after mount.
  useEffect(() => {
    return onAppEvent(FREESTYLE_FEED_CONFIG_UPDATED_EVENT, (detail) => {
      const next = sanitizeFreestyleFeedConfig(detail)
      if (sameFeedConfig(next, configRef.current)) return
      configRef.current = next
      setConfig(next)
      void buildQueue(next, { preserveCompleted: true })
    })
  }, [buildQueue])

  const setConfigAndPersist = useCallback(
    (updater: FreestyleFeedConfig | ((current: FreestyleFeedConfig) => FreestyleFeedConfig)) => {
      const current = configRef.current
      const next =
        typeof updater === 'function'
          ? (updater as (c: FreestyleFeedConfig) => FreestyleFeedConfig)(current)
          : updater
      const saved = saveFreestyleFeedConfig(next)
      configRef.current = saved
      setConfig(saved)
      void buildQueue(saved, { preserveCompleted: true })
    },
    [buildQueue],
  )

  const refreshQueue = useCallback(() => {
    void buildQueue(config, { preserveCompleted: true })
  }, [buildQueue, config])

  /** Reshuffle + clear this round's completed/hidden so still-due units can return. */
  const reshuffleQueue = useCallback(() => {
    const nextSeed = config.seed + 1
    const nextConfig = saveFreestyleFeedConfig({ ...config, seed: nextSeed })
    configRef.current = nextConfig
    setConfig(nextConfig)
    const nextState = persistQueueState(startNewRound(queueStateRef.current, nextSeed))
    applyCurrentIndex(0, [])
    void buildQueue(nextConfig, {
      preserveCompleted: false,
      completedIds: nextState.completedIds,
      hiddenIds: nextState.hiddenIds,
    })
  }, [applyCurrentIndex, buildQueue, config, persistQueueState])

  /**
   * Mark a card done for this round without removing it from the local feed.
   * Quiz cards stay in place so the user can read analysis and swipe back.
   */
  const acknowledgeCard = useCallback(
    (cardId: string) => {
      persistQueueState(markCompleted(queueStateRef.current, cardId))
    },
    [persistQueueState],
  )

  /**
   * Formal completion (mind-map FSRS settle): mark completedIds and silently rebuild
   * due projections, but keep the card under the viewport so the user can review
   * results and advance manually. Do not use for quiz — use acknowledgeCard.
   *
   * When ``restudy`` is true (忘记/困难 still on this unit), skip completedIds so
   * the round cannot end until the unit is rated 记得/轻松. Never auto-advance.
   * Re-insert with at most RESTUDY_MAX_INTERVENING other cards after the learner
   * leaves (see goToIndex / skip paths).
   */
  const completeCard = useCallback(
    (cardId: string, options?: { restudy?: boolean }) => {
      // Pin the settled unit under the viewport before the async rebuild returns.
      // Do not bump currentIndex forward under any settle path.
      const settledIndex = cardsRef.current.findIndex((card) => card.id === cardId)
      if (settledIndex >= 0) {
        applyCurrentIndex(settledIndex)
      }
      if (options?.restudy) {
        // Remember settle index for gap placement when the user swipes away.
        const anchor = settledIndex >= 0 ? settledIndex : currentIndexRef.current
        pendingRestudyByIdRef.current.set(cardId, anchor)
        void buildQueue(configRef.current, {
          preserveCompleted: true,
          completedIds: queueStateRef.current.completedIds,
          silent: true,
          restudyCardId: cardId,
          preferCardId: cardId,
        })
        return
      }
      // Graduated: clear any pending restudy bookkeeping for this unit.
      pendingRestudyByIdRef.current.delete(cardId)
      const next = persistQueueState(markCompleted(queueStateRef.current, cardId))
      // Silent rebuild refreshes due sets so later cards never open with stale FSRS scopes.
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
    [applyCurrentIndex, buildQueue],
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
    refreshQueue,
    reshuffleQueue: reshuffleQueueWithRestudyClear,
    completeCard,
    acknowledgeCard,
    dropStaleCard,
    skipCurrent,
    skipToNextPalace,
    undoLastSkip,
    muteCurrentPalace,
    buildQueue,
  }
}
