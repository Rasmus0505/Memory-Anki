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
  placeRestudyCardAtTail,
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
         * Weak-rated unit: leave out of completedIds (caller), then pin to the
         * tail of the rebuilt queue for end-of-batch restudy.
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
        const userCardId = previousCards[clampedUserIndex]?.id ?? null
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
        // Weak unit goes to the tail only after the learner has already left it.
        // Never reorder under the viewport — that used to feel like auto-flip.
        if (restudyCardId && userCardId && userCardId !== restudyCardId) {
          nextCards = placeRestudyCardAtTail(nextCards, restudyCardId)
        }
        // Stay on the card the user is viewing (or the just-settled unit). Manual
        // swipe / 下一题 is the only way to advance — no restudy auto-jump.
        const preferCardId = options?.preferCardId ?? userCardId
        cardsRef.current = nextCards
        setCards(nextCards)
        setPhaseStats(response.phase_stats || {})
        setCurrentIndex((index) =>
          resolveRebuildIndex({
            nextCards,
            preferCardId,
            userCardId,
            fallbackIndex: index,
          }),
        )
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
    [],
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
    setCurrentIndex(0)
    void buildQueue(nextConfig, {
      preserveCompleted: false,
      completedIds: nextState.completedIds,
      hiddenIds: nextState.hiddenIds,
    })
  }, [buildQueue, config, persistQueueState])

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
   * When ``restudy`` is true (忘记/困难 still on this unit), skip completedIds.
   * Never auto-advance — the learner must swipe / 下一题 themselves. The unit is
   * only moved to the queue tail once they have already left it (see buildQueue).
   */
  const completeCard = useCallback(
    (cardId: string, options?: { restudy?: boolean }) => {
      if (options?.restudy) {
        void buildQueue(configRef.current, {
          preserveCompleted: true,
          completedIds: queueStateRef.current.completedIds,
          silent: true,
          restudyCardId: cardId,
          preferCardId: cardId,
        })
        return
      }
      const next = persistQueueState(markCompleted(queueStateRef.current, cardId))
      // Silent rebuild refreshes due sets so later cards never open with stale FSRS scopes.
      // preferCardId keeps the just-finished unit in place (mergeQueuePreservingHistory).
      void buildQueue(configRef.current, {
        preserveCompleted: true,
        completedIds: next.completedIds,
        silent: true,
        preferCardId: cardId,
      })
    },
    [buildQueue, persistQueueState],
  )

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
      setCurrentIndex((current) => Math.min(current, Math.max(0, filtered.length - 1)))
      void buildQueue(configRef.current, {
        preserveCompleted: true,
        silent: true,
        preferCardId,
      })
    },
    [buildQueue],
  )

  const skipCurrent = useCallback(() => {
    const card = cardsRef.current[currentIndex]
    if (!card) return
    const { state, action } = applySkip(queueStateRef.current, card.id)
    persistQueueState(state)
    if (action === 'hide') {
      setCards((current) => current.filter((item) => item.id !== card.id))
      setCurrentIndex((index) => Math.min(index, Math.max(0, cardsRef.current.length - 2)))
      return
    }
    setCards((current) => moveCardToTail(current, card.id))
    // Stay at same index so next item slides into place after tail move.
  }, [currentIndex, persistQueueState])

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
    const card = cardsRef.current[currentIndex]
    if (!card) return
    const palaceId =
      card.type === 'mindmap_branch' || card.type === 'anki_card'
        ? card.palace_id
        : card.type === 'quiz_question'
          ? card.palace_context?.id
          : card.palace_context?.id
    if (!palaceId) return
    const next = persistQueueState(mutePalace(queueStateRef.current, palaceId))
    setCards((current) => filterMutedPalaces(current, next.mutedPalaceIds))
  }, [currentIndex, persistQueueState])

  /**
   * Jump past the rest of the current palace: move remaining cards to the tail
   * (and record deferred palace) so a later rebuild cannot reinsert them at the front.
   */
  const skipToNextPalace = useCallback(() => {
    const result = moveRemainingPalaceToTail(cardsRef.current, currentIndex)
    if (result.deferredPalaceId != null) {
      persistQueueState(deferPalace(queueStateRef.current, result.deferredPalaceId))
    }
    cardsRef.current = result.cards
    setCards(result.cards)
    setCurrentIndex(result.nextIndex)
  }, [currentIndex, persistQueueState])

  const goToIndex = useCallback((index: number) => {
    setCurrentIndex(() => {
      const max = Math.max(0, cardsRef.current.length - 1)
      return Math.max(0, Math.min(index, max))
    })
  }, [])

  return {
    config,
    setConfigAndPersist,
    queueState,
    cards,
    setCards,
    currentIndex,
    setCurrentIndex,
    goToIndex,
    loading,
    error,
    phaseStats,
    refreshQueue,
    reshuffleQueue,
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
