import type { FreestyleCard } from '@/shared/api/contracts'
import type { ComponentProps } from 'react'
import { freestyleCanPageNext } from '@/modules/practice/ui/freestyle/model/roundCompletion'
import { FreestyleFeedPager } from '@/modules/practice/ui/freestyle/components/FreestyleFeedPager'

type PagerProps = ComponentProps<typeof FreestyleFeedPager>

export function FreestyleBottomActions({
  cards,
  viewingCompleteSlot,
  canGoPrevious,
  visualIndex,
  roundComplete,
  viewingCardId,
  pendingRestudyCardIds,
  canCompleteRound,
  completeTitle,
  onPrevious,
  onNext,
  onComplete,
}: {
  cards: FreestyleCard[]
  viewingCompleteSlot: boolean
  canGoPrevious: boolean
  visualIndex: number
  roundComplete: boolean
  viewingCardId: string | null
  pendingRestudyCardIds: string[]
  canCompleteRound: PagerProps['canComplete']
  completeTitle: PagerProps['completeTitle']
  onPrevious: PagerProps['onPrevious']
  onNext: PagerProps['onNext']
  onComplete: PagerProps['onComplete']
}) {
  return (
    <FreestyleFeedPager
      canGoPrevious={
        viewingCompleteSlot
          ? cards.length > 0
          : canGoPrevious && cards.length > 0
      }
      canGoNext={
        freestyleCanPageNext(
          visualIndex,
          cards.length,
          roundComplete,
          Boolean(viewingCardId && pendingRestudyCardIds.includes(viewingCardId)),
        )
      }
      canComplete={canCompleteRound}
      completeTitle={completeTitle}
      previousTitle={
        viewingCompleteSlot
          ? '取消结算，返回上一张'
          : '上一张：返回上一个单元'
      }
      onPrevious={onPrevious}
      onNext={onNext}
      onComplete={onComplete}
    />
  )
}
