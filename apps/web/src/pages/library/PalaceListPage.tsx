import { PalaceListPage as FeaturePage } from '@/modules/content/public'
import { getReviewSessionApi, getReviewSessionProgressApi } from '@/modules/practice/public'
import { prefetchStudySession } from '@/shared/api/studySessionWarmup'

function prefetchReviewSession(reviewId: number) {
  prefetchStudySession('review-session', reviewId, () =>
    Promise.all([getReviewSessionApi(reviewId), getReviewSessionProgressApi(reviewId)]).then(
      ([session, progress]) => ({ session, progress }),
    ),
  )
}

export default function PalaceListPage() {
  return <FeaturePage prefetchReviewSession={prefetchReviewSession} />
}
