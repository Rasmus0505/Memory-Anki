import FeaturePage from '@/features/palace-catalog/PalaceListPage'
import { getReviewSessionApi, getReviewSessionProgressApi } from '@/features/review/api'
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
