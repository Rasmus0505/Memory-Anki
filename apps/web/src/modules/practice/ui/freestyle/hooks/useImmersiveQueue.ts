import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  applyFreestyleRoundActionApi,
  buildFreestyleQueueApi,
  dropFreestyleOverlayQuizPalacesApi,
  getFreestyleRoundApi,
  getOrCreateFreestyleRoundApi,
  startFreestyleRoundApi,
} from '@/modules/practice/ui/freestyle/api'
import {
  applyServerCohorts,
  applyServerRatingsToRoundPlan,
  cardsForServerPlan,
  mergeServerPlanIntoLocalEncounters,
  nextUnfinishedCardId,
  planCardCohort,
  resolveResumePreferCardId,
  serverPlanVersion,
} from '@/modules/practice/domain/serverRoundPlan'
import {
  syncCompletedIdsToRoundPlan,
  applyDeferredPalaceOrder,
  applyRoundPlanOrder,
  clearMutedPalaces,
  createRoundPlan,
  createOperationId,
  filterMutedPalaces,
  FREESTYLE_FEED_CONFIG_UPDATED_EVENT,
  markCompleted,
  markIncomplete,
  hideCards,
  restoreCards,
  mergeQueuePreservingHistory,
  mergeRefreshQueue,
  rebindCompletedIdsByUnit,
  rebindUnitEncountersByUnitId,
  moveCardToTail,
  mutePalace,

  createRetryOccurrence,
  insertRetryOccurrenceAfterGap,
  isRetryOccurrence,
  nextRetryAttempt,
  resolveLeaveConfirmViewportId,
  restudyInterveningGap,
  RESTUDY_MAX_INTERVENING,
  removeRetryOccurrencesForSource,
  restoreExplicitlySelectedCards,
  sourceCardId,
  emitFreestylePeerRound,
  FREESTYLE_PEER_ROUND_EVENT,
  FREESTYLE_SECONDARY_FEED_CONFIG_UPDATED_EVENT,
  FREESTYLE_WORKSPACE_PRIMARY,
  freestyleWorkspacePath,
  normalizeFreestyleWorkspaceId,
  readFreestyleFeedConfig,
  readQueueState,
  resolveRebuildIndex,
  saveFreestyleFeedConfig,
  saveQueueState,
  type FreestylePeerRoundDetail,
  type FreestyleWorkspaceId,
  stampRestudyPlan,
  updateRoundPlanCard,
  reorderRoundPlan,
  type FreestyleRoundPlanState,
  setUnitEncounterState,
  shouldRenewFreestyleEncounter,
  clearUnitEncounterState,
  applySkip,
  sanitizeFreestyleFeedConfig,
  freestylePalaceScopeSignature,
  undoSkip,
  type FreestyleSkipState,
  type FreestyleUnitEncounterState,
} from '@/modules/practice/public'
import {
  clearQuizSessionProgress,
  clearQuizSessionProgressForPalaces,
  removeQuizSessionQuestions,
} from '@/modules/quiz/public'
import type {
  FreestyleCard,
  FreestyleFeedConfig,
  FreestyleRoundStatePayload,
} from '@/shared/api/contracts'
import { overlayReviewPalaceIds } from '@/modules/practice/ui/freestyle/model/overlayQuizRange'
import {
  applyFreestyleEntryScopeUnlessSaved,
  persistFreestyleConfigWithoutEntryLock,
  shouldUseFreestyleSelectionScope,
} from '@/modules/practice/ui/freestyle/model/freestyle-entry-scope'
import {
  EMPTY_STALE_DROP_CIRCUIT,
  STALE_REBUILD_DEBOUNCE_MS,
  cardRevisionOf,
  decideStaleDrop,
  isCardBlockedByStaleKey,
  makeStaleCardKey,
  noteStableCard,
  resetStaleDropCircuit,
  type StaleDropCircuit,
  type StaleDropDecision,
} from '@/modules/practice/ui/freestyle/model/freestyleStaleRecovery'
import { onAppEvent } from '@/shared/events/appEvents'
import { logAppError } from '@/shared/logs/model/appLogs'
import {
  CLIENT_PREFERENCES_UPDATED_EVENT,
  hasLoadedClientPreferences,
} from '@/shared/preferences/clientPreferences'

const QUEUE_BUILD_TIMEOUT_MS = 15_000
const QUEUE_BUILD_RETRY_DELAY_MS = 500
const QUEUE_BUILD_MAX_ATTEMPTS = 2

class QueueBuildTimeoutError extends Error {
  constructor() {
    super(`队列构建超过 ${QUEUE_BUILD_TIMEOUT_MS / 1000} 秒仍未完成`)
    this.name = 'QueueBuildTimeoutError'
  }
}

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

function waitForQueueBuildRetry(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return
    }
    const handleAbort = () => {
      window.clearTimeout(retryTimer)
      signal.removeEventListener('abort', handleAbort)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    const retryTimer = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort)
      resolve()
    }, QUEUE_BUILD_RETRY_DELAY_MS)
    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

async function buildQueueWithTimeout(
  payload: Parameters<typeof buildFreestyleQueueApi>[0],
  signal: AbortSignal,
) {
  let lastError: unknown
  for (let attempt = 0; attempt < QUEUE_BUILD_MAX_ATTEMPTS; attempt += 1) {
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    const attemptController = new AbortController()
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      attemptController.abort()
    }, QUEUE_BUILD_TIMEOUT_MS)
    const abortAttempt = () => attemptController.abort()
    signal.addEventListener('abort', abortAttempt, { once: true })
    try {
      return await buildFreestyleQueueApi(payload, { signal: attemptController.signal })
    } catch (error) {
      if (!timedOut || signal.aborted) throw error
      lastError = new QueueBuildTimeoutError()
    } finally {
      window.clearTimeout(timeout)
      signal.removeEventListener('abort', abortAttempt)
    }
    if (attempt + 1 < QUEUE_BUILD_MAX_ATTEMPTS) await waitForQueueBuildRetry(signal)
  }
  throw lastError ?? new QueueBuildTimeoutError()
}

type PendingRestudy = {
  anchorIndex: number
  attempt: number
  retryAfterCards: number
  rating?: number
}

function insertPendingRetryCopy(
  cards: FreestyleCard[],
  sourceId: string,
  pending: PendingRestudy | undefined,
  roundId: string,
  roundPlan: FreestyleRoundPlanState | null,
): FreestyleCard[] {
  if (!pending) return cards
  const source = cards.find((card) => card.id === sourceId && !isRetryOccurrence(card))
    || cards.find((card) => sourceCardId(card) === sourceId && !isRetryOccurrence(card))
    || cards.find((card) => card.id === sourceId)
    || cards.find((card) => sourceCardId(card) === sourceId)
  if (!source) return cards
  const rootId = sourceCardId(source) || source.id
  const remainingOthers = Math.max(0, cards.length - pending.anchorIndex - 1)
  const gap = restudyInterveningGap(remainingOthers, pending.retryAfterCards)
  const attempt = Math.max(1, pending.attempt)
  const existing = cards.find((card) => isRetryOccurrence(card) && sourceCardId(card) === rootId)
  const occurrence = existing
    ? {
        ...existing,
        retry_attempt: Math.max(1, Number(existing.retry_attempt) || 1, attempt),
        retry_after_cards: gap,
        // Next attempt is a blank glance: never keep the previous score on the
        // same occurrence id (已评分就填实心 would otherwise pin it solid).
        source_card_id: existing.source_card_id ?? sourceCardId(source),
        occurrence_kind: 'retry' as const,
      }
    : createRetryOccurrence(source, roundId, attempt, gap)
  if (!existing && cards.some((card) => card.id === occurrence.id)) return cards
  return insertRetryOccurrenceAfterGap(
    cards,
    occurrence,
    pending.anchorIndex,
    gap,
    (cardId) => planCardCohort(cardId, roundPlan),
  )
}

function asLeftoverDue(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const count = Math.round(Number(value) || 0)
    if (key && count > 0) result[key] = count
  }
  return result
}

function sameFeedConfig(left: FreestyleFeedConfig, right: FreestyleFeedConfig) {
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

export type StaleDropResult = StaleDropDecision & {
  dropped: boolean
}

export function useImmersiveQueue(
  entryPalaceId: number | null = null,
  workspace: FreestyleWorkspaceId = FREESTYLE_WORKSPACE_PRIMARY,
) {
  const slot = normalizeFreestyleWorkspaceId(workspace)
  const location = useLocation()
  const unlockedEntryPalaceIdRef = useRef<number | null>(null)
  const scopeEntryConfig = useCallback(
    (next: FreestyleFeedConfig) => applyFreestyleEntryScopeUnlessSaved(next, entryPalaceId),
    [entryPalaceId],
  )
  const [config, setConfig] = useState<FreestyleFeedConfig>(() =>
    scopeEntryConfig(readFreestyleFeedConfig(slot)),
  )
  const [queueState, setQueueState] = useState<FreestyleSkipState>(() => readQueueState(slot))
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
    palace_leftover_due: {} as Record<string, number>,
  })
  const operationIdRef = useRef<string>('')
  const queueBuildControllerRef = useRef<AbortController | null>(null)
  const cardsRef = useRef<FreestyleCard[]>([])
  const queueStateRef = useRef(queueState)
  const configRef = useRef(config)
  const currentIndexRef = useRef(0)
  /**
   * Weak-rated units whose retry is not on the rail yet. A source 忘记/困难
   * inserts immediately. Failing the retry card itself stays here until leave,
   * so that card is not pulled out from under the viewport.
   * Value is the index at settle time (anchor for max-gap insert).
   */
  const pendingRestudyByIdRef = useRef<Map<string, PendingRestudy>>(new Map())
  const [pendingRestudyCardIds, setPendingRestudyCardIds] = useState<string[]>([])
  const syncPendingRestudyIds = useCallback(() => {
    setPendingRestudyCardIds([...pendingRestudyByIdRef.current.keys()])
  }, [])
  const applyPendingRestudyPlacementRef = useRef<(leavingCardId: string | null | undefined) => void>(
    () => {},
  )
  /** Cards rejected as stale stay out of the round until revision changes. */
  const staleCardKeysRef = useRef<Set<string>>(new Set())
  const staleCircuitRef = useRef<StaleDropCircuit>(EMPTY_STALE_DROP_CIRCUIT)
  const staleRebuildTimerRef = useRef<number | null>(null)
  const staleRebuildPreferCardIdRef = useRef<string | null>(null)
  const [staleCircuitOpen, setStaleCircuitOpen] = useState(false)
  const [staleRecoveryCardId, setStaleRecoveryCardId] = useState<string | null>(null)
  const serverPlanVersionRef = useRef(0)
  const [planVersion, setPlanVersion] = useState(0)
  const [queueFrozen, setQueueFrozen] = useState(false)
  cardsRef.current = cards
  queueStateRef.current = queueState
  configRef.current = config
  currentIndexRef.current = currentIndex

  useEffect(() => {
    return () => {
      queueBuildControllerRef.current?.abort()
      if (staleRebuildTimerRef.current != null) {
        window.clearTimeout(staleRebuildTimerRef.current)
        staleRebuildTimerRef.current = null
      }
    }
  }, [])

  const syncStaleCircuit = useCallback((next: StaleDropCircuit) => {
    staleCircuitRef.current = next
    setStaleCircuitOpen(next.open)
    if (!next.open) setStaleRecoveryCardId(null)
  }, [])

  const resetStaleRecovery = useCallback(() => {
    if (staleRebuildTimerRef.current != null) {
      window.clearTimeout(staleRebuildTimerRef.current)
      staleRebuildTimerRef.current = null
    }
    syncStaleCircuit(resetStaleDropCircuit())
  }, [syncStaleCircuit])

  const persistQueueState = useCallback((next: FreestyleSkipState) => {
    const sanitized = saveQueueState(next, slot)
    queueStateRef.current = sanitized
    setQueueState(sanitized)
    return sanitized
  }, [slot])

  const notifyPeerRound = useCallback(() => {
    emitFreestylePeerRound(slot)
  }, [slot])

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

  /** Commit the viewport card to the server round cursor so F5 can restore it. */
  const commitRoundCursor = useCallback((cardId: string | null | undefined) => {
    const target = cardId ? String(cardId).trim() : ''
    if (!target) return
    const roundId = queueStateRef.current.roundId
    if (!roundId) return
    void applyFreestyleRoundActionApi(roundId, {
      operation_id: createOperationId(),
      expected_version: serverPlanVersionRef.current,
      action: 'set_cursor',
      card_id: target,
    }).then((round) => {
      if (queueStateRef.current.roundId !== roundId) return
      serverPlanVersionRef.current = serverPlanVersion(round)
      setPlanVersion(serverPlanVersion(round))
    }).catch(() => {
      // Local draft cursor remains; next successful settle retries.
    })
  }, [])

  const ensureUnitEncounter = useCallback(
    (cardId: string, unitRevision: number, allowRenew: boolean) => {
      const existing = queueStateRef.current.unitEncountersByCardId[cardId]
      if (existing && !shouldRenewFreestyleEncounter(existing, unitRevision, allowRenew)) {
        return existing
      }
      const next: FreestyleUnitEncounterState = {
        encounterId: createOperationId(),
        roundId: queueStateRef.current.roundId,
        unitRevision,
        status: 'pending',
        sessionId: null,
        selectedRating: existing?.selectedRating ?? null,
        passed: existing?.passed ?? null,
        retryAfterCards: existing?.retryAfterCards ?? 0,
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
      if (encounter.status === 'open' || encounter.status === 'closed') {
        syncStaleCircuit(noteStableCard(staleCircuitRef.current))
      }
    },
    [persistQueueState, syncStaleCircuit],
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

  const buildQueueRef = useRef<
    ((
      nextConfig: FreestyleFeedConfig,
      options?: {
        preserveCompleted?: boolean
        silent?: boolean
        preferCardId?: string | null
        reason?: string
        studyWindow?: boolean
      },
    ) => Promise<void>) | null
  >(null)

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
         * completedIds (caller). The source retry is already in the feed; this
         * id is only a retry glance that still needs leave-time reposition.
         */
        restudyCardId?: string | null
        /** Force replan_remaining on the current round (重建本轮). */
        replan?: boolean
        /**
         * Cold start with no stored round: ask for a prefix, then silently
         * load the tail. Never set this once a round id exists.
         */
        studyWindow?: boolean
        /**
         * Explicit mint after config confirm (settlement 「再来一轮」 → 开始下一轮).
         * Refresh / restart / queue rebuild must never set this.
         */
        forceStart?: boolean
      },
    ) => {
      const operationId = createOperationId()
      const startedAt = Date.now()
      let tailPending = false
      let tailPreferId: string | null = null
      queueBuildControllerRef.current?.abort()
      const queueBuildController = new AbortController()
      queueBuildControllerRef.current = queueBuildController
      operationIdRef.current = operationId
      const silent = Boolean(options?.silent)
      if (!silent) {
        setLoading(true)
        setError('')
      }
      try {
        const scopeSignature = freestylePalaceScopeSignature(nextConfig)
        if (queueStateRef.current.palaceScopeSignature !== scopeSignature) {
          // Remember the current scope. Do not mint a new round here — refresh
          // and silent rebuilds must restore server progress unless the caller
          // already started a new round.
          persistQueueState({ ...queueStateRef.current, palaceScopeSignature: scopeSignature })
        }
        // Explicit picker selections override stale local mute state. Without
        // this, a valid backend candidate list can become an empty feed.
        const reenabled = clearMutedPalaces(
          queueStateRef.current,
          nextConfig.specific_palace_ids,
        )
        if (reenabled !== queueStateRef.current) persistQueueState(reenabled)
        const completedIds =
          options?.completedIds ??
          (options?.preserveCompleted === false
            ? []
            : queueStateRef.current.completedIds)
        const hiddenIds =
          options?.hiddenIds ??
          (options?.preserveCompleted === false
            ? []
            : queueStateRef.current.hiddenIds)
        const response = await buildQueueWithTimeout(
          {
            operation_id: operationId,
            round_id: queueStateRef.current.roundId,
            config: nextConfig,
            completed_ids: completedIds,
            hidden_ids: hiddenIds,
            study_window: options?.studyWindow === true,
          },
          queueBuildController.signal,
        )
        // Stale response protection: only accept latest operation.
        // Server round_id is authoritative and may differ from a local draft.
        if (response.operation_id !== operationIdRef.current) {
          return
        }
        const responseCards = response.cards || []
        const availableCards = responseCards.filter(
          (card) => !isCardBlockedByStaleKey(
            staleCardKeysRef.current,
            queueStateRef.current.roundId,
            card,
          ),
        )
        const excludedCardIds = new Set(
          responseCards
            .filter((card) => !availableCards.includes(card))
            .map((card) => card.id),
        )
        const muted = filterMutedPalaces(
          availableCards,
          queueStateRef.current.mutedPalaceIds,
        )
        const scopedCards = restoreExplicitlySelectedCards(
          responseCards,
          muted,
          {
            specificPalaceIds: nextConfig.specific_palace_ids,
            subjectScope: nextConfig.subject_scope,
            excludeCardIds: excludedCardIds,
          },
        )
        const deferred = applyDeferredPalaceOrder(
          scopedCards,
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
        // Weak unit stays in place. If the learner already left, insert a retry
        // copy after the gap — never move the source card.
        if (restudyCardId && userCardId && userCardId !== restudyCardId) {
          nextCards = insertPendingRetryCopy(
            nextCards,
            restudyCardId,
            pendingRestudyByIdRef.current.get(restudyCardId),
            queueStateRef.current.roundId,
            queueStateRef.current.roundPlan,
          )
          pendingRestudyByIdRef.current.delete(restudyCardId)
          syncPendingRestudyIds()
        }
        const reboundEncounters = rebindUnitEncountersByUnitId(
          queueStateRef.current.unitEncountersByCardId,
          previousCards,
          nextCards,
        )
        const reboundCompleted = rebindCompletedIdsByUnit(
          completedIds,
          previousCards,
          nextCards,
        )
        if (options?.preserveCompleted !== false) {
          persistQueueState({
            ...queueStateRef.current,
            unitEncountersByCardId: reboundEncounters,
            completedIds: reboundCompleted,
          })
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
          candidate_count: Number(rawMeta.candidate_count) || nextCards.length,
          scheduled_count: nextCards.length,
          queue_limit: Number(rawMeta.queue_limit) || nextConfig.queue_length,
          limit_reached: Boolean(rawMeta.limit_reached),
          palace_leftover_due: asLeftoverDue(rawMeta.palace_leftover_due),
        }
        const builtCards = nextCards
        const nextPlan = createRoundPlan(
          queueStateRef.current.roundId,
          builtCards,
          nextConfig,
          incomingMeta,
          queueStateRef.current.roundPlan,
        )
        nextCards = applyRoundPlanOrder(builtCards, nextPlan)
        const plannedState = {
          ...queueStateRef.current,
          palaceScopeSignature: scopeSignature,
          roundPlan: nextPlan,
        }
        persistQueueState(plannedState)
        if (silent) setQueueFrozen(true)
        let serverCurrentId: string | null = null
        let draftResumeCardId: string | null = queueStateRef.current.currentCardId
        try {
          let round = await getOrCreateFreestyleRoundApi({
            operation_id: createOperationId(),
            scope_key: scopeSignature,
            config: nextConfig,
            cards: builtCards,
            round_id: queueStateRef.current.roundId,
            workspace: slot,
            replan: Boolean(options?.replan),
          }, { signal: queueBuildController.signal })
          if (operationIdRef.current !== operationId) return
          // Mint a new round_id only after the learner confirms config
          // (settlement 「再来一轮」 → startNextRound → forceStart). Refresh,
          // restart, HUD 刷新队列, and leftover due must keep the frozen round.
          if (options?.forceStart) {
            round = await startFreestyleRoundApi({
              operation_id: createOperationId(),
              scope_key: scopeSignature,
              config: nextConfig,
              cards: builtCards,
              workspace: slot,
            })
            if (operationIdRef.current !== operationId) return
          }
          const version = serverPlanVersion(round)
          serverPlanVersionRef.current = version
          setPlanVersion(version)
          const adoptedRoundId = round.round_id || queueStateRef.current.roundId
          if (adoptedRoundId && adoptedRoundId !== queueStateRef.current.roundId) {
            persistQueueState({ ...queueStateRef.current, roundId: adoptedRoundId })
          }
          nextCards = cardsForServerPlan(builtCards, round.plan, adoptedRoundId)
          incomingMeta.scheduled_count = nextCards.length
          const serverCompleted = Array.isArray(round.plan?.completed_ids)
            ? round.plan.completed_ids.map(String)
            : queueStateRef.current.completedIds
          const serverHidden = Array.isArray(round.plan?.excluded_ids)
            ? round.plan.excluded_ids.map(String)
            : queueStateRef.current.hiddenIds
          serverCurrentId = nextUnfinishedCardId(round.plan, nextCards)
          // Capture the pre-hydrate draft cursor before server fields overwrite it.
          draftResumeCardId = queueStateRef.current.currentCardId
          const hydratedPlan = applyServerRatingsToRoundPlan(
            applyServerCohorts(
              syncCompletedIdsToRoundPlan(
                createRoundPlan(
                  adoptedRoundId,
                  nextCards,
                  nextConfig,
                  incomingMeta,
                  queueStateRef.current.roundPlan,
                ),
                serverCompleted,
              ),
              round.plan,
            ),
            round.plan,
          )
          const resumeCardId = resolveResumePreferCardId({
            preferCardId: options?.preferCardId,
            silent,
            draftCardId: draftResumeCardId,
            serverCurrentId,
            userCardId,
            nextCards,
          })
          persistQueueState({
            ...queueStateRef.current,
            roundId: adoptedRoundId,
            completedIds: serverCompleted,
            hiddenIds: serverHidden,
            currentCardId: resumeCardId ?? serverCurrentId ?? draftResumeCardId,
            unitEncountersByCardId: mergeServerPlanIntoLocalEncounters(
              queueStateRef.current.unitEncountersByCardId,
              round.plan,
              adoptedRoundId,
            ),
            roundPlan: hydratedPlan,
          })
          notifyPeerRound()
        } catch {
          // Offline draft keeps the local plan until the server is reachable.
        }
        // Stay on the card the user is viewing (or the just-settled unit). Manual
        // swipe / 下一题 is the only way to advance — no restudy auto-jump.
        // Cold start prefers the local draft cursor when it still exists in-feed.
        const preferCardId = resolveResumePreferCardId({
          preferCardId: options?.preferCardId,
          silent,
          draftCardId: draftResumeCardId ?? queueStateRef.current.currentCardId,
          serverCurrentId,
          userCardId,
          nextCards,
        })
        const liveUserCardId =
          cardsRef.current[currentIndexRef.current]?.id
          ?? userCardId
        cardsRef.current = nextCards
        setCards(nextCards)
        setPhaseStats(response.phase_stats || {})
        setRoundMeta(incomingMeta)
        const resolved = resolveRebuildIndex({
          nextCards,
          preferCardId,
          userCardId: silent
            ? liveUserCardId
            : (preferCardId ?? serverCurrentId ?? liveUserCardId),
          fallbackIndex: currentIndexRef.current,
          previousCards,
        })
        applyCurrentIndex(resolved, nextCards)
        setQueueFrozen(false)
        tailPending = Boolean(response.round_meta?.tail_pending) && options?.studyWindow === true
        tailPreferId = nextCards[resolved]?.id ?? queueStateRef.current.currentCardId
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
        if (queueBuildControllerRef.current === queueBuildController) {
          queueBuildControllerRef.current = null
        }
        if (
          operationIdRef.current === operationId
          && (!silent || cardsRef.current.length > 0)
        ) {
          setLoading(false)
        }
        if (operationIdRef.current === operationId) setQueueFrozen(false)
      }
      if (tailPending && operationIdRef.current === operationId) {
        void buildQueueRef.current?.(nextConfig, {
          preserveCompleted: true,
          silent: true,
          preferCardId: tailPreferId,
          reason: 'study_window_tail',
        })
      }
    },
    [applyCurrentIndex, notifyPeerRound, persistQueueState, slot, syncPendingRestudyIds],
  )
  buildQueueRef.current = buildQueue

  const rebuildKeepingProgress = useCallback(
    (
      nextConfig: FreestyleFeedConfig,
      reason: string,
      options?: { silent?: boolean; preferCardId?: string | null },
    ) => {
      persistQueueState({
        ...queueStateRef.current,
        palaceScopeSignature: freestylePalaceScopeSignature(nextConfig),
      })
      void buildQueue(nextConfig, {
        preserveCompleted: true,
        reason,
        silent: options?.silent,
        preferCardId: options?.preferCardId ?? queueStateRef.current.currentCardId,
      })
    },
    [buildQueue, persistQueueState],
  )

  const scheduleStaleRebuild = useCallback((preferCardId: string | null) => {
    staleRebuildPreferCardIdRef.current = preferCardId
    if (staleRebuildTimerRef.current != null) {
      window.clearTimeout(staleRebuildTimerRef.current)
    }
    staleRebuildTimerRef.current = window.setTimeout(() => {
      staleRebuildTimerRef.current = null
      void buildQueue(configRef.current, {
        preserveCompleted: true,
        silent: true,
        preferCardId: staleRebuildPreferCardIdRef.current,
        reason: 'stale_card_rebuild',
      })
    }, STALE_REBUILD_DEBOUNCE_MS)
  }, [buildQueue])

  useEffect(() => {
    const next = scopeEntryConfig(readFreestyleFeedConfig(slot))
    if (sameFeedConfig(next, configRef.current)) return
    pendingRestudyByIdRef.current.clear()
    syncPendingRestudyIds()
    staleCardKeysRef.current.clear()
    resetStaleRecovery()
    configRef.current = next
    setConfig(next)
    rebuildKeepingProgress(next, 'entry_scope_changed')
  }, [entryPalaceId, rebuildKeepingProgress, resetStaleRecovery, scopeEntryConfig, slot, syncPendingRestudyIds])

  // Backend preference bootstrap / cross-client updates can arrive after mount.
  useEffect(() => {
    const configEvent = slot === 'secondary'
      ? FREESTYLE_SECONDARY_FEED_CONFIG_UPDATED_EVENT
      : FREESTYLE_FEED_CONFIG_UPDATED_EVENT
    return onAppEvent(configEvent, (detail) => {
      const saved = sanitizeFreestyleFeedConfig(detail)
      const next = entryPalaceId != null && unlockedEntryPalaceIdRef.current === entryPalaceId
        ? saved
        : scopeEntryConfig(saved)
      if (sameFeedConfig(next, configRef.current)) return
      const scopeChanged =
        freestylePalaceScopeSignature(configRef.current) !== freestylePalaceScopeSignature(next)
      configRef.current = next
      setConfig(next)
      if (scopeChanged) {
        pendingRestudyByIdRef.current.clear()
        syncPendingRestudyIds()
        staleCardKeysRef.current.clear()
      }
      rebuildKeepingProgress(next, scopeChanged ? 'palace_scope_changed' : 'config_event')
    })
  }, [entryPalaceId, rebuildKeepingProgress, scopeEntryConfig, slot, syncPendingRestudyIds])

  const setConfigAndPersist = useCallback(
    (
      updater: FreestyleFeedConfig | ((current: FreestyleFeedConfig) => FreestyleFeedConfig),
      options?: {
        /**
         * Rebuild without the full-screen loading state. Used by the in-feed
         * challenge–skill correction, which must not blank the card the learner is
         * reading — a visible reload would cost more attention than the drift it fixes.
         */
        silent?: boolean
        /** Keep this card under the viewport across the rebuild. */
        preferCardId?: string | null
      },
    ) => {
      const current = configRef.current
      const rawRequested = sanitizeFreestyleFeedConfig(
        typeof updater === 'function'
          ? (updater as (c: FreestyleFeedConfig) => FreestyleFeedConfig)(current)
          : updater,
      )
      const useSelectionScope = shouldUseFreestyleSelectionScope(
        current,
        rawRequested,
        entryPalaceId,
        unlockedEntryPalaceIdRef.current,
      )
      if (useSelectionScope && entryPalaceId != null) {
        unlockedEntryPalaceIdRef.current = entryPalaceId
      }
      const requested = useSelectionScope ? rawRequested : scopeEntryConfig(rawRequested)
      const stored = readFreestyleFeedConfig(slot)
      const nextToPersist = entryPalaceId == null || useSelectionScope
        ? requested
        : persistFreestyleConfigWithoutEntryLock(requested, stored)
      const saved = saveFreestyleFeedConfig(nextToPersist, slot)
      const next = useSelectionScope ? saved : scopeEntryConfig(saved)
      const scopeChanged =
        freestylePalaceScopeSignature(current) !== freestylePalaceScopeSignature(next)
      configRef.current = next
      setConfig(next)
      resetStaleRecovery()
      if (scopeChanged) {
        pendingRestudyByIdRef.current.clear()
        syncPendingRestudyIds()
        staleCardKeysRef.current.clear()
      }
      rebuildKeepingProgress(next, scopeChanged ? 'palace_scope_changed' : 'settings_save', {
        silent: options?.silent,
        preferCardId: options?.preferCardId ?? null,
      })
    },
    [entryPalaceId, rebuildKeepingProgress, resetStaleRecovery, scopeEntryConfig, slot, syncPendingRestudyIds],
  )

  const refreshQueue = useCallback(() => {
    staleCardKeysRef.current.clear()
    resetStaleRecovery()
    void buildQueue(config, { preserveCompleted: true, reason: 'manual_refresh' })
  }, [buildQueue, config, resetStaleRecovery])

  /**
   * Settlement 「再来一轮」: persist config, clear local progress (keep mute),
   * and mint the next round via startFreestyleRoundApi. Local domain mint helpers stay off-limits here.
   */
  const startNextRound = useCallback((nextConfig: FreestyleFeedConfig) => {
    const current = configRef.current
    const rawRequested = sanitizeFreestyleFeedConfig(nextConfig)
    const useSelectionScope = shouldUseFreestyleSelectionScope(
      current,
      rawRequested,
      entryPalaceId,
      unlockedEntryPalaceIdRef.current,
    )
    if (useSelectionScope && entryPalaceId != null) {
      unlockedEntryPalaceIdRef.current = entryPalaceId
    }
    const requested = useSelectionScope ? rawRequested : scopeEntryConfig(rawRequested)
    const stored = readFreestyleFeedConfig(slot)
    const nextToPersist = entryPalaceId == null || useSelectionScope
      ? requested
      : persistFreestyleConfigWithoutEntryLock(requested, stored)
    const saved = saveFreestyleFeedConfig(nextToPersist, slot)
    const next = useSelectionScope ? saved : scopeEntryConfig(saved)
    configRef.current = next
    setConfig(next)
    resetStaleRecovery()
    pendingRestudyByIdRef.current.clear()
    syncPendingRestudyIds()
    staleCardKeysRef.current.clear()
    clearQuizSessionProgress()
    const mutedPalaceIds = [...queueStateRef.current.mutedPalaceIds]
    persistQueueState({
      ...queueStateRef.current,
      palaceScopeSignature: freestylePalaceScopeSignature(next),
      completedIds: [],
      hiddenIds: [],
      deferredPalaceIds: [],
      skipCountById: {},
      lastSkippedId: null,
      lastSkippedAt: null,
      currentCardId: null,
      unitEncountersByCardId: {},
      roundPlan: null,
      mutedPalaceIds,
    })
    void buildQueue(next, {
      preserveCompleted: false,
      completedIds: [],
      hiddenIds: [],
      forceStart: true,
      reason: 'start_next_round',
    })
  }, [
    buildQueue,
    entryPalaceId,
    persistQueueState,
    resetStaleRecovery,
    scopeEntryConfig,
    slot,
    syncPendingRestudyIds,
  ])

  /** Rebuild unstarted work in this round; keep completed, excluded, and live retries. */
  const replanRemainingQueue = useCallback(() => {
    staleCardKeysRef.current.clear()
    resetStaleRecovery()
    void buildQueue(config, {
      preserveCompleted: true,
      reason: 'rebuild_round',
      replan: true,
    })
  }, [buildQueue, config, resetStaleRecovery])

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
      const roundId = queueStateRef.current.roundId
      void applyFreestyleRoundActionApi(roundId, {
        operation_id: createOperationId(),
        expected_version: serverPlanVersionRef.current,
        action: 'complete',
        card_id: cardId,
      }).then((round) => {
        if (queueStateRef.current.roundId !== roundId) return
        serverPlanVersionRef.current = serverPlanVersion(round)
        setPlanVersion(serverPlanVersion(round))
        notifyPeerRound()
      }).catch(() => {
        // Local completion remains the offline draft.
      })
    },
    [notifyPeerRound, persistQueueState],
  )

  /**
   * Unit rating outcome: update completed membership and silently rebuild
   * due projections, but keep the card under the viewport so the user can review
   * results and advance manually. Do not use for quiz — use acknowledgeCard.
   *
   * When ``restudy`` is true (忘记/困难 still on this unit), skip completedIds so
   * the round cannot end until the unit is rated 记得/轻松. Never auto-advance.
   * A source rating inserts the retry immediately (same max-gap slot) so the
   * progress rail grows before the learner leaves. Failing the retry card
   * itself waits for leave, so the card under the viewport is not moved.
   */
  const completeCard = useCallback(
    (cardId: string, options?: { restudy?: boolean; cleared?: boolean; rating?: number; retryAfterCards?: number }) => {
      const logicalCardId = sourceCardId(cardsRef.current.find((card) => card.id === cardId)) || cardId
      // Only pin when the learner is still on this card. A late settle must
      // update this card's ledger without yanking the viewport to another card.
      const settledIndex = cardsRef.current.findIndex((card) => card.id === cardId)
      const viewingSameCard = settledIndex >= 0 && currentIndexRef.current === settledIndex
      const viewportCardId = cardsRef.current[currentIndexRef.current]?.id ?? cardId
      const preferViewportId = viewingSameCard ? cardId : viewportCardId
      if (viewingSameCard) {
        applyCurrentIndex(settledIndex)
      }
      if (options?.cleared) {
        pendingRestudyByIdRef.current.delete(cardId)
        syncPendingRestudyIds()
        let plan = queueStateRef.current.roundPlan
          ? updateRoundPlanCard(queueStateRef.current.roundPlan, cardId, { status: 'pending', lastRating: null })
          : null
        if (plan && logicalCardId !== cardId) {
          plan = updateRoundPlanCard(plan, logicalCardId, { status: 'pending', lastRating: null })
        }
        const clearedCards = removeRetryOccurrencesForSource(cardsRef.current, sourceCardId(cardsRef.current.find((card) => card.id === cardId)))
        cardsRef.current = clearedCards
        setCards(clearedCards)
        const incomplete = persistQueueState({
          ...markIncomplete(markIncomplete(queueStateRef.current, logicalCardId), cardId),
          roundPlan: plan,
        })
        const roundId = queueStateRef.current.roundId
        void applyFreestyleRoundActionApi(roundId, {
          operation_id: createOperationId(),
          expected_version: serverPlanVersionRef.current,
          action: 'uncomplete',
          card_id: logicalCardId,
        }).then((round) => {
          if (queueStateRef.current.roundId !== roundId) return
          serverPlanVersionRef.current = serverPlanVersion(round)
          setPlanVersion(serverPlanVersion(round))
          const serverCompleted = Array.isArray(round.plan?.completed_ids)
            ? round.plan.completed_ids.map(String)
            : incomplete.completedIds
          persistQueueState({
            ...queueStateRef.current,
            completedIds: serverCompleted,
            roundPlan: queueStateRef.current.roundPlan
              ? syncCompletedIdsToRoundPlan(queueStateRef.current.roundPlan, serverCompleted)
              : null,
          })
          notifyPeerRound()
        }).catch(() => {
          // Local pending / incomplete remains the offline draft.
        }).finally(() => {
          if (queueStateRef.current.roundId !== roundId) return
          void buildQueue(configRef.current, {
            preserveCompleted: true,
            completedIds: queueStateRef.current.completedIds,
            silent: true,
            preferCardId: preferViewportId,
          })
        })
        return
      }
      if (options?.restudy) {
        const currentPlan = queueStateRef.current.roundPlan
        const ratedCard = cardsRef.current.find((card) => card.id === cardId)
        const repositionOnLeave = isRetryOccurrence(ratedCard)
        const attempt = nextRetryAttempt(cardsRef.current, cardId, currentPlan?.cardsById)
        const remainingOthers = Math.max(0, cardsRef.current.length - (settledIndex >= 0 ? settledIndex : 0) - 1)
        const retryAfterCards = restudyInterveningGap(
          remainingOthers,
          options.retryAfterCards ?? RESTUDY_MAX_INTERVENING,
        )
        const anchorIndex = settledIndex >= 0 ? settledIndex : currentIndexRef.current
        pendingRestudyByIdRef.current.set(cardId, {
          anchorIndex,
          attempt,
          retryAfterCards,
          rating: options.rating,
        })
        let feed = cardsRef.current
        if (!repositionOnLeave) {
          const liveAnchor = feed.findIndex((card) => card.id === cardId)
          feed = insertPendingRetryCopy(
            feed,
            cardId,
            {
              anchorIndex: liveAnchor >= 0 ? liveAnchor : anchorIndex,
              attempt,
              retryAfterCards,
              rating: options.rating,
            },
            queueStateRef.current.roundId,
            currentPlan,
          )
          if (feed !== cardsRef.current) {
            pendingRestudyByIdRef.current.delete(cardId)
            cardsRef.current = feed
            setCards(feed)
            const pinIndex = feed.findIndex((card) => card.id === preferViewportId)
            if (pinIndex >= 0) applyCurrentIndex(pinIndex, feed)
          }
        }
        syncPendingRestudyIds()
        const plan = stampRestudyPlan(
          currentPlan,
          feed,
          queueStateRef.current.roundId,
          configRef.current,
          [{ cardId, rating: options.rating, retryAfterCards, attempt }],
        )
        const incomplete = persistQueueState({
          ...markIncomplete(queueStateRef.current, logicalCardId),
          roundPlan: plan,
        })
        void buildQueue(configRef.current, {
          preserveCompleted: true,
          completedIds: incomplete.completedIds,
          silent: true,
          preferCardId: preferViewportId,
          restudyCardId: pendingRestudyByIdRef.current.has(cardId) ? cardId : undefined,
        })
        return
      }
      // Graduated: clear any pending restudy bookkeeping for this unit.
      pendingRestudyByIdRef.current.delete(cardId)
      syncPendingRestudyIds()
      const graduatedSourceId = sourceCardId(cardsRef.current.find((card) => card.id === cardId)) || cardId
      // Keep the just-rated retry under the viewport. Dropping it makes the
      // next card slide into the same index and looks like auto-advance.
      const graduatedCards = removeRetryOccurrencesForSource(cardsRef.current, graduatedSourceId, cardId)
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
        preferCardId: preferViewportId,
      })
    },
    [applyCurrentIndex, buildQueue, notifyPeerRound, persistQueueState, syncPendingRestudyIds],
  )

  const completeCardBatch = useCallback(
    (
      entries: Array<{ cardId: string; restudy?: boolean; cleared?: boolean; rating?: number; retryAfterCards?: number }>,
      preferCardId?: string,
    ) => {
      if (entries.length === 0) return
      if (entries.length === 1) {
        completeCard(entries[0].cardId, entries[0])
        return
      }
      const pinId = preferCardId || entries[0].cardId
      const settledIndex = cardsRef.current.findIndex((card) => card.id === pinId)
      if (settledIndex >= 0 && currentIndexRef.current === settledIndex) {
        applyCurrentIndex(settledIndex)
      }
      let nextCards = cardsRef.current
      let nextState = queueStateRef.current
      let plan = nextState.roundPlan
      const restudyStamps: Array<{ cardId: string; rating?: number; retryAfterCards: number; attempt: number }> = []
      for (const options of entries) {
        const cardId = options.cardId
        const logicalCardId = sourceCardId(nextCards.find((card) => card.id === cardId)) || cardId
        if (options.cleared) {
          pendingRestudyByIdRef.current.delete(cardId)
          if (plan) {
            plan = updateRoundPlanCard(plan, cardId, { status: 'pending', lastRating: null })
            if (logicalCardId !== cardId) {
              plan = updateRoundPlanCard(plan, logicalCardId, { status: 'pending', lastRating: null })
            }
          }
          nextCards = removeRetryOccurrencesForSource(
            nextCards,
            sourceCardId(nextCards.find((card) => card.id === cardId)),
          )
          nextState = markIncomplete(markIncomplete(nextState, logicalCardId), cardId)
          continue
        }
        if (options.restudy) {
          const ratedCard = nextCards.find((card) => card.id === cardId)
          const repositionOnLeave = isRetryOccurrence(ratedCard)
          const cardIndex = nextCards.findIndex((card) => card.id === cardId)
          const attempt = nextRetryAttempt(nextCards, cardId, plan?.cardsById)
          const remainingOthers = Math.max(
            0,
            nextCards.length - (cardIndex >= 0 ? cardIndex : settledIndex >= 0 ? settledIndex : 0) - 1,
          )
          const retryAfterCards = restudyInterveningGap(
            remainingOthers,
            options.retryAfterCards ?? RESTUDY_MAX_INTERVENING,
          )
          const anchorIndex = cardIndex >= 0 ? cardIndex : settledIndex >= 0 ? settledIndex : currentIndexRef.current
          pendingRestudyByIdRef.current.set(cardId, {
            anchorIndex,
            attempt,
            retryAfterCards,
            rating: options.rating,
          })
          if (!repositionOnLeave) {
            const inserted = insertPendingRetryCopy(
              nextCards,
              cardId,
              { anchorIndex, attempt, retryAfterCards, rating: options.rating },
              queueStateRef.current.roundId,
              plan,
            )
            if (inserted !== nextCards) {
              nextCards = inserted
              pendingRestudyByIdRef.current.delete(cardId)
            }
          }
          restudyStamps.push({ cardId, rating: options.rating, retryAfterCards, attempt })
          nextState = markIncomplete(nextState, logicalCardId)
          continue
        }
        pendingRestudyByIdRef.current.delete(cardId)
        nextCards = removeRetryOccurrencesForSource(nextCards, logicalCardId, cardId)
        if (plan) {
          plan = updateRoundPlanCard(plan, cardId, {
            status: 'completed',
            lastRating: options.rating ?? plan.cardsById[cardId]?.lastRating ?? null,
            retryAfterCards: 0,
            attemptCount: (plan.cardsById[cardId]?.attemptCount ?? 0) + 1,
          })
          if (logicalCardId !== cardId) {
            plan = updateRoundPlanCard(plan, logicalCardId, {
              status: 'completed',
              lastRating: options.rating ?? plan.cardsById[logicalCardId]?.lastRating ?? null,
              retryAfterCards: 0,
              attemptCount: (plan.cardsById[logicalCardId]?.attemptCount ?? 0) + 1,
            })
          }
        }
        nextState = markCompleted(markCompleted(nextState, logicalCardId), cardId)
      }
      syncPendingRestudyIds()
      if (restudyStamps.length > 0) {
        plan = stampRestudyPlan(
          plan,
          nextCards,
          queueStateRef.current.roundId,
          configRef.current,
          restudyStamps,
        )
      }
      if (nextCards !== cardsRef.current) {
        cardsRef.current = nextCards
        setCards(nextCards)
        const pinIndex = nextCards.findIndex((card) => card.id === pinId)
        if (pinIndex >= 0) applyCurrentIndex(pinIndex, nextCards)
      }
      persistQueueState({ ...nextState, roundPlan: plan })
      const clearedLogicalIds = [...new Set(
        entries
          .filter((entry) => entry.cleared)
          .map((entry) => sourceCardId(nextCards.find((card) => card.id === entry.cardId)) || entry.cardId),
      )]
      const rebuild = () => {
        void buildQueue(configRef.current, {
          preserveCompleted: true,
          completedIds: queueStateRef.current.completedIds,
          silent: true,
          preferCardId: pinId,
        })
      }
      if (clearedLogicalIds.length === 0) {
        rebuild()
        return
      }
      const roundId = queueStateRef.current.roundId
      void (async () => {
        for (const cardId of clearedLogicalIds) {
          if (queueStateRef.current.roundId !== roundId) return
          try {
            const round = await applyFreestyleRoundActionApi(roundId, {
              operation_id: createOperationId(),
              expected_version: serverPlanVersionRef.current,
              action: 'uncomplete',
              card_id: cardId,
            })
            serverPlanVersionRef.current = serverPlanVersion(round)
            setPlanVersion(serverPlanVersion(round))
            const serverCompleted = Array.isArray(round.plan?.completed_ids)
              ? round.plan.completed_ids.map(String)
              : queueStateRef.current.completedIds
            persistQueueState({
              ...queueStateRef.current,
              completedIds: serverCompleted,
              roundPlan: queueStateRef.current.roundPlan
                ? syncCompletedIdsToRoundPlan(queueStateRef.current.roundPlan, serverCompleted)
                : null,
            })
            notifyPeerRound()
          } catch {
            // Local pending / incomplete remains the offline draft.
          }
        }
        if (queueStateRef.current.roundId !== roundId) return
        rebuild()
      })()
    },
    [applyCurrentIndex, buildQueue, completeCard, notifyPeerRound, persistQueueState, syncPendingRestudyIds],
  )

  /**
   * Apply pending max-gap restudy placement for units the learner just left.
   * Safe to call on every index change; no-ops when nothing is pending or when
   * the weak unit is still under the viewport.
   */
  const applyPendingRestudyPlacement = useCallback((leavingCardId: string | null | undefined) => {
    const leftId = leavingCardId ? String(leavingCardId).trim() : ''
    if (!leftId || !pendingRestudyByIdRef.current.has(leftId)) return
    const pending = pendingRestudyByIdRef.current.get(leftId)
    pendingRestudyByIdRef.current.delete(leftId)
    syncPendingRestudyIds()
    const roundId = queueStateRef.current.roundId

    // Insert before the caller changes index so 下一张 can target the other card by id.
    // Do not pin here: goToIndex still owns the destination, and pinning the
    // leaving card is what yanked 下一张 back after 困难/忘记.
    const optimistic = insertPendingRetryCopy(
      cardsRef.current,
      leftId,
      pending,
      roundId,
      queueStateRef.current.roundPlan,
    )
    if (optimistic !== cardsRef.current) {
      cardsRef.current = optimistic
      setCards(optimistic)
      if (pending) {
        // A bumped 重练 attempt is a blank glance: drop the previous score so
        // 完成 can seek it again and the rail shows it unscored.
        const leftCard = cardsRef.current.find((card) => card.id === leftId)
        const isRetryLeave = isRetryOccurrence(leftCard)
        const clearId = isRetryLeave
          ? (optimistic.find((card) => isRetryOccurrence(card) && sourceCardId(card) === sourceCardId(leftCard))?.id ?? leftId)
          : leftId
        let plan = stampRestudyPlan(
          queueStateRef.current.roundPlan,
          optimistic,
          roundId,
          configRef.current,
          [{
            cardId: leftId,
            rating: pending.rating,
            retryAfterCards: pending.retryAfterCards,
            attempt: pending.attempt,
          }],
        )
        if (isRetryLeave && plan?.cardsById[clearId]) {
          plan = updateRoundPlanCard(plan, clearId, { lastRating: null })
          persistQueueState({
            ...queueStateRef.current,
            roundPlan: plan,
            unitEncountersByCardId: {
              ...queueStateRef.current.unitEncountersByCardId,
              [clearId]: {
                encounterId: createOperationId(),
                roundId,
                unitRevision: queueStateRef.current.unitEncountersByCardId[clearId]?.unitRevision ?? 0,
                status: 'pending',
                sessionId: null,
                selectedRating: null,
                passed: null,
                retryAfterCards: pending.retryAfterCards,
              },
            },
          })
        } else {
          persistQueueState({ ...queueStateRef.current, roundPlan: plan })
        }
      }
    }

    void applyFreestyleRoundActionApi(roundId, {
      operation_id: createOperationId(),
      expected_version: serverPlanVersionRef.current,
      action: 'leave_card',
      card_id: leftId,
    }).then((round) => {
      if (queueStateRef.current.roundId !== roundId) return
      if (round.conflict) return
      serverPlanVersionRef.current = serverPlanVersion(round)
      setPlanVersion(serverPlanVersion(round))
      notifyPeerRound()
      const confirmed = cardsForServerPlan(
        cardsRef.current,
        round.plan,
        round.round_id || roundId,
      )
      const liveId = resolveLeaveConfirmViewportId({
        leavingCardId: leftId,
        liveCardId: cardsRef.current[currentIndexRef.current]?.id ?? null,
      })
      if (confirmed !== cardsRef.current) {
        cardsRef.current = confirmed
        setCards(confirmed)
      }
      if (!liveId || liveId === leftId) return
      const resolved = confirmed.findIndex((card) => card.id === liveId)
      if (resolved >= 0) applyCurrentIndex(resolved, confirmed)
    }).catch(() => {
      const fallback = insertPendingRetryCopy(
        cardsRef.current,
        leftId,
        pending,
        roundId,
        queueStateRef.current.roundPlan,
      )
      if (fallback !== cardsRef.current) {
        cardsRef.current = fallback
        setCards(fallback)
      }
    })
  }, [applyCurrentIndex, notifyPeerRound, persistQueueState, syncPendingRestudyIds])
  applyPendingRestudyPlacementRef.current = applyPendingRestudyPlacement

  /**
   * Drop a card whose formal due vanished between queue build and open.
   * Does **not** mark completed — still-due units must remain eligible after rebuild.
   * Clears local encounter state so a renewed card does not reuse a bad encounter_id.
   *
   * After a few consecutive drops the circuit opens: the current card stays on
   * screen and the caller should show recovery instead of jumping.
   */
  const dropStaleCard = useCallback(
    (cardId: string, options?: { force?: boolean }): StaleDropResult => {
      const { circuit, decision } = decideStaleDrop(
        staleCircuitRef.current,
        Date.now(),
        options,
      )
      syncStaleCircuit(circuit)
      if (decision.action === 'hold') {
        staleRebuildPreferCardIdRef.current = cardId
        setStaleRecoveryCardId(cardId)
        return { ...decision, dropped: false }
      }

      const previous = cardsRef.current
      const staleCard = previous.find((card) => card.id === cardId)
      const staleKey = makeStaleCardKey(
        queueStateRef.current.roundId,
        cardId,
        staleCard ? cardRevisionOf(staleCard) : 'unknown',
      )
      staleCardKeysRef.current.add(staleKey)
      const index = previous.findIndex((card) => card.id === cardId)
      const filtered = previous.filter((card) => card.id !== cardId)
      const preferCardId =
        index >= 0
          ? (filtered[Math.min(index, Math.max(0, filtered.length - 1))]?.id ?? null)
          : (filtered[currentIndexRef.current]?.id ?? filtered[0]?.id ?? null)
      // Stale encounter_id / unit revision must not survive rebuild — next ensure mints fresh.
      const stalePlan = queueStateRef.current.roundPlan
        ? createRoundPlan(
            queueStateRef.current.roundPlan.roundId,
            filtered,
            configRef.current,
            undefined,
            queueStateRef.current.roundPlan,
          )
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
      scheduleStaleRebuild(preferCardId)
      return { ...decision, dropped: true }
    },
    [applyCurrentIndex, persistQueueState, scheduleStaleRebuild, syncStaleCircuit],
  )

  const adoptLiveUnitRevision = useCallback(
    (cardId: string, unitId: string, revision: number) => {
      const previous = cardsRef.current
      const nextCards = previous.map((card) => {
        if (card.type !== 'mindmap_branch') return card
        if (card.id !== cardId && card.unit_id !== unitId) return card
        if (card.unit_revision === revision) return card
        return { ...card, unit_revision: revision }
      })
      cardsRef.current = nextCards
      setCards(nextCards)
      scheduleStaleRebuild(cardId)
    },
    [scheduleStaleRebuild],
  )

  const skipCurrent = useCallback(() => {
    const card = cardsRef.current[currentIndexRef.current]
    if (!card) return
    // Weak-rated units: max-gap re-insert only (do not also shove to full tail).
    const wasRestudy = pendingRestudyByIdRef.current.has(card.id)
    const { state, action } = applySkip(queueStateRef.current, card.id)
    persistQueueState(state)
    if (action === 'hide') {
      // Hidden: drop restudy pending so a reshuffle/rebuild can surface it again.
      pendingRestudyByIdRef.current.delete(card.id)
      syncPendingRestudyIds()
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
      applyPendingRestudyPlacement(card.id)
      persistCurrentCardId(cardsRef.current[currentIndexRef.current]?.id)
      return
    }
    const nextCards = moveCardToTail(cardsRef.current, card.id)
    cardsRef.current = nextCards
    setCards(nextCards)
    // Stay at same index so next item slides into place after tail move.
    persistCurrentCardId(nextCards[currentIndexRef.current]?.id)
  }, [applyCurrentIndex, applyPendingRestudyPlacement, persistCurrentCardId, persistQueueState, syncPendingRestudyIds])

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
    const roundId = nextState.roundId
    void (async () => {
      for (const cardId of ids) {
        const round = await applyFreestyleRoundActionApi(roundId, {
          operation_id: createOperationId(),
          expected_version: serverPlanVersionRef.current,
          action: 'exclude',
          card_id: cardId,
        })
        if (queueStateRef.current.roundId !== roundId) return
        serverPlanVersionRef.current = serverPlanVersion(round)
        setPlanVersion(serverPlanVersion(round))
      }
      notifyPeerRound()
    })().catch(() => {
      // Local exclude remains the offline draft.
    })
    void buildQueue(configRef.current, {
      preserveCompleted: true,
      hiddenIds: nextState.hiddenIds,
      completedIds: nextState.completedIds,
      silent: true,
      preferCardId: filtered[currentIndexRef.current]?.id ?? null,
      reason: 'plan_exclude',
    })
  }, [applyCurrentIndex, buildQueue, notifyPeerRound, persistQueueState])

  const restorePlanCards = useCallback((cardIds: string[]) => {
    const ids = cardIds.map((id) => String(id || '').trim()).filter(Boolean)
    if (!ids.length) return
    let nextPlan: FreestyleRoundPlanState | null = queueStateRef.current.roundPlan
    ids.forEach((id) => {
      if (nextPlan) nextPlan = updateRoundPlanCard(nextPlan, id, { status: 'pending' })
    })
    const nextState = restoreCards({ ...queueStateRef.current, roundPlan: nextPlan }, ids)
    persistQueueState(nextState)
    const roundId = nextState.roundId
    void (async () => {
      for (const cardId of ids) {
        const round = await applyFreestyleRoundActionApi(roundId, {
          operation_id: createOperationId(),
          expected_version: serverPlanVersionRef.current,
          action: 'restore',
          card_id: cardId,
        })
        if (queueStateRef.current.roundId !== roundId) return
        serverPlanVersionRef.current = serverPlanVersion(round)
        setPlanVersion(serverPlanVersion(round))
      }
      notifyPeerRound()
    })().catch(() => {
      // Local restore remains the offline draft.
    })
    void buildQueue(configRef.current, {
      preserveCompleted: true,
      hiddenIds: nextState.hiddenIds,
      completedIds: nextState.completedIds,
      reason: 'plan_restore',
    })
  }, [buildQueue, notifyPeerRound, persistQueueState])

  const goToIndex = useCallback(
    (index: number, options?: { reorderRestudy?: boolean }) => {
      const previous = cardsRef.current
      const previousIndex = currentIndexRef.current
      const leaving = previous[previousIndex]
      const requested = Math.max(0, Math.round(Number(index) || 0))
      const reorderRestudy = options?.reorderRestudy !== false
      const advancing = requested > previousIndex
      // Capture destination by id before restudy reorders the feed. Past the
      // old end (gap-0 pending on the last card) has no target id yet.
      const targetId =
        requested < previous.length ? (previous[requested]?.id ?? null) : null
      // Finger/wheel scroll must NOT reorder under the gesture — that shifts
      // indices while scrollTop stays put and makes swipe-back show the wrong card.
      // Button/keyboard paths may reorder immediately; scroll defers via flush.
      if (reorderRestudy && advancing && leaving) {
        applyPendingRestudyPlacement(leaving.id)
      }
      const list = cardsRef.current
      const max = Math.max(0, list.length - 1)
      let nextIndex: number
      if (targetId) {
        const resolved = list.findIndex((card) => card.id === targetId)
        nextIndex =
          resolved >= 0 ? resolved : Math.max(0, Math.min(requested, max))
      } else if (advancing && leaving && list.length > previous.length) {
        // Gap-0 leave/insert grew the feed: land on the card after the source.
        const sourcePos = list.findIndex((card) => card.id === leaving.id)
        nextIndex = sourcePos >= 0
          ? Math.min(sourcePos + 1, max)
          : Math.min(requested, max)
      } else {
        nextIndex = Math.min(requested, max)
      }
      const applied = applyCurrentIndex(nextIndex, list)
      // Looking back at completed history must not move the committed cursor.
      if (advancing || !queueStateRef.current.completedIds.includes(list[applied]?.id || '')) {
        commitRoundCursor(list[applied]?.id)
      }
      return applied
    },
    [applyCurrentIndex, applyPendingRestudyPlacement, commitRoundCursor],
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
        const applied = applyCurrentIndex(resolved, cardsRef.current)
        const settledId = cardsRef.current[applied]?.id
        if (settledId && !queueStateRef.current.completedIds.includes(settledId)) {
          commitRoundCursor(settledId)
        }
        return applied
      }
    }
    return currentIndexRef.current
  }, [applyCurrentIndex, applyPendingRestudyPlacement, commitRoundCursor])

  /**
   * Settlement choice: drop overlay 做题 for every review palace this configured
   * round scheduled. A single palace finishing its ratings must not ask.
   */
  const clearConfiguredOverlayQuiz = useCallback(async () => {
    const roundId = queueStateRef.current.roundId
    const palaceIds = overlayReviewPalaceIds(queueStateRef.current.roundPlan)
    if (!roundId || palaceIds.length === 0) {
      throw new Error('这次随心配置里没有可清除做题进度的宫殿。')
    }
    const palaceSet = new Set(palaceIds)
    let questionIds: number[] = []
    try {
      const current = await getFreestyleRoundApi(roundId)
      const map = current.plan?.overlay_quiz?.question_palace_ids || {}
      questionIds = Object.entries(map)
        .filter(([, palaceId]) => palaceSet.has(Number(palaceId)))
        .map(([questionId]) => Number(questionId))
        .filter((id) => Number.isInteger(id) && id > 0)
    } catch {
      questionIds = []
    }
    const drop = (expectedVersion: number) => dropFreestyleOverlayQuizPalacesApi(roundId, {
      operation_id: createOperationId(),
      expected_version: expectedVersion,
      palace_ids: palaceIds,
    })
    let dropped = await drop(serverPlanVersionRef.current)
    if (dropped.conflict) {
      const retryVersion = serverPlanVersion(dropped)
      if (retryVersion > 0) serverPlanVersionRef.current = retryVersion
      dropped = await drop(retryVersion)
    }
    if (dropped.conflict) {
      throw new Error('清除做题进度失败，请再试一次。')
    }
    if (questionIds.length > 0) removeQuizSessionQuestions(questionIds)
    clearQuizSessionProgressForPalaces(palaceIds)
    const version = serverPlanVersion(dropped)
    if (version > 0) {
      serverPlanVersionRef.current = version
      setPlanVersion(version)
    }
  }, [])

  const adoptRoundVersion = useCallback((round: {
    plan_version?: number
    version?: number
    round_id?: string
    plan?: FreestyleRoundStatePayload['plan']
  } | null | undefined) => {
    const version = serverPlanVersion(round)
    if (version > 0) {
      serverPlanVersionRef.current = version
      setPlanVersion(version)
    }
  }, [])

  const reshuffleQueueWithRestudyClear = useCallback(() => {
    pendingRestudyByIdRef.current.clear()
    syncPendingRestudyIds()
    replanRemainingQueue()
  }, [replanRemainingQueue, syncPendingRestudyIds])

  const hydrateFromServerRound = useCallback(async (advanceIfCompleted: boolean) => {
    const roundId = queueStateRef.current.roundId
    try {
      let round = roundId ? await getFreestyleRoundApi(roundId).catch(() => null) : null
      if (!round?.plan && hasLoadedClientPreferences()) {
        round = await getOrCreateFreestyleRoundApi({
          operation_id: createOperationId(),
          scope_key: freestylePalaceScopeSignature(configRef.current),
          config: configRef.current,
          cards: cardsRef.current,
          round_id: roundId,
          workspace: slot,
        })
      }
      if (!round?.plan) return
      const adoptedRoundId = round.round_id || roundId
      serverPlanVersionRef.current = serverPlanVersion(round)
      setPlanVersion(serverPlanVersion(round))
      const nextCards = cardsForServerPlan(cardsRef.current, round.plan, adoptedRoundId)
      const serverCompleted = Array.isArray(round.plan.completed_ids)
        ? round.plan.completed_ids.map(String)
        : queueStateRef.current.completedIds
      const serverHidden = Array.isArray(round.plan.excluded_ids)
        ? round.plan.excluded_ids.map(String)
        : queueStateRef.current.hiddenIds
      persistQueueState({
        ...queueStateRef.current,
        roundId: adoptedRoundId,
        completedIds: serverCompleted,
        hiddenIds: serverHidden,
        unitEncountersByCardId: mergeServerPlanIntoLocalEncounters(
          queueStateRef.current.unitEncountersByCardId,
          round.plan,
          adoptedRoundId,
        ),
        roundPlan: applyServerRatingsToRoundPlan(
          applyServerCohorts(
            syncCompletedIdsToRoundPlan(
              createRoundPlan(
                adoptedRoundId,
                nextCards,
                configRef.current,
                {
                  candidate_count: nextCards.length,
                  scheduled_count: nextCards.length,
                  queue_limit: configRef.current.queue_length,
                  limit_reached: false,
                  palace_leftover_due: {},
                },
                queueStateRef.current.roundPlan,
              ),
              serverCompleted,
            ),
            round.plan,
          ),
          round.plan,
        ),
      })
      const feedWasEmpty = cardsRef.current.length === 0
      cardsRef.current = nextCards
      setCards(nextCards)
      const currentId = nextCards[currentIndexRef.current]?.id
      const handled = new Set([...serverCompleted, ...serverHidden])
      if (feedWasEmpty && nextCards.length > 0) {
        setLoading(false)
        const prefer = String(
          queueStateRef.current.currentCardId
          || round.plan.current_card_id
          || round.current_card_id
          || '',
        ).trim()
        const restored = prefer ? nextCards.findIndex((card) => card.id === prefer) : -1
        if (restored >= 0) applyCurrentIndex(restored, nextCards)
      } else if (advanceIfCompleted && currentId && handled.has(currentId)) {
        const nextId = nextUnfinishedCardId(round.plan, nextCards)
        const idx = nextId ? nextCards.findIndex((card) => card.id === nextId) : -1
        if (idx >= 0) applyCurrentIndex(idx, nextCards)
      }
    } catch {
      // Offline: keep the local draft.
    }
  }, [applyCurrentIndex, persistQueueState, slot])

  useEffect(() => {
    let cancelled = false
    let didLoad = false
    const runInitialLoad = (reason: string) => {
      if (cancelled || didLoad) return
      didLoad = true
      const next = scopeEntryConfig(readFreestyleFeedConfig(slot))
      if (!sameFeedConfig(next, configRef.current)) {
        configRef.current = next
        setConfig(next)
      }
      void (async () => {
        const roundId = queueStateRef.current.roundId
        let painted = false
        if (roundId) {
          await hydrateFromServerRound(true)
          if (cancelled) return
          painted = cardsRef.current.length > 0
          if (painted) setLoading(false)
        }
        if (cancelled) return
        await buildQueue(configRef.current, {
          preserveCompleted: true,
          reason,
          silent: painted,
          preferCardId: painted ? queueStateRef.current.currentCardId : null,
          studyWindow: !painted && !roundId,
        })
      })()
    }
    if (hasLoadedClientPreferences()) {
      runInitialLoad('initial_load')
      return () => {
        cancelled = true
      }
    }
    const offPrefs = onAppEvent(CLIENT_PREFERENCES_UPDATED_EVENT, () => {
      runInitialLoad('initial_load')
    })
    const timeout = window.setTimeout(() => runInitialLoad('initial_load_timeout'), 1_500)
    return () => {
      cancelled = true
      offPrefs()
      window.clearTimeout(timeout)
    }
    // Initial load only; subsequent rebuilds are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return onAppEvent(FREESTYLE_PEER_ROUND_EVENT, (detail: FreestylePeerRoundDetail) => {
      if (!detail || detail.workspace === slot) return
      void hydrateFromServerRound(false)
    })
  }, [hydrateFromServerRound, slot])

  const workspacePath = freestyleWorkspacePath(slot)
  const isActiveRoute =
    location.pathname === workspacePath || location.pathname.startsWith(`${workspacePath}/`)
  const skipInitialRouteHydrateRef = useRef(true)
  useEffect(() => {
    if (!isActiveRoute) return
    // The initial load awaits hydrate itself. A parallel route hydrate can
    // finish later and paint the pre-drop 315-card plan over the rebuilt queue.
    if (skipInitialRouteHydrateRef.current) {
      skipInitialRouteHydrateRef.current = false
      return
    }
    void hydrateFromServerRound(true)
  }, [hydrateFromServerRound, isActiveRoute])

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
    startNextRound,
    reshuffleQueue: reshuffleQueueWithRestudyClear,
    completeCard,
    completeCardBatch,
    ensureUnitEncounter,
    updateUnitEncounter,
    acknowledgeCard,
    dropStaleCard,
    adoptLiveUnitRevision,
    staleCircuitOpen,
    staleRecoveryCardId,
    resetStaleRecovery,
    skipCurrent,
    undoLastSkip,
    muteCurrentPalace,
    reorderPlan,
    excludePlanCards,
    restorePlanCards,
    buildQueue,
    pendingRestudyCardIds,
    planVersion,
    adoptRoundVersion,
    clearConfiguredOverlayQuiz,
    queueFrozen,
  }
}
