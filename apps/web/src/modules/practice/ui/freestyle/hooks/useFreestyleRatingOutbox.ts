import { useCallback, useRef } from 'react'
import type {
  FreestyleUnitEncounterState,
  UnitRating,
} from '@/modules/practice/public'
import type { FreestyleCard, FreestyleRoundStatePayload } from '@/shared/api/contracts'
import { isMindMapBranchCard } from '@/modules/practice/ui/freestyle/model/freestyle-cards'
import {
  freestyleRatingSaves,
  prepareRatingTarget,
} from '@/modules/practice/ui/freestyle/model/ratingSaveRuntime'
import type { RatingTarget } from '@/modules/practice/ui/freestyle/model/ratingSaveStore'
import type { RatingLedgerHandlers } from '@/modules/practice/ui/freestyle/model/ratingSaveLedger'
import {
  useRatingSaveFailedCount,
  useRatingSaveLedger,
} from '@/modules/practice/ui/freestyle/hooks/useFreestyleRatingSaves'
import { isPermanentUnitAbsence } from '@/modules/practice/ui/freestyle/model/freestyleStaleRecovery'
import { recordSessionRecorderUiAction } from '@/shared/debug/session-recorder'

export const RATING_NOT_SAVED_COPY = '这一次没有保存成功'

export interface BackgroundRatingResult {
  /** Sent to the outbox (保存中 until acknowledged). */
  queued: number
  /** Already acknowledged at this grade: nothing to send. */
  unchanged: number
  /** Not a rateable review-unit card (quiz, removed from this round, gone). */
  skipped: number
}

/**
 * Page-level owner of the rating outbox:
 * - applies every acknowledgement to the round ledger (single owner, card mounted or not);
 * - rates cards from 本轮安排 without moving the feed;
 * - exposes the 未保存 count for the HUD.
 */
export function useFreestyleRatingOutbox(input: {
  roundId: string
  cards: FreestyleCard[]
  encounters: Record<string, FreestyleUnitEncounterState>
  excludedIds: ReadonlySet<string>
  planVersion: number
  viewingCardId: string | null
  ensureUnitEncounter: (cardId: string, unitRevision: number, allowRenew: boolean) => FreestyleUnitEncounterState
  adoptRound: (round: FreestyleRoundStatePayload) => void
  encounterChange: (cardId: string, encounter: FreestyleUnitEncounterState) => void
  branchComplete: RatingLedgerHandlers['branchComplete']
  ratingSettled: NonNullable<RatingLedgerHandlers['ratingSettled']>
  cardSaveFailed: (message: string, cardId: string) => void
  staleDrop: (cardId: string, options?: { force?: boolean }) => void
}) {
  const latest = useRef(input)
  latest.current = input
  // Encounters written by this ledger before the next render reaches it.
  const writtenRef = useRef(new Map<string, FreestyleUnitEncounterState>())
  const seenEncountersRef = useRef(input.encounters)
  if (seenEncountersRef.current !== input.encounters) {
    seenEncountersRef.current = input.encounters
    writtenRef.current.clear()
  }

  useRatingSaveLedger({
    roundId: input.roundId,
    previousEncounter: (cardId) => writtenRef.current.get(cardId) ?? latest.current.encounters[cardId],
    adoptRound: (round) => latest.current.adoptRound(round),
    encounterChange: (cardId, encounter) => {
      writtenRef.current.set(cardId, encounter)
      latest.current.encounterChange(cardId, encounter)
    },
    branchComplete: (cardId, options) => latest.current.branchComplete(cardId, options),
    ratingSettled: (cardId, passed, rating, meta) => latest.current.ratingSettled(cardId, passed, rating, meta),
    saveFailed: (event) => {
      if (event.type === 'undoFailed') {
        latest.current.cardSaveFailed('取消评分没有成功，请再点一次。', event.cardId)
        return
      }
      const detail = event.error instanceof Error ? event.error.message : String(event.error ?? '')
      recordSessionRecorderUiAction(
        'error',
        '评分没有保存',
        `卡片：${event.cardId} · 回合：${event.roundId} · 操作 ID：${event.job.operationId} · ${event.failure} · ${detail}`,
      )
      latest.current.cardSaveFailed(RATING_NOT_SAVED_COPY, event.cardId)
    },
    staleDrop: (cardId, error) => {
      latest.current.staleDrop(cardId, isPermanentUnitAbsence(error) ? { force: true } : undefined)
    },
  })

  const failedCount = useRatingSaveFailedCount(input.roundId)

  /**
   * Rate cards in the background, each through the same per-card path a tap on
   * the card uses. The feed does not move. A card without an open glance gets
   * one first (the card's own unit-session start), then the rating.
   */
  const rateCards = useCallback((
    cardIds: readonly string[],
    rating: UnitRating,
    options: { toggle?: boolean } = {},
  ): BackgroundRatingResult => {
    const current = latest.current
    const store = freestyleRatingSaves()
    const result: BackgroundRatingResult = { queued: 0, unchanged: 0, skipped: 0 }
    const roundId = current.roundId
    for (const cardId of new Set(cardIds)) {
      const card = current.cards.find((item) => item.id === cardId)
      if (
        !roundId
        || !card
        || !isMindMapBranchCard(card)
        || !card.unit_id
        || card.unit_revision == null
        || current.excludedIds.has(cardId)
      ) {
        result.skipped += 1
        continue
      }
      const entry = store.getEntry(roundId, cardId)
      const acknowledged = entry?.status === 'saved' && entry.ackedRating === rating
      if (acknowledged) {
        // A single row tap on the lit grade clears it, like the card's own bar.
        if (options.toggle && store.requestUndo({ roundId, cardId, clearAll: true })) {
          result.queued += 1
        } else {
          result.unchanged += 1
        }
        continue
      }
      const encounter = current.ensureUnitEncounter(card.id, card.unit_revision, true)
      const target: RatingTarget | null = encounter.status === 'open' && encounter.sessionId
        ? {
            encounterId: encounter.encounterId,
            unitId: card.unit_id,
            sessionId: encounter.sessionId,
            unitRevision: encounter.unitRevision,
          }
        : null
      store.submit({
        roundId,
        cardId,
        occurrenceId: card.occurrence_kind === 'retry' ? card.id : '',
        rating,
        planVersion: current.planVersion,
        target,
        prepare: target ? null : () => prepareRatingTarget(card, encounter, roundId),
        // Only the card under the viewport keeps its glance open; it closes on leave.
        closeAfterAck: cardId !== current.viewingCardId,
      })
      result.queued += 1
    }
    return result
  }, [])

  const retryUnsaved = useCallback(() => freestyleRatingSaves().retryFailed(latest.current.roundId), [])

  return { rateCards, failedCount, retryUnsaved }
}
