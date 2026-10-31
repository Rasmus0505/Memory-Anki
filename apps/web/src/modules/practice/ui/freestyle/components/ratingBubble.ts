import { showMicroBubble } from '@/shared/fx'
import { ratingBubbleCopy, type RatingBubbleInput } from '../model/ratingBubble'

/**
 * The grade pill is anchored to the pressed key and lives on the fx top layer,
 * so switching to the next card 220ms later cannot clip or cover it.
 */
export function showRatingBubble(anchor: Element | null, input: RatingBubbleInput) {
  const copy = ratingBubbleCopy(input)
  showMicroBubble(anchor, {
    ...copy,
    zone: 'review-rating',
    placement: 'above',
    offset: 10,
    duration: 1050,
  })
}
