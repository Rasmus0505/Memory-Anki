import {
  popViewHistory,
  pushViewHistory,
} from '@/modules/practice/public'
import type { FreestyleCard } from '@/shared/api/contracts'

/**
 * The page 「上一张」 should return to when the feed moves forward.
 *
 * A button/keyboard turn leaves the page under the viewport, which may be ahead
 * of the committed queue cursor while a gesture is still settling. A finger or
 * wheel landing crossed every page between the old cursor and the new one: the
 * nearest one above it (`next - 1`) is what the learner saw last — recording the
 * fling's start skipped a unit on every multi-page swipe.
 */
export function leavingPageCardId(args: {
  cards: readonly FreestyleCard[]
  currentIndex: number
  visualIndex: number
  /** Queue index the feed is landing on. */
  next: number
  fromScroll: boolean
}): string | null {
  const { cards, currentIndex, visualIndex, next, fromScroll } = args
  const index = fromScroll
    ? next - 1
    : (visualIndex >= 0 && visualIndex < cards.length ? visualIndex : currentIndex)
  return cards[index]?.id ?? null
}

/**
 * The back stack after a landing.
 *
 * Forward: record the page just left (a gesture records the page above the
 * landing, never the fling's start). Backward: drop every entry that now sits
 * ahead of the viewport, so a later pop can never walk forward. A gesture that
 * crossed several pages forgets older jump targets — from there 上一张 should
 * step back one page at a time, not leap to where an earlier fling began.
 */
export function viewHistoryAfterMove(args: {
  history: readonly string[]
  cards: readonly FreestyleCard[]
  currentIndex: number
  visualIndex: number
  next: number
  fromScroll: boolean
  skipHistory?: boolean
}): string[] {
  const { history, cards, currentIndex, visualIndex, next, fromScroll, skipHistory } = args
  if (next > currentIndex) {
    if (skipHistory) return history as string[]
    const leavingId = leavingPageCardId({ cards, currentIndex, visualIndex, next, fromScroll })
    if (!leavingId) return history as string[]
    if (fromScroll && next - currentIndex > 1) return [leavingId]
    return pushViewHistory(history, leavingId)
  }
  if (next >= currentIndex) return history as string[]
  const behind = new Set(cards.slice(0, next).map((card) => card.id))
  return history.filter((id) => behind.has(id))
}

/**
 * The card 「上一张」 opens, never one at or ahead of the viewport. Missing ids
 * (结算 / 移除 / 新一轮) are skipped by the shared pop.
 */
export function previousViewTarget(args: {
  history: readonly string[]
  cards: readonly FreestyleCard[]
  currentCardId: string | null
  beforeIndex: number
}): { history: string[]; targetId: string } | null {
  return popViewHistory(args.history, args.cards, args.currentCardId, args.beforeIndex)
}
