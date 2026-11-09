import { resolveFreestyleCompleteSeek } from './roundCompletion'

/**
 * 完成 while the round is open: the index it opens and what its tooltip
 * promises. A round that is already scored enters the closing slot — which is
 * a waiting page, not a settlement, while same-day 重练 is still owed.
 *
 * `seekIndices` lists the outstanding cards (blank 重练 grouped first) and
 * `retryIndices` marks the 重练 among them: the seek returns to the earliest
 * blank 重练 even when the viewport already sits on another unscored card.
 */
export function resolveFreestyleCompleteAction(args: {
  roundComplete: boolean
  cardCount: number
  visualIndex: number
  seekIndices: readonly number[]
  /** Subset of `seekIndices` that are 重练 occurrences, for the tooltip only. */
  retryIndices?: readonly number[]
  pendingReviewCount?: number
}): { seekIndex: number | null; canComplete: boolean; title: string } {
  const seekIndex = resolveFreestyleCompleteSeek({
    roundComplete: args.roundComplete,
    cardCount: args.cardCount,
    earliestUnhandledIndex: args.seekIndices[0] ?? null,
    visualIndex: args.visualIndex,
    unscoredIndices: args.seekIndices,
    retryIndices: args.retryIndices,
  })
  const onSeekCard = args.seekIndices.includes(args.visualIndex)
  const onRetryCard = (args.retryIndices ?? []).includes(args.visualIndex)
  const targetIsRetry = seekIndex != null && (args.retryIndices ?? []).includes(seekIndex)
  const title = (args.pendingReviewCount ?? 0) > 0
    ? '去看还没到点的重练'
    : args.roundComplete
      ? '进入本轮结算'
      : targetIsRetry
        ? (onRetryCard ? '定位到下一张重练' : '定位到最早的重练')
        : onSeekCard && args.seekIndices.length > 1
          ? '定位到下一张还没评分的单元'
          : '定位到最早还没评分的单元'
  return { seekIndex, canComplete: seekIndex != null, title }
}
