import { Suspense, lazy } from 'react'
import { Route, Routes } from 'react-router-dom'
import DashboardPage from '@/app/router/DashboardPage'
import PalaceListPage from '@/app/router/PalaceListPage'
import PalacePracticePage from '@/app/router/PalacePracticePage'
import PalaceViewPage from '@/app/router/PalaceViewPage'
import ReviewOverviewPage from '@/features/review/ReviewOverviewPage'

const KnowledgePage = lazy(() => import('@/features/knowledge/KnowledgePage'))
const PalaceEditPage = lazy(() => import('@/features/palace-edit/PalaceEditPage'))
const ProfilePage = lazy(() => import('@/features/profile/ProfilePage'))
const ProfileBackupsPage = lazy(
  () => import('@/features/profile/ProfileBackupsPage'),
)
const ReviewSessionPage = lazy(
  () => import('@/features/review/ReviewSessionPage'),
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
        <Route path="/palaces" element={<PalaceListPage />} />
        <Route path="/palaces/new" element={<PalaceEditPage />} />
        <Route path="/palaces/:id" element={<PalaceViewPage />} />
        <Route path="/palaces/:id/practice" element={<PalacePracticePage />} />
        <Route path="/palaces/:id/edit" element={<PalaceEditPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/review" element={<ReviewOverviewPage />} />
        <Route path="/review/session/:id" element={<ReviewSessionPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/backups" element={<ProfileBackupsPage />} />
      </Routes>
    </Suspense>
  )
}
