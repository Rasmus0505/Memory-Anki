import {
  cardPalaceId,
  cardUnitId,
  findEarliestUnratedIndex,
  unscoredOccurrenceIndices,
  isRetryOccurrence,
  reviewUnitIdFromCardId,
  sourceCardId,
  type FreestyleRoundPlanState,
  type FreestyleUnitEncounterState,
} from '@/modules/practice/public'
import { isOccurrencePassed, isOccurrenceScored } from '@/modules/practice/domain/unitProgressState'
import type { FreestylePartialSettlementSnapshot, FreestylePartialSettlementSubject } from '@/modules/practice/domain/partialSettlement'
import type { FreestyleCard } from '@/shared/api/contracts'
import { isReviewHintId } from '@/shared/api/contracts'

export interface FreestyleRoundSubjectPalaceStat {
  palaceId: number
  palaceTitle: string
  /** Units rated this round. */
  cardCount: number
  /** Active units in the palace; the progress denominator. */
  totalUnits: number
}

export interface FreestyleRoundSubjectStat {
  subjectId: number | null
  subjectName: string
  palaceCount: number
  cardCount: number
  totalUnits: number
  palaces: FreestyleRoundSubjectPalaceStat[]
}

export interface FreestyleRoundCompletion {
  ratedCount: number
  passedCount: number
  /** Sources that were weakly rated at some point this round (already restudied). */
  retriedCount: number
  /** Kept for older callers; same as retriedCount once the round is complete. */
  retryCount: number
  /** Candidates the round limit left out (0 when the round is all due). */
  remainingCandidates: number
  /** Quiz cards handled in the feed plus overlay 做题. */
  quizCount: number
  /** Rated units that had never passed before this round. */
  newCount: number
  /** Rated units that had passed before this round. */
  reviewCount: number
  /** Distinct units the round touched, rated or not. */
  involvedUnitCount: number
  /** Active units across the involved palaces; the overall progress denominator. */
  totalUnits: number
  /** Attempted sources grouped by subject → palace for settlement. */
  bySubject: FreestyleRoundSubjectStat[]
}

function sourceIdOf(card: FreestyleCard) {
  return sourceCardId(card) || card.id
}

function encounterPassed(encounter: FreestyleUnitEncounterState | undefined) {
  const rating = Number(encounter?.selectedRating)
  return encounter?.passed === true || (encounter?.passed == null && rating >= 3)
}

function cardIsNew(card: FreestyleCard, roundPlan: FreestyleRoundPlanState | null) {
  return ('is_new' in card && card.is_new === true) || roundPlan?.cardsById[card.id]?.isNew === true
}

function resolvePalaceTitle(card: FreestyleCard, palaceId: number) {
  if ('palace_title' in card && card.palace_title) return String(card.palace_title)
  const contextTitle = card.palace_context?.title
  if (contextTitle) return String(contextTitle)
  return `宫殿 ${palaceId}`
}

function planLastRating(
  roundPlan: FreestyleRoundPlanState | null | undefined,
  cardId: string,
) {
  const value = roundPlan?.cardsById[cardId]?.lastRating
  return typeof value === 'number' && value >= 1 && value <= 4 ? value : null
}

function isHandled(
  card: FreestyleCard,
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completedIds: Iterable<string> = [],
  cards: ReadonlyArray<FreestyleCard> = [card],
  roundPlan: FreestyleRoundPlanState | null = null,
) {
  const completed = new Set(Array.from(completedIds, String))
  const sourceId = sourceIdOf(card)
  const entry = roundPlan?.cardsById[card.id] ?? roundPlan?.cardsById[sourceId]
  if (entry?.status === 'excluded') return true
  if (completed.has(card.id) || completed.has(sourceId)) return true
  if (entry?.status === 'completed') return true
  const encounter = encountersByCardId[card.id]
  const ownLast = planLastRating(roundPlan, card.id)
  const sourceLast = planLastRating(roundPlan, sourceId)
  if (encounterPassed(encounter) || (ownLast != null && ownLast >= 3) || (sourceLast != null && sourceLast >= 3)) {
    return true
  }
  // A weak or still-unrated source is not done while its 重练 is unfinished.
  // A passed retry of the same unit closes the source even when the live card
  // id no longer matches the retry's source_card_id.
  return familyHasPass(card, cards, encountersByCardId, completed, roundPlan)
}

/**
 * A round needs an ending. The feed used to simply run out after the last rate,
 * which is the least satisfying way to close a session.
 *
 * Counts are source-deduped: a failed source plus its later passed retry is one
 * unit that was restudied, not "passed 1 + still retrying 1". Remaining
 * candidates use the backend scheduled count, never the live feed length
 * (retry insertions must not shrink the leftover).
 */
export function buildFreestyleRoundCompletion(
  cards: FreestyleCard[],
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  candidateCount: number,
  options?: {
    completedIds?: Iterable<string>
    scheduledCount?: number
    quizCount?: number
    roundPlan?: FreestyleRoundPlanState | null
    subjectByPalaceId?: ReadonlyMap<number, { id: number; name: string }>
  },
): FreestyleRoundCompletion {
  const completedIds = options?.completedIds ?? []
  const scheduledCount = options?.scheduledCount ?? cards.filter((card) => !isRetryOccurrence(card)).length
  const subjectByPalaceId = options?.subjectByPalaceId
  const sources = new Map<string, {
    passed: boolean
    retried: boolean
    handled: boolean
    attempted: boolean
    isNew: boolean
    palaceId: number | null
    palaceTitle: string
    subjectId: number | null
    subjectName: string
  }>()

  const progressInput = { completedIds, encounters: encountersByCardId, roundPlan: options?.roundPlan ?? null }
  for (const card of cards) {
    if (isReviewHintId(card.id) || options?.roundPlan?.cardsById[card.id]?.status === 'excluded') continue
    const sourceId = sourceIdOf(card)
    const current = sources.get(sourceId) ?? {
      passed: false,
      retried: false,
      handled: false,
      attempted: false,
      isNew: false,
      palaceId: null,
      palaceTitle: '',
      subjectId: null,
      subjectName: '未分类',
    }
    const encounter = encountersByCardId[card.id]
    const handled = isHandled(card, encountersByCardId, completedIds, cards, options?.roundPlan)
    if (handled) current.handled = true
    if (isOccurrenceScored(card.id, progressInput)) current.attempted = true
    if (isOccurrencePassed(card.id, progressInput)) current.passed = true
    if (isRetryOccurrence(card) || encounter?.passed === false) current.retried = true
    if (cardIsNew(card, options?.roundPlan ?? null)) current.isNew = true
    // Prefer the source card for palace/subject labels; fall back to retry metadata.
    if (current.palaceId == null || !isRetryOccurrence(card)) {
      const palaceId = cardPalaceId(card)
      if (palaceId != null) {
        current.palaceId = palaceId
        current.palaceTitle = resolvePalaceTitle(card, palaceId)
        const subject = subjectByPalaceId?.get(palaceId)
        if (subject) {
          current.subjectId = subject.id
          current.subjectName = subject.name
        } else {
          current.subjectId = null
          current.subjectName = '未分类'
        }
      }
    }
    sources.set(sourceId, current)
  }

  let ratedCount = 0
  let passedCount = 0
  let retriedCount = 0
  let newCount = 0
  let reviewCount = 0
  const palaceUnitTotals = options?.roundPlan?.palaceUnitTotals ?? {}
  const subjectBuckets = new Map<string, {
    subjectId: number | null
    subjectName: string
    palaces: Map<number, { palaceId: number; palaceTitle: string; cardCount: number; involved: number }>
  }>()
  sources.forEach((entry) => {
    if (entry.attempted) {
      ratedCount += 1
      if (entry.passed) passedCount += 1
      if (entry.retried) retriedCount += 1
      if (entry.isNew) newCount += 1
      else reviewCount += 1
    }

    const palaceId = entry.palaceId ?? 0
    const palaceTitle = entry.palaceTitle || `宫殿 ${palaceId}`
    const subjectKey = entry.subjectId == null ? `name:${entry.subjectName}` : `id:${entry.subjectId}`
    let subject = subjectBuckets.get(subjectKey)
    if (!subject) {
      subject = {
        subjectId: entry.subjectId,
        subjectName: entry.subjectName,
        palaces: new Map(),
      }
      subjectBuckets.set(subjectKey, subject)
    }
    const palace = subject.palaces.get(palaceId) ?? {
      palaceId,
      palaceTitle,
      cardCount: 0,
      involved: 0,
    }
    palace.involved += 1
    if (entry.attempted) palace.cardCount += 1
    if (!palace.palaceTitle && palaceTitle) palace.palaceTitle = palaceTitle
    subject.palaces.set(palaceId, palace)
  })

  const bySubject = Array.from(subjectBuckets.values()).map((subject) => {
    const palaces: FreestyleRoundSubjectPalaceStat[] = Array.from(subject.palaces.values()).map((palace) => ({
      palaceId: palace.palaceId,
      palaceTitle: palace.palaceTitle,
      cardCount: palace.cardCount,
      totalUnits: Math.max(
        palace.involved,
        Math.round(Number(palaceUnitTotals[String(palace.palaceId)]) || 0),
      ),
    })).sort((left, right) => (
      right.cardCount - left.cardCount
      || left.palaceTitle.localeCompare(right.palaceTitle, 'zh')
    ))
    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      palaceCount: palaces.length,
      cardCount: palaces.reduce((sum, palace) => sum + palace.cardCount, 0),
      totalUnits: palaces.reduce((sum, palace) => sum + palace.totalUnits, 0),
      palaces,
    }
  }).sort((left, right) => (
    right.cardCount - left.cardCount
    || left.subjectName.localeCompare(right.subjectName, 'zh')
  ))

  return {
    ratedCount,
    passedCount,
    retriedCount,
    retryCount: retriedCount,
    remainingCandidates: Math.max(0, candidateCount - scheduledCount),
    quizCount: Math.max(0, Math.round(Number(options?.quizCount) || 0)),
    newCount,
    reviewCount,
    involvedUnitCount: sources.size,
    totalUnits: bySubject.reduce((sum, subject) => sum + subject.totalUnits, 0),
    bySubject,
  }
}

/**
 * True when every presented card has a this-round score, so the closing slot
 * can open. 忘记/困难 count: once nothing unscored remains, 完成 must enter
 * settlement instead of disabling. A blank 重练 still in the feed keeps the
 * round open. An empty feed is not a finished round.
 */
export function isFreestyleRoundComplete(
  cards: FreestyleCard[],
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completedIds: Iterable<string> = [],
  roundPlan: FreestyleRoundPlanState | null = null,
  hiddenIds: Iterable<string> = [],
): boolean {
  if (cards.length === 0) {
    // Mid-round compress can empty the feed after every remaining card passed.
    return Boolean(roundPlan?.compressedIds?.length)
  }
  return findEarliestUnratedIndex(
    cards,
    completedIds,
    encountersByCardId,
    roundPlan,
    hiddenIds,
  ) == null
}

function isPassedOccurrence(
  card: FreestyleCard,
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completed: ReadonlySet<string>,
  roundPlan: FreestyleRoundPlanState | null,
) {
  if (completed.has(card.id)) return true
  if (encounterPassed(encountersByCardId[card.id])) return true
  const last = planLastRating(roundPlan, card.id)
  return last != null && last >= 3
}

function parseRetrySourceId(occurrenceId: string) {
  const parts = String(occurrenceId || '').split(':')
  if (parts[0] !== 'retry' || parts.length < 4) return ''
  return parts.slice(2, -1).join(':')
}

function addCardKey(keys: Set<string>, raw: string) {
  const id = String(raw || '').trim()
  if (!id) return
  keys.add(`card:${id}`)
  const unit = reviewUnitIdFromCardId(id)
  if (unit) keys.add(`unit:${unit}`)
}

/**
 * Same learning unit across a rewritten review card id and its 重练.
 * `card:` and `unit:` never compare equal, so a unit id cannot match a card id.
 */
function familyKeys(
  card: FreestyleCard,
  roundPlan: FreestyleRoundPlanState | null,
) {
  const keys = new Set<string>()
  const unitId = cardUnitId(card)
  if (unitId) keys.add(`unit:${unitId}`)
  const ownId = String(card.id || '').trim()
  if (ownId && !ownId.startsWith('retry:')) addCardKey(keys, ownId)
  if ('source_card_id' in card) addCardKey(keys, String(card.source_card_id || ''))
  addCardKey(keys, String(roundPlan?.cardsById[ownId]?.sourceCardId || ''))
  addCardKey(keys, parseRetrySourceId(ownId))
  return keys
}

function sharesFamily(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size === 0 || right.size === 0) return false
  for (const key of left) {
    if (right.has(key)) return true
  }
  return false
}

function isLiveRetry(
  card: FreestyleCard,
  roundPlan: FreestyleRoundPlanState | null,
) {
  if (isRetryOccurrence(card)) return true
  if (String(card.id || '').startsWith('retry:')) return true
  return roundPlan?.cardsById[card.id]?.occurrenceKind === 'retry'
}

function familyHasPass(
  card: FreestyleCard,
  cards: ReadonlyArray<FreestyleCard>,
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completed: ReadonlySet<string>,
  roundPlan: FreestyleRoundPlanState | null,
) {
  const keys = familyKeys(card, roundPlan)
  return cards.some((candidate) => (
    sharesFamily(keys, familyKeys(candidate, roundPlan))
    && isPassedOccurrence(candidate, encountersByCardId, completed, roundPlan)
  ))
}

function hasUnfinishedFamilyRetry(
  cards: ReadonlyArray<FreestyleCard>,
  card: FreestyleCard,
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completed: ReadonlySet<string>,
  roundPlan: FreestyleRoundPlanState | null,
) {
  const keys = familyKeys(card, roundPlan)
  const origin = cards.findIndex((item) => item === card || item.id === card.id)
  return cards.some((candidate, index) => {
    if (index <= origin || !isLiveRetry(candidate, roundPlan)) return false
    if (!sharesFamily(keys, familyKeys(candidate, roundPlan))) return false
    return !isPassedOccurrence(candidate, encountersByCardId, completed, roundPlan)
  })
}

/**
 * First card the 完成 button should open.
 * Unrated units stay seekable, including ones skipped ahead.
 * A source is not the target once a later 重练 of the same unit is in the
 * feed — seek that retry, even when the 困难 rating is not on this card id.
 * The source is still the target when the retry has not been inserted yet.
 * A copied weak lastRating on the retry is not a pass. Round completion
 * still waits for the retry.
 */
export function findEarliestUnhandledIndex(
  cards: ReadonlyArray<FreestyleCard>,
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completedIds: Iterable<string> = [],
  roundPlan: FreestyleRoundPlanState | null = null,
): number | null {
  const completed = new Set(Array.from(completedIds, String))
  const index = cards.findIndex((card) => {
    const id = String(card.id || '').trim()
    if (!id) return false
    // The yellow boundary hint is never handled work — never a seek target.
    if (isReviewHintId(id)) return false
    if (isHandled(card, encountersByCardId, completedIds, cards, roundPlan)) return false
    if (hasUnfinishedFamilyRetry(cards, card, encountersByCardId, completed, roundPlan)) return false
    return true
  })
  return index >= 0 ? index : null
}

/**
 * Right-side 完成 while the round is still open: queue-order first unscored
 * card (谁最早看谁). A scored 重练 is never the target — the next blank
 * attempt is, once leave clears its score.
 */
export function findEarliestCompleteSeekIndex(
  cards: ReadonlyArray<FreestyleCard>,
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completedIds: Iterable<string> = [],
  roundPlan: FreestyleRoundPlanState | null = null,
  hiddenIds: Iterable<string> = [],
): number | null {
  return findEarliestUnratedIndex(
    cards,
    completedIds,
    encountersByCardId,
    roundPlan,
    hiddenIds,
  )
}

/** Queue-order indexes 完成 can still land on. 移除本队列 is not in this list. */
export function findUnscoredCompleteSeekIndices(
  cards: ReadonlyArray<FreestyleCard>,
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completedIds: Iterable<string> = [],
  roundPlan: FreestyleRoundPlanState | null = null,
  hiddenIds: Iterable<string> = [],
): number[] {
  return unscoredOccurrenceIndices({
    cards,
    completedIds,
    encounters: encountersByCardId,
    roundPlan,
    hiddenIds,
  })
}

/**
 * Cold open of a round: the same place the right-side 完成 button would jump.
 * An open round lands on the earliest unscored card. A fully scored round
 * lands on the closing settlement slot (`cards.length`), which is not a queue card.
 */
export function resolveFreestyleOpenFeedIndex(
  cards: ReadonlyArray<FreestyleCard>,
  encountersByCardId: Record<string, FreestyleUnitEncounterState>,
  completedIds: Iterable<string> = [],
  roundPlan: FreestyleRoundPlanState | null = null,
): number {
  if (cards.length === 0) return 0
  const seek = findEarliestUnratedIndex(cards, completedIds, encountersByCardId, roundPlan)
  return seek == null ? cards.length : seek
}

/**
 * Right-side 完成: open the settlement slot once every presented card is
 * scored. While the round is open, the first click seeks the earliest
 * unscored card (谁最早看谁). Another click while already on an unscored
 * card seeks the next one, then wraps. Null means there is nowhere else
 * to go (only one unscored card and the viewport is already on it, already
 * on the settlement slot, or the feed is empty). A weak score is scored.
 * 移除本队列 is not an unscored target.
 */
export function resolveFreestyleCompleteSeek(options: {
  roundComplete: boolean
  cardCount: number
  earliestUnhandledIndex: number | null
  visualIndex: number
  /** Queue-order unscored indexes. Omit to seek only the earliest. */
  unscoredIndices?: readonly number[]
}): number | null {
  const {
    roundComplete,
    cardCount,
    earliestUnhandledIndex,
    visualIndex,
    unscoredIndices,
  } = options
  if (cardCount <= 0) return null
  if (roundComplete) {
    const settlementIndex = cardCount
    return visualIndex === settlementIndex ? null : settlementIndex
  }
  const pending = (unscoredIndices ?? (
    earliestUnhandledIndex == null ? [] : [earliestUnhandledIndex]
  )).filter((index) => index >= 0 && index < cardCount)
  if (pending.length === 0) return null
  const at = pending.indexOf(visualIndex)
  if (at < 0) return pending[0]
  if (pending.length === 1) return null
  return pending[(at + 1) % pending.length]
}

/**
 * Closing snap slot after the last unit. It is not a queue card: queue index
 * stays on the last unit so refresh / persistence do not invent a card id.
 */
export function freestyleFeedSlotCount(cardCount: number, roundComplete: boolean): number {
  if (cardCount <= 0) return 0
  return cardCount + (roundComplete ? 1 : 0)
}

export function isFreestyleCompleteSlot(
  index: number,
  cardCount: number,
  roundComplete: boolean,
): boolean {
  return roundComplete && cardCount > 0 && index >= cardCount
}

/** 下一张 on the last handled unit must land on the closing slot, not clamp away. */
export function clampFreestyleFeedIndex(
  index: number,
  cardCount: number,
  roundComplete: boolean,
): number {
  const max = Math.max(0, freestyleFeedSlotCount(cardCount, roundComplete) - 1)
  return Math.max(0, Math.min(index, max))
}

/**
 * Pager 下一张: beyond the last live card only when a pending restudy still needs
 * leave/insert, or when the closing settlement slot is open.
 */
export function freestyleCanPageNext(
  visualIndex: number,
  cardCount: number,
  roundComplete: boolean,
  hasPendingRestudyOnCurrent = false,
): boolean {
  if (cardCount <= 0) return false
  if (isFreestyleCompleteSlot(visualIndex, cardCount, roundComplete)) return false
  if (visualIndex < freestyleFeedSlotCount(cardCount, roundComplete) - 1) return true
  return hasPendingRestudyOnCurrent
}

export function buildPartialSettlementSnapshot(input: {
  id: string
  cardIds: readonly string[]
  cards: FreestyleCard[]
  encountersByCardId: Record<string, FreestyleUnitEncounterState>
  completedIds?: Iterable<string>
  roundPlan?: FreestyleRoundPlanState | null
  subjectByPalaceId?: ReadonlyMap<number, { id: number; name: string }>
  quizCount?: number
}): FreestylePartialSettlementSnapshot | null {
  const cardIds = [...new Set(input.cardIds.map((id) => String(id || '').trim()).filter(Boolean))]
  const id = input.id.trim()
  if (!id || !cardIds.length) return null
  const selected = new Set(cardIds)
  const batch = input.cards.filter((card) => selected.has(card.id))
  const completion = buildFreestyleRoundCompletion(
    batch,
    input.encountersByCardId,
    batch.length,
    {
      completedIds: input.completedIds,
      roundPlan: input.roundPlan,
      subjectByPalaceId: input.subjectByPalaceId,
      quizCount: input.quizCount,
    },
  )
  return {
    id,
    cardIds,
    cardCount: cardIds.length,
    ratedCount: completion.ratedCount,
    passedCount: completion.passedCount,
    newCount: completion.newCount,
    reviewCount: completion.reviewCount,
    retryCount: completion.retryCount,
    quizCount: completion.quizCount,
    bySubject: completion.bySubject.flatMap((subject) => {
      const palaces = subject.palaces.filter((palace) => palace.cardCount > 0)
      if (!palaces.length) return []
      return [{
        ...subject,
        palaceCount: palaces.length,
        cardCount: palaces.reduce((sum, palace) => sum + palace.cardCount, 0),
        palaces,
      }]
    }),
  }
}

/**
 * Headline counts on 大结算 must include cards that already left the feed.
 * The answered-quiz set stays as-is so 做题 is not added twice.
 * A snapshot whose cards are still in the feed is listed, not folded.
 */
export function foldPartialSettlementsIntoCompletion(
  completion: FreestyleRoundCompletion,
  snapshots: readonly FreestylePartialSettlementSnapshot[] | undefined,
  liveCardIds: Iterable<string> = [],
): FreestyleRoundCompletion {
  const live = new Set(Array.from(liveCardIds, (id) => String(id || '').trim()))
  const settled = (snapshots ?? []).filter((item) => item.cardIds.every((id) => !live.has(id)))
  if (!settled.length) return completion
  const ratedCount = completion.ratedCount + settled.reduce((sum, item) => sum + item.ratedCount, 0)
  const passedCount = completion.passedCount + settled.reduce((sum, item) => sum + item.passedCount, 0)
  const retryCount = completion.retryCount + settled.reduce((sum, item) => sum + item.retryCount, 0)
  const bySubject = mergeRoundSubjects(completion.bySubject, settled.flatMap((item) => item.bySubject))
  return {
    ...completion,
    ratedCount,
    passedCount,
    newCount: completion.newCount + settled.reduce((sum, item) => sum + item.newCount, 0),
    reviewCount: completion.reviewCount + settled.reduce((sum, item) => sum + item.reviewCount, 0),
    retriedCount: completion.retriedCount + settled.reduce((sum, item) => sum + item.retryCount, 0),
    retryCount,
    involvedUnitCount: completion.involvedUnitCount + settled.reduce((sum, item) => sum + item.ratedCount, 0),
    totalUnits: bySubject.reduce((sum, subject) => sum + subject.totalUnits, 0),
    bySubject,
  }
}

function mergeRoundSubjects(
  live: readonly FreestyleRoundSubjectStat[],
  settled: readonly FreestylePartialSettlementSubject[],
): FreestyleRoundSubjectStat[] {
  const subjects = new Map<string, {
    subjectId: number | null
    subjectName: string
    palaces: Map<number, FreestyleRoundSubjectPalaceStat>
  }>()
  const add = (subject: FreestyleRoundSubjectStat | FreestylePartialSettlementSubject) => {
    const key = subject.subjectId == null ? `name:${subject.subjectName}` : `id:${subject.subjectId}`
    let bucket = subjects.get(key)
    if (!bucket) {
      bucket = { subjectId: subject.subjectId, subjectName: subject.subjectName, palaces: new Map() }
      subjects.set(key, bucket)
    }
    for (const palace of subject.palaces) {
      const current = bucket.palaces.get(palace.palaceId)
      if (!current) {
        bucket.palaces.set(palace.palaceId, { ...palace })
        continue
      }
      current.cardCount += palace.cardCount
      current.totalUnits = Math.max(current.totalUnits, palace.totalUnits)
    }
  }
  live.forEach(add)
  settled.forEach(add)
  return Array.from(subjects.values()).map((subject) => {
    const palaces = Array.from(subject.palaces.values()).sort((left, right) => (
      right.cardCount - left.cardCount
      || left.palaceTitle.localeCompare(right.palaceTitle, 'zh')
    ))
    return {
      subjectId: subject.subjectId,
      subjectName: subject.subjectName,
      palaceCount: palaces.length,
      cardCount: palaces.reduce((sum, palace) => sum + palace.cardCount, 0),
      totalUnits: palaces.reduce((sum, palace) => sum + palace.totalUnits, 0),
      palaces,
    }
  }).sort((left, right) => (
    right.cardCount - left.cardCount
    || left.subjectName.localeCompare(right.subjectName, 'zh')
  ))
}
