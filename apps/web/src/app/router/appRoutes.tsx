import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes, type Location } from 'react-router-dom'
import { LoadingState } from '@/shared/components/state-placeholders'
import DashboardPage from '@/features/dashboard/DashboardPage'
import PalaceListPage from '@/features/palace-catalog/PalaceListPage'
import PalaceShelfPage from '@/features/palace-catalog/PalaceShelfPage'
import PalacePracticePage from '@/app/router/PalacePracticePage'
import PalaceFocusPracticePage from '@/app/router/PalaceFocusPracticePage'
import SegmentPracticePage from '@/app/router/SegmentPracticePage'
import MiniPalacePracticePage from '@/app/router/MiniPalacePracticePage'
import ReviewOverviewPage from '@/app/router/review/ReviewOverview'

export const preloadPalaceViewPage = () => import('@/app/router/PalaceViewPage')

const KnowledgePage = lazy(() => import('@/features/knowledge/KnowledgePage'))
const EnglishWorkspacePage = lazy(() => import('@/features/english/EnglishWorkspacePage'))
const EnglishCoursePage = lazy(() => import('@/features/english/EnglishCoursePage'))
const EnglishReadingPage = lazy(() => import('@/features/english-reading/EnglishReadingPage'))
const PalaceEditPage = lazy(() => import('@/features/palace-edit/PalaceEditPage'))
const PalaceViewPage = lazy(preloadPalaceViewPage)
const PalaceQuizPage = lazy(() => import('@/features/palace-quiz/PalaceQuizPage'))
const ProfilePage = lazy(() => import('@/features/profile/ProfilePage'))
const ProfileFeedbackPage = lazy(() => import('@/features/profile/ProfileFeedbackPage'))
const ProfileAiPage = lazy(() => import('@/features/profile/ProfileAiPage'))
const ProfileBackupsPage = lazy(
  () => import('@/features/profile/ProfileBackupsPage'),
)
const ReviewSessionPage = lazy(() => import('@/app/router/review/ReviewSession'))
const ReviewFeedbackPreviewRoute = lazy(
  () => import('@/app/router/ReviewFeedbackPreviewRoute'),
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

// 已注册的精确路由路径（normalize 后直接命中，保留原路径）。
const REGISTERED_EXACT_PATHS = new Set<string>([
  '/',
  '/knowledge',
  '/english',
  '/english-reading',
  '/palaces',
  '/palaces/list',
  '/palaces/new',
  '/review',
  '/segment-review/batch',
  '/profile',
  '/profile/feedback',
  '/profile/ai',
  '/profile/backups',
])

// 已注册的动态段路由（命中后保留原路径）。仅匹配到主段，不含未知后代。
const REGISTERED_DYNAMIC_PATTERNS = [
  /^\/palaces\/\d+(?:\/(edit|practice|focus-practice|quiz))?$/,
  /^\/segments\/\d+\/practice$/,
  /^\/mini-palaces\/\d+\/practice$/,
  /^\/english\/courses\/\d+$/,
  /^\/review\/session\/\d+$/,
  /^\/segment-review\/session\/\d+$/,
  /^\/mini-review\/session\/\d+$/,
]

// 动态段路由的"前缀提取"：命中已注册动态段的未知后代时，回退到主段。
// 例：/palaces/42/unknown → /palaces/42；/review/session/9/x → /review/session/9。
const DYNAMIC_PREFIX_FALLBACKS = [
  { match: /^\/palaces\/(\d+)(?:\/.*)?$/, build: (id: string) => `/palaces/${id}` },
  { match: /^\/english\/courses\/(\d+)(?:\/.*)?$/, build: (id: string) => `/english/courses/${id}` },
  { match: /^\/review\/session\/(\d+)(?:\/.*)?$/, build: (id: string) => `/review/session/${id}` },
  { match: /^\/segment-review\/session\/(\d+)(?:\/.*)?$/, build: (id: string) => `/segment-review/session/${id}` },
  { match: /^\/mini-review\/session\/(\d+)(?:\/.*)?$/, build: (id: string) => `/mini-review/session/${id}` },
  { match: /^\/segments\/(\d+)\/practice(?:\/.*)?$/, build: (id: string) => `/segments/${id}/practice` },
  { match: /^\/mini-palaces\/(\d+)\/practice(?:\/.*)?$/, build: (id: string) => `/mini-palaces/${id}/practice` },
]

// 顶层 section 前缀：未知的子路径回退到 section 入口。
const SECTION_PREFIX_FALLBACKS: Record<string, string> = {
  '/knowledge/': '/knowledge',
  '/profile/': '/profile',
  '/review/': '/review',
  '/segment-review/': '/review',
  '/mini-review/': '/review',
  '/english-reading/': '/english-reading',
  '/english/': '/english',
  '/palaces/': '/palaces',
}

export function resolveRouteFallbackTarget(pathname: string) {
  const normalizedPathname = normalizePathname(pathname)

  if (REGISTERED_EXACT_PATHS.has(normalizedPathname)) return normalizedPathname
  if (REGISTERED_DYNAMIC_PATTERNS.some((pattern) => pattern.test(normalizedPathname))) {
    return normalizedPathname
  }

  for (const { match, build } of DYNAMIC_PREFIX_FALLBACKS) {
    const matched = normalizedPathname.match(match)
    if (matched) return build(matched[1])
  }

  for (const [prefix, target] of Object.entries(SECTION_PREFIX_FALLBACKS)) {
    if (normalizedPathname.startsWith(prefix)) return target
  }

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
        <Route path="/palaces/quiz" element={<Navigate to="/palaces" replace />} />
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
        <Route path="/review/feedback-preview" element={<ReviewFeedbackPreviewRoute />} />
        <Route path="/review/session/:id" element={<ReviewSessionPage />} />
        <Route path="/segment-review/session/:id" element={<SegmentReviewSessionPage />} />
        <Route path="/segment-review/batch" element={<BatchSegmentReviewSessionPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/feedback" element={<ProfileFeedbackPage />} />
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
