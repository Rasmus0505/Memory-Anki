import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, type Location } from 'react-router-dom'
import { LoadingState } from '@/shared/components/state-placeholders'
import DashboardPage from '@/app/router/DashboardPage'
import PalaceListPage from '@/app/router/PalaceListPage'
import PalaceShelfPage from '@/app/router/PalaceShelfPage'
import PalacePracticePage from '@/app/router/PalacePracticePage'
import PalaceFocusPracticePage from '@/app/router/PalaceFocusPracticePage'
import SegmentPracticePage from '@/app/router/SegmentPracticePage'
import MiniPalacePracticePage from '@/app/router/MiniPalacePracticePage'
import ReviewOverviewPage from '@/features/review/ReviewOverviewPage'

export const preloadPalaceViewPage = () => import('@/app/router/PalaceViewPage')
export const preloadPalaceQuizHubPage = () => import('@/app/router/PalaceQuizHubPage')

const KnowledgePage = lazy(() => import('@/features/knowledge/KnowledgePage'))
const EnglishWorkspacePage = lazy(() => import('@/features/english/EnglishWorkspacePage'))
const EnglishCoursePage = lazy(() => import('@/features/english/EnglishCoursePage'))
const EnglishReadingPage = lazy(() => import('@/features/english-reading/EnglishReadingPage'))
const PalaceEditPage = lazy(() => import('@/features/palace-edit/PalaceEditPage'))
const PalaceQuizHubPage = lazy(preloadPalaceQuizHubPage)
const PalaceViewPage = lazy(preloadPalaceViewPage)
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

function normalizePathname(pathname: string) {
  if (!pathname || pathname === '/') return '/'
  return pathname.replace(/\/+$/, '') || '/'
}

export function resolveRouteFallbackTarget(pathname: string) {
  const normalizedPathname = normalizePathname(pathname)

  if (normalizedPathname === '/') return '/'
  if (normalizedPathname === '/knowledge') return '/knowledge'
  if (normalizedPathname === '/english') return '/english'
  if (normalizedPathname === '/english-reading') return '/english-reading'
  if (normalizedPathname === '/palaces') return '/palaces'
  if (normalizedPathname === '/palaces/list') return '/palaces/list'
  if (normalizedPathname === '/palaces/new') return '/palaces/new'
  if (normalizedPathname === '/palaces/quiz') return '/palaces/quiz'
  if (normalizedPathname === '/review') return '/review'
  if (normalizedPathname === '/segment-review/batch') return '/segment-review/batch'
  if (normalizedPathname === '/profile') return '/profile'
  if (normalizedPathname === '/profile/ai') return '/profile/ai'
  if (normalizedPathname === '/profile/ai-prompts') return '/profile/ai-prompts'
  if (normalizedPathname === '/profile/ai-split') return '/profile/ai-split'
  if (normalizedPathname === '/profile/voice-coach') return '/profile/voice-coach'
  if (normalizedPathname === '/profile/backups') return '/profile/backups'

  if (/^\/palaces\/\d+$/.test(normalizedPathname)) return normalizedPathname
  if (/^\/palaces\/\d+\/(edit|practice|focus-practice|quiz)$/.test(normalizedPathname)) {
    return normalizedPathname
  }
  if (/^\/segments\/\d+\/practice$/.test(normalizedPathname)) return normalizedPathname
  if (/^\/mini-palaces\/\d+\/practice$/.test(normalizedPathname)) return normalizedPathname
  if (/^\/mini-review\/session\/\d+$/.test(normalizedPathname)) return normalizedPathname
  if (/^\/review\/session\/\d+$/.test(normalizedPathname)) return normalizedPathname
  if (/^\/segment-review\/session\/\d+$/.test(normalizedPathname)) return normalizedPathname
  if (/^\/english\/courses\/\d+$/.test(normalizedPathname)) return normalizedPathname

  const palaceDetailMatch = normalizedPathname.match(/^\/palaces\/(\d+)(?:\/.*)?$/)
  if (palaceDetailMatch) return `/palaces/${palaceDetailMatch[1]}`

  const englishCourseMatch = normalizedPathname.match(/^\/english\/courses\/(\d+)(?:\/.*)?$/)
  if (englishCourseMatch) return `/english/courses/${englishCourseMatch[1]}`

  const reviewSessionMatch = normalizedPathname.match(/^\/review\/session\/(\d+)(?:\/.*)?$/)
  if (reviewSessionMatch) return `/review/session/${reviewSessionMatch[1]}`

  const segmentReviewSessionMatch = normalizedPathname.match(/^\/segment-review\/session\/(\d+)(?:\/.*)?$/)
  if (segmentReviewSessionMatch) return `/segment-review/session/${segmentReviewSessionMatch[1]}`

  const miniReviewSessionMatch = normalizedPathname.match(/^\/mini-review\/session\/(\d+)(?:\/.*)?$/)
  if (miniReviewSessionMatch) return `/mini-review/session/${miniReviewSessionMatch[1]}`

  const segmentPracticeMatch = normalizedPathname.match(/^\/segments\/(\d+)\/practice(?:\/.*)?$/)
  if (segmentPracticeMatch) return `/segments/${segmentPracticeMatch[1]}/practice`

  const miniPalacePracticeMatch = normalizedPathname.match(/^\/mini-palaces\/(\d+)\/practice(?:\/.*)?$/)
  if (miniPalacePracticeMatch) return `/mini-palaces/${miniPalacePracticeMatch[1]}/practice`

  if (normalizedPathname.startsWith('/knowledge/')) return '/knowledge'
  if (normalizedPathname.startsWith('/profile/')) return '/profile'
  if (normalizedPathname.startsWith('/review/')) return '/review'
  if (normalizedPathname.startsWith('/segment-review/')) return '/review'
  if (normalizedPathname.startsWith('/mini-review/')) return '/review'
  if (normalizedPathname.startsWith('/english-reading/')) return '/english-reading'
  if (normalizedPathname.startsWith('/english/')) return '/english'
  if (normalizedPathname.startsWith('/palaces/')) return '/palaces'

  return '/'
}

function RouteNotFound({ pathname }: { pathname: string }) {
  const target = resolveRouteFallbackTarget(pathname)
  return <Navigate to={target} replace />
}

export function AppRoutes({ location }: { location?: Location }) {
  const fallbackPathname = location?.pathname || '/'
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
        <Route path="*" element={<RouteNotFound pathname={fallbackPathname} />} />
      </Routes>
    </Suspense>
  )
}
