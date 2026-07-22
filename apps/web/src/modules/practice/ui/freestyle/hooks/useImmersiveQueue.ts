import { useCallback, useEffect, useRef, useState } from 'react'
import { buildFreestyleQueueApi } from '@/modules/practice/ui/freestyle/api'
import {
  createOperationId,
  filterMutedPalaces,
  markCompleted,
  mergeRefreshQueue,
  moveCardToTail,
  mutePalace,
  readFreestyleFeedConfig,
  readQueueState,
  saveFreestyleFeedConfig,
  saveQueueState,
  applySkip,
  undoSkip,
  type FreestyleSkipState,
} from '@/modules/practice/public'
import type { FreestyleCard, FreestyleFeedConfig } from '@/shared/api/contracts'

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
  cardsRef.current = cards
  queueStateRef.current = queueState

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
      },
    ) => {
      const operationId = createOperationId()
      operationIdRef.current = operationId
      setLoading(true)
      setError('')
      try {
        const completedIds =
          options?.completedIds ??
          (options?.preserveCompleted === false ? [] : queueStateRef.current.completedIds)
        const hiddenIds = options?.hiddenIds ?? queueStateRef.current.hiddenIds
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
        const incoming = filterMutedPalaces(
          response.cards || [],
          queueStateRef.current.mutedPalaceIds,
        )
        setCards((previous) =>
          options?.preserveCompleted === false
            ? incoming
            : mergeRefreshQueue(previous, incoming),
        )
        setPhaseStats(response.phase_stats || {})
        setCurrentIndex((index) => Math.min(index, Math.max(0, incoming.length - 1)))
      } catch (err) {
        if (operationIdRef.current !== operationId) return
        setError(err instanceof Error ? err.message : '构建随心队列失败。')
      } finally {
        if (operationIdRef.current === operationId) {
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

  const setConfigAndPersist = useCallback(
    (updater: FreestyleFeedConfig | ((current: FreestyleFeedConfig) => FreestyleFeedConfig)) => {
      setConfig((current) => {
        const next =
          typeof updater === 'function'
            ? (updater as (c: FreestyleFeedConfig) => FreestyleFeedConfig)(current)
            : updater
        const saved = saveFreestyleFeedConfig(next)
        void buildQueue(saved, { preserveCompleted: true })
        return saved
      })
    },
    [buildQueue],
  )

  const refreshQueue = useCallback(() => {
    void buildQueue(config, { preserveCompleted: true })
  }, [buildQueue, config])

  const reshuffleQueue = useCallback(() => {
    const nextConfig = saveFreestyleFeedConfig({ ...config, seed: config.seed + 1 })
    setConfig(nextConfig)
    const currentState = queueStateRef.current
    persistQueueState({ ...currentState, seed: nextConfig.seed })
    setCurrentIndex(0)
    void buildQueue(nextConfig, { preserveCompleted: true })
  }, [buildQueue, config, persistQueueState])

  const completeCard = useCallback(
    (cardId: string) => {
      persistQueueState(markCompleted(queueStateRef.current, cardId))
    },
    [persistQueueState],
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
      card.type === 'mindmap_branch'
        ? card.palace_id
        : card.type === 'quiz_question'
          ? card.palace_context?.id
          : card.palace_context?.id
    if (!palaceId) return
    const next = persistQueueState(mutePalace(queueStateRef.current, palaceId))
    setCards((current) => filterMutedPalaces(current, next.mutedPalaceIds))
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
    skipCurrent,
    undoLastSkip,
    muteCurrentPalace,
    buildQueue,
  }
}
