import type {
  FreestyleRoundPlanState,
  FreestyleUnitEncounterState,
} from '@/modules/practice/public'
import type {
  FreestylePartialSettlementSnapshot,
  FreestylePartialSettlementSubject,
} from '@/modules/practice/domain/partialSettlement'
import type { FreestyleCard } from '@/shared/api/contracts'
import {
  buildFreestyleRoundCompletion,
  type FreestyleRoundCompletion,
  type FreestyleRoundSubjectPalaceStat,
  type FreestyleRoundSubjectStat,
} from './roundCompletion'

/**
 * 小结算 (结算已完成单元) snapshot: the same completion fold as 大结算, limited
 * to the units the learner picked. Null when the selection has no live card.
 */
export function buildPartialSettlementSnapshot(input: {
  id: string
  cardIds: readonly string[]
  cards: FreestyleCard[]
  encountersByCardId: Record<string, FreestyleUnitEncounterState>
  completedIds?: Iterable<string>
  roundPlan?: FreestyleRoundPlanState | null
  subjectByPalaceId?: ReadonlyMap<number, { id: number; name: string }>
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
