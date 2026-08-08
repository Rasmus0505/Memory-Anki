import {
  planCardStatus,
  type FreestyleRoundPlanCardStatus,
  type FreestyleRoundPlanState,
} from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'

export type FreestyleSegmentTone = 'done' | 'retry' | 'current' | 'pending'

export interface FreestyleProgressSegment {
  cardId: string
  tone: FreestyleSegmentTone
}

export interface FreestyleProgressSummary {
  segments: FreestyleProgressSegment[]
  /** 1-based index among rendered segments; 0 when no card is current. */
  position: number
  total: number
  doneCount: number
  retryCount: number
}

/**
 * A 2px rail cannot carry six colors legibly, so the plan's statuses collapse:
 * `excluded` leaves the rail entirely (it is not part of the round, and drawing it
 * would make progress look artificially slow), and `stale` is too transient to earn
 * its own hue. `current` stays distinct because restudy re-insertion reorders the
 * feed mid-round — without it, "where am I" is lost in the shuffle.
 */
export function segmentTone(
  status: FreestyleRoundPlanCardStatus,
): FreestyleSegmentTone | null {
  switch (status) {
    case 'excluded':
      return null
    case 'active':
      return 'current'
    case 'completed':
      return 'done'
    case 'retry':
      return 'retry'
    default:
      return 'pending'
  }
}

export function buildFreestyleProgressSummary(
  cards: FreestyleCard[],
  roundPlan: FreestyleRoundPlanState | null,
  completedIds: string[],
  hiddenIds: string[],
  currentCardId: string | null,
): FreestyleProgressSummary {
  const segments: FreestyleProgressSegment[] = []
  for (const card of cards) {
    const tone = segmentTone(
      planCardStatus(card, roundPlan, completedIds, hiddenIds, currentCardId),
    )
    if (!tone) continue
    segments.push({ cardId: card.id, tone })
  }
  const currentIndex = segments.findIndex((segment) => segment.tone === 'current')
  return {
    segments,
    position: currentIndex >= 0 ? currentIndex + 1 : 0,
    total: segments.length,
    doneCount: segments.filter((segment) => segment.tone === 'done').length,
    retryCount: segments.filter((segment) => segment.tone === 'retry').length,
  }
}

/**
 * The rail is decorative, so every count it draws has to be spoken here instead.
 */
export function progressRailLabel(summary: FreestyleProgressSummary): string {
  if (summary.total === 0) return '本轮暂无安排。点击查看本轮安排'
  const parts = [
    summary.position > 0
      ? `本轮进度 ${summary.position}/${summary.total}`
      : `本轮共 ${summary.total} 张`,
  ]
  if (summary.doneCount > 0) parts.push(`已通过 ${summary.doneCount}`)
  if (summary.retryCount > 0) parts.push(`待重练 ${summary.retryCount}`)
  return `${parts.join('，')}。点击查看本轮安排`
}
