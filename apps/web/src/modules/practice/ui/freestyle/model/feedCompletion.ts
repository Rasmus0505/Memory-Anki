import { resolveFreestyleCompleteSeek } from './roundCompletion'

/**
 * 完成 while the round is open: the index it opens and what its tooltip
 * promises. A round that is already scored enters the closing slot — which is
 * a waiting page, not a settlement, while same-day 重练 is still owed.
 */
export function resolveFreestyleCompleteAction(args: {
  roundComplete: boolean
  cardCount: number
  visualIndex: number
  unscoredIndices: readonly number[]
  pendingReviewCount?: number
}): { seekIndex: number | null; canComplete: boolean; title: string } {
  const seekIndex = resolveFreestyleCompleteSeek({
    roundComplete: args.roundComplete,
    cardCount: args.cardCount,
    earliestUnhandledIndex: args.unscoredIndices[0] ?? null,
    visualIndex: args.visualIndex,
    unscoredIndices: args.unscoredIndices,
  })
  const onUnscoredCard = args.unscoredIndices.includes(args.visualIndex)
  const title = (args.pendingReviewCount ?? 0) > 0
    ? '去看还没到点的重练'
    : args.roundComplete
      ? '进入本轮结算'
      : onUnscoredCard && args.unscoredIndices.length > 1
        ? '定位到下一张还没评分的单元'
        : '定位到最早还没评分的单元'
  return { seekIndex, canComplete: seekIndex != null, title }
}
