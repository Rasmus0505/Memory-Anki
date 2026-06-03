import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import DashboardPage from '@/app/router/DashboardPage'
import PalaceListPage from '@/app/router/PalaceListPage'
import PalaceShelfPage from '@/app/router/PalaceShelfPage'
import PalacePracticePage from '@/app/router/PalacePracticePage'
import PalaceViewPage from '@/app/router/PalaceViewPage'
import SegmentPracticePage from '@/app/router/SegmentPracticePage'
import ReviewOverviewPage from '@/features/review/ReviewOverviewPage'

const KnowledgePage = lazy(() => import('@/features/knowledge/KnowledgePage'))
const PalaceEditPage = lazy(() => import('@/features/palace-edit/PalaceEditPage'))
const ProfilePage = lazy(() => import('@/features/profile/ProfilePage'))
const ProfileAiSplitPage = lazy(
  () => import('@/features/profile/ProfileAiSplitPage'),
)
const ProfileBackupsPage = lazy(
  () => import('@/features/profile/ProfileBackupsPage'),
)
const ReviewSessionPage = lazy(
  () => import('@/features/review/ReviewSessionPage'),
)
const SegmentReviewSessionPage = lazy(
  () => import('@/features/review/SegmentReviewSessionPage'),
)
const BatchSegmentReviewSessionPage = lazy(
  () => import('@/features/review/BatchSegmentReviewSessionPage'),
)

function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
      正在加载页面...
    </div>
  )
}

export function AppRouter() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/palaces" element={<PalaceShelfPage />} />
        <Route path="/palaces/list" element={<PalaceListPage />} />
        <Route path="/palaces/new" element={<PalaceEditPage />} />
        <Route path="/palaces/:id" element={<PalaceViewPage />} />
        <Route path="/palaces/:id/practice" element={<PalacePracticePage />} />
        <Route path="/segments/:id/practice" element={<SegmentPracticePage />} />
        <Route path="/palaces/:id/edit" element={<PalaceEditPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/review" element={<ReviewOverviewPage />} />
        <Route path="/review/session/:id" element={<ReviewSessionPage />} />
        <Route path="/segment-review/session/:id" element={<SegmentReviewSessionPage />} />
        <Route path="/segment-review/batch" element={<BatchSegmentReviewSessionPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/ai-split" element={<ProfileAiSplitPage />} />
        <Route path="/profile/backups" element={<ProfileBackupsPage />} />
      </Routes>
    </Suspense>
  )
}
