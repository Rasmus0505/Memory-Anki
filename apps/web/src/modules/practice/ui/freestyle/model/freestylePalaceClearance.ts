import {
  cardPalaceId,
  isRetryOccurrence,
  sourceCardId,
  type FreestyleRoundPlanState,
  type FreestyleUnitEncounterState,
} from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'

export interface PalaceClearance {
  palaceId: number
  palaceTitle: string
  leftoverDue: number
}

function sourceIdOf(card: FreestyleCard) {
  return sourceCardId(card) || card.id
}

function encounterPassed(encounter: FreestyleUnitEncounterState | undefined) {
  const rating = Number(encounter?.selectedRating)
  return encounter?.passed === true || (encounter?.passed == null && rating >= 3)
}

function isReviewUnitCard(card: FreestyleCard): boolean {
  return card.type === 'mindmap_branch' && Boolean(card.unit_id)
}

function isHandled(
  card: FreestyleCard,
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completedIds: ReadonlySet<string>,
  passedSources: ReadonlySet<string>,
) {
  const sourceId = sourceIdOf(card)
  if (completedIds.has(card.id) || completedIds.has(sourceId)) return true
  // `selectedRating` only means the learner attempted this unit. Failed
  // ratings remain pending until their retry occurrence passes.
  if (encounterPassed(encountersByCardId[card.id])) return true
  if (encountersByCardId[card.id]?.selectedRating != null) {
    return passedSources.has(sourceIdOf(card))
  }
  return completedIds.has(card.id) || completedIds.has(sourceId)
}

/**
 * True when this palace's review units in the current round are all handled.
 * Pending restudy (忘记/困难 not yet re-inserted) still counts as unfinished.
 * Excluded / hidden unrated units mean the learner did not finish the palace.
 * Quiz cards are not part of a palace's today schedule.
 */
export function isPalaceRoundCleared(input: {
  cards: FreestyleCard[]
  palaceId: number
  plan: FreestyleRoundPlanState | null
  encountersByCardId: Record<string, FreestyleUnitEncounterState>
  completedIds?: Iterable<string>
  pendingRestudyIds?: Iterable<string>
  hiddenIds?: Iterable<string>
}): boolean {
  const palaceId = input.palaceId
  const completed = new Set(Array.from(input.completedIds ?? [], String))
  const pendingRestudy = new Set(Array.from(input.pendingRestudyIds ?? [], String))
  const hidden = new Set(Array.from(input.hiddenIds ?? [], String))
  const units = input.cards.filter(
    (card) => isReviewUnitCard(card) && cardPalaceId(card) === palaceId,
  )
  if (units.length === 0) return false
  const passedSources = new Set(
    units
      .filter((card) => encounterPassed(input.encountersByCardId[card.id]))
      .map(sourceIdOf),
  )

  for (const card of units) {
    const sourceId = sourceIdOf(card)
    if (pendingRestudy.has(card.id) || pendingRestudy.has(sourceId)) return false
    if (!isHandled(card, input.encountersByCardId, completed, passedSources)) return false
  }

  const planCards = input.plan?.cardsById ?? {}
  for (const entry of Object.values(planCards)) {
    if (entry.palaceId !== palaceId) continue
    if (entry.kind !== 'mindmap_branch') continue
    if (entry.status === 'excluded' || hidden.has(entry.cardId) || hidden.has(entry.sourceCardId)) {
      if (entry.status !== 'completed' && !completed.has(entry.cardId) && !completed.has(entry.sourceCardId)) {
        return false
      }
    }
  }

  return true
}

export function palaceClearanceCopy(clearance: PalaceClearance): string {
  const name = clearance.palaceTitle.trim() || `宫殿 ${clearance.palaceId}`
  if (clearance.leftoverDue > 0) {
    return `《${name}》本轮已清，今日还剩 ${clearance.leftoverDue}`
  }
  return `《${name}》今日安排已清`
}

export function leftoverDueForPalace(
  leftoverByPalace: Record<string, number> | null | undefined,
  palaceId: number,
): number {
  const raw = leftoverByPalace?.[String(palaceId)]
  const count = Math.round(Number(raw) || 0)
  return count > 0 ? count : 0
}

export function buildPalaceClearance(
  cards: FreestyleCard[],
  palaceId: number,
  leftoverDue: number,
): PalaceClearance | null {
  const sample = cards.find((card) => isReviewUnitCard(card) && cardPalaceId(card) === palaceId)
  if (!sample || sample.type !== 'mindmap_branch') return null
  const title = String(sample.palace_title || '').trim()
  return {
    palaceId,
    palaceTitle: title,
    leftoverDue: leftoverDue > 0 ? leftoverDue : 0,
  }
}

/** Source-deduped review units of one palace, including retry occurrences. */
export function palaceReviewUnitCards(cards: FreestyleCard[], palaceId: number): FreestyleCard[] {
  return cards.filter((card) => isReviewUnitCard(card) && cardPalaceId(card) === palaceId)
}

export function palaceHasPendingRetry(
  cards: FreestyleCard[],
  palaceId: number,
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completedIds?: Iterable<string>,
): boolean {
  const completed = new Set(Array.from(completedIds ?? [], String))
  return palaceReviewUnitCards(cards, palaceId).some((card) => {
    if (!isRetryOccurrence(card)) return false
    const passedSources = new Set(
      palaceReviewUnitCards(cards, palaceId)
        .filter((candidate) => encounterPassed(encountersByCardId[candidate.id]))
        .map(sourceIdOf),
    )
    return !isHandled(card, encountersByCardId, completed, passedSources)
  })
}
