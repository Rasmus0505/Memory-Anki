import FeaturePage from '@/features/palace-catalog/PalaceShelfPage'
import { getReviewSessionApi, getReviewSessionProgressApi } from '@/features/review/api'
import { prefetchStudySession } from '@/shared/api/studySessionWarmup'

function prefetchReviewSession(reviewId: number) {
  prefetchStudySession('review-session', reviewId, () =>
    Promise.all([getReviewSessionApi(reviewId), getReviewSessionProgressApi(reviewId)]).then(
      ([session, progress]) => ({ session, progress }),
    ),
  )
}

export default function PalaceLibraryPage() {
  return <FeaturePage prefetchReviewSession={prefetchReviewSession} />
}
