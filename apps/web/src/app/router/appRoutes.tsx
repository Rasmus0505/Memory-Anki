import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, type Location } from 'react-router-dom'
import { LoadingState } from '@/shared/components/state-placeholders'
import DashboardPage from '@/app/router/DashboardPage'
import PalaceListPage from '@/app/router/PalaceListPage'
import PalaceShelfPage from '@/app/router/PalaceShelfPage'
import PalacePracticePage from '@/app/router/PalacePracticePage'
import PalaceFocusPracticePage from '@/app/router/PalaceFocusPracticePage'
import PalaceViewPage from '@/app/router/PalaceViewPage'
import SegmentPracticePage from '@/app/router/SegmentPracticePage'
import MiniPalacePracticePage from '@/app/router/MiniPalacePracticePage'
import ReviewOverviewPage from '@/features/review/ReviewOverviewPage'

const KnowledgePage = lazy(() => import('@/features/knowledge/KnowledgePage'))
const EnglishWorkspacePage = lazy(() => import('@/features/english/EnglishWorkspacePage'))
const EnglishCoursePage = lazy(() => import('@/features/english/EnglishCoursePage'))
const EnglishReadingPage = lazy(() => import('@/features/english-reading/EnglishReadingPage'))
const PalaceEditPage = lazy(() => import('@/features/palace-edit/PalaceEditPage'))
const PalaceQuizHubPage = lazy(() => import('@/app/router/PalaceQuizHubPage'))
const PalaceQuizPage = lazy(() => import('@/features/palace-quiz/PalaceQuizPage'))
const ProfilePage = lazy(() => import('@/features/profile/ProfilePage'))
const ProfileAiPage = lazy(() => import('@/features/profile/ProfileAiPage'))
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
const MiniReviewSessionPage = lazy(
  () => import('@/features/review/MiniReviewSessionPage'),
)

function RouteFallback() {
  return <LoadingState text="正在加载页面…" />
}

export function AppRoutes({ location }: { location?: Location }) {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes location={location}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/palaces" element={<PalaceShelfPage />} />
        <Route path="/english" element={<EnglishWorkspacePage />} />
        <Route path="/english-reading" element={<EnglishReadingPage />} />
        <Route path="/english/courses/:id" element={<EnglishCoursePage />} />
        <Route path="/palaces/list" element={<PalaceListPage />} />
        <Route path="/palaces/new" element={<PalaceEditPage />} />
        <Route path="/palaces/quiz" element={<PalaceQuizHubPage />} />
        <Route path="/palaces/:id" element={<PalaceViewPage />} />
        <Route path="/palaces/:id/quiz" element={<PalaceQuizPage />} />
        <Route path="/palaces/:id/practice" element={<PalacePracticePage />} />
        <Route path="/palaces/:id/focus-practice" element={<PalaceFocusPracticePage />} />
        <Route path="/segments/:id/practice" element={<SegmentPracticePage />} />
        <Route path="/mini-palaces/:id/practice" element={<MiniPalacePracticePage />} />
        <Route path="/mini-review/session/:id" element={<MiniReviewSessionPage />} />
        <Route path="/palaces/:id/edit" element={<PalaceEditPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/review" element={<ReviewOverviewPage />} />
        <Route path="/review/session/:id" element={<ReviewSessionPage />} />
        <Route path="/segment-review/session/:id" element={<SegmentReviewSessionPage />} />
        <Route path="/segment-review/batch" element={<BatchSegmentReviewSessionPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/ai" element={<ProfileAiPage />} />
        <Route path="/profile/ai-prompts" element={<Navigate to="/profile/ai?tab=prompts" replace />} />
        <Route path="/profile/ai-split" element={<Navigate to="/profile/ai?tab=config" replace />} />
        <Route path="/profile/voice-coach" element={<Navigate to="/profile/ai?tab=config" replace />} />
        <Route path="/profile/backups" element={<ProfileBackupsPage />} />
      </Routes>
    </Suspense>
  )
}
