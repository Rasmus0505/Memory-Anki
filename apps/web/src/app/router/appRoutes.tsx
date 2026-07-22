import { Suspense } from 'react'
import { Navigate, Route, Routes, useParams, useSearchParams, type Location } from 'react-router-dom'
import { RouteErrorBoundary } from '@/app/providers/RouteErrorBoundary'
import { LoadingState } from '@/shared/components/state-placeholders'
import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'
import DashboardPage from '@/pages/insights/InsightsPage'
import PalaceListPage from '@/pages/library/PalaceListPage'
import PalaceShelfPage from '@/pages/library/PalaceLibraryPage'
import ReviewOverviewPage from '@/app/router/review/ReviewOverview'
import { readLastPageHistoryWorkspacePath } from '@/shared/page-history/pageHistoryStore'

export const preloadPalaceViewPage = () => import('@/app/router/PalaceViewPage')
/** Immersive freestyle card feed — default /freestyle entry. */
export const preloadFreestylePage = () => import('@/pages/today/ImmersiveFreestylePage')
/** @deprecated Alias kept for call sites that still preload the old session path. */
export const preloadFreestyleSessionPage = preloadFreestylePage
/** Today learning workspace (overview) — route /today. */
export const preloadTodayLearningPage = () => import('@/pages/today/TodayLearningPage')
export const preloadKnowledgePage = () => import('@/pages/library/KnowledgeLibraryPage')
export const preloadEnglishHubPage = () => import('@/pages/library/EnglishHubPage')
export const preloadEnglishWorkspacePage = () => import('@/pages/library/EnglishLibraryPage')
export const preloadEnglishCoursePage = () => import('@/pages/library/EnglishCoursePage')
export const preloadEnglishReadingPage = () => import('@/pages/library/EnglishReadingPage')
export const preloadEnglishPatternsPage = () => import('@/pages/library/EnglishPatternsPage')
export const preloadEnglishVocabPage = () => import('@/pages/library/EnglishVocabPage')
export const preloadPalaceEditPage = () => import('@/pages/create/PalaceEditorPage')
export const preloadPalaceQuizPage = () => import('@/pages/create/QuizWorkspacePage')
export const preloadBatchGenerationPage = () => import('@/pages/create/BatchGenerationWorkspacePage')
export const preloadProfilePage = () => import('@/pages/settings/SettingsOverviewPage')
export const preloadReviewSessionPage = () => import('@/app/router/review/ReviewSession')
export const preloadReviewCompletionPage = () => import('@/app/router/review/ReviewCompletion')
export const preloadPalacePracticePage = () => import('@/app/router/PalacePracticePage')
export const preloadSegmentPracticePage = () => import('@/app/router/SegmentPracticePage')

export function preloadReviewRoutes() {
  void preloadReviewSessionPage()
}

export function preloadPracticeRoutes() {
  void preloadPalaceEditPage()
  void preloadPalaceViewPage()
  void preloadPalaceQuizPage()
  void preloadPalacePracticePage()
  void preloadSegmentPracticePage()
}

const KnowledgePage = lazyWithRetry(preloadKnowledgePage)
const FreestylePage = lazyWithRetry(preloadFreestylePage)
const TodayLearningPage = lazyWithRetry(preloadTodayLearningPage)
const EnglishHubPage = lazyWithRetry(preloadEnglishHubPage)
const EnglishWorkspacePage = lazyWithRetry(preloadEnglishWorkspacePage)
const EnglishCoursePage = lazyWithRetry(preloadEnglishCoursePage)
const EnglishReadingPage = lazyWithRetry(preloadEnglishReadingPage)
const EnglishPatternsPage = lazyWithRetry(preloadEnglishPatternsPage)
const EnglishVocabPage = lazyWithRetry(preloadEnglishVocabPage)

function EnglishLegacyTabRedirect() {
  const [searchParams] = useSearchParams()
  const tab = searchParams.get('tab')
  if (tab === 'reading') return <Navigate to="/english/reading" replace />
  if (tab === 'patterns') return <Navigate to="/english/patterns" replace />
  if (tab === 'vocab') return <Navigate to="/english/vocab" replace />
  if (tab === 'listening') return <Navigate to="/english/listening" replace />
  return <EnglishHubPage />
}

function EnglishReadingLegacyRedirect() {
  const [searchParams] = useSearchParams()
  const material = searchParams.get('material')
  if (material && /^\d+$/.test(material)) {
    return <Navigate to={`/english/reading/materials/${material}`} replace />
  }
  return <Navigate to="/english/reading" replace />
}

function EnglishCourseLegacyRedirect() {
  const { id } = useParams()
  if (!id) return <Navigate to="/english/listening" replace />
  return <Navigate to={`/english/listening/courses/${id}`} replace />
}
const PalaceEditPage = lazyWithRetry(preloadPalaceEditPage)
const PalaceViewPage = lazyWithRetry(preloadPalaceViewPage)
const PalaceQuizPage = lazyWithRetry(preloadPalaceQuizPage)
const BatchGenerationPage = lazyWithRetry(preloadBatchGenerationPage)
const ProfilePage = lazyWithRetry(preloadProfilePage)
const ProfileFeedbackPage = lazyWithRetry(() => import('@/pages/settings/FeedbackSettingsPage'))
const ProfileTimerPage = lazyWithRetry(() => import('@/pages/settings/TimerSettingsPage'))
const ProfileAiPage = lazyWithRetry(() => import('@/pages/settings/AiSettingsPage'))
const ProfileBackupsPage = lazyWithRetry(
  () => import('@/pages/settings/BackupSettingsPage'),
)
const ReviewSessionPage = lazyWithRetry(preloadReviewSessionPage)
const ReviewCompletionPage = lazyWithRetry(preloadReviewCompletionPage)
const PalacePracticePage = lazyWithRetry(preloadPalacePracticePage)
const SegmentPracticePage = lazyWithRetry(preloadSegmentPracticePage)
const ReviewFeedbackPreviewRoute = lazyWithRetry(
  () => import('@/app/router/ReviewFeedbackPreviewRoute'),
)
const DevTokensPage = lazyWithRetry(() => import('@/app/dev/DevTokensPage'))

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
  '/dashboard',
  '/freestyle',
  '/freestyle/session',
  '/today',
  '/knowledge',
  '/english',
  '/english/listening',
  '/english/reading',
  '/english/patterns',
  '/english/vocab',
  '/english-reading',
  '/palaces',
  '/palaces/list',
  '/palaces/new',
  '/review',
  '/profile',
  '/profile/timer',
  '/profile/feedback',
  '/profile/ai',
  '/profile/backups',
  '/timer-overlay',
])

// 已注册的动态段路由（命中后保留原路径）。仅匹配到主段，不含未知后代。
const REGISTERED_DYNAMIC_PATTERNS = [
  /^\/palaces\/\d+(?:\/(edit|practice|quiz))?$/,
  /^\/segments\/\d+\/practice$/,
  /^\/english\/courses\/\d+$/,
  /^\/english\/listening\/courses\/\d+$/,
  /^\/english\/reading\/materials\/\d+$/,
  /^\/review\/session\/\d+$/,
  /^\/review\/completed\/\d+$/,
]

// 动态段路由的"前缀提取"：命中已注册动态段的未知后代时，回退到主段。
// 例：/palaces/42/unknown → /palaces/42；/review/session/9/x → /review/session/9。
const DYNAMIC_PREFIX_FALLBACKS = [
  { match: /^\/palaces\/(\d+)(?:\/.*)?$/, build: (id: string) => `/palaces/${id}` },
  {
    match: /^\/english\/listening\/courses\/(\d+)(?:\/.*)?$/,
    build: (id: string) => `/english/listening/courses/${id}`,
  },
  { match: /^\/english\/courses\/(\d+)(?:\/.*)?$/, build: (id: string) => `/english/courses/${id}` },
  {
    match: /^\/english\/reading\/materials\/(\d+)(?:\/.*)?$/,
    build: (id: string) => `/english/reading/materials/${id}`,
  },
  { match: /^\/review\/session\/(\d+)(?:\/.*)?$/, build: (id: string) => `/review/session/${id}` },
  { match: /^\/segments\/(\d+)\/practice(?:\/.*)?$/, build: (id: string) => `/segments/${id}/practice` },
]

// 顶层 section 前缀：未知的子路径回退到 section 入口。
const SECTION_PREFIX_FALLBACKS: Record<string, string> = {
  '/knowledge/': '/knowledge',
  '/freestyle/': '/freestyle',
  '/profile/': '/profile',
  '/review/': '/review',
  '/english-reading/': '/english/reading',
  '/english/': '/english',
  '/palaces/': '/palaces',
  '/timer-overlay/': '/timer-overlay',
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

  return '/freestyle'
}

function RouteNotFound({ pathname }: { pathname: string }) {
  const target = resolveRouteFallbackTarget(pathname)
  return <Navigate to={target} replace />
}

function StartupRedirect() {
  return <Navigate to={readLastPageHistoryWorkspacePath() || '/freestyle'} replace />
}

export function AppRoutes({ location }: { location?: Location }) {
  const fallbackPathname = location?.pathname || '/'
  return (
    <Suspense fallback={<RouteFallback />}>
      <RouteErrorBoundary resetKey={fallbackPathname}>
        <Routes location={location}>
          <Route path="/" element={<StartupRedirect />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/freestyle" element={<FreestylePage />} />
          <Route path="/freestyle/session" element={<Navigate to="/freestyle" replace />} />
          <Route path="/today" element={<TodayLearningPage />} />
          <Route path="/palaces" element={<PalaceShelfPage />} />
          <Route path="/english" element={<EnglishLegacyTabRedirect />} />
          <Route path="/english/listening" element={<EnglishWorkspacePage />} />
          <Route path="/english/listening/courses/:id" element={<EnglishCoursePage />} />
          <Route path="/english/reading" element={<EnglishReadingPage />} />
          <Route path="/english/reading/materials/:materialId" element={<EnglishReadingPage />} />
          <Route path="/english/patterns" element={<EnglishPatternsPage />} />
          <Route path="/english/vocab" element={<EnglishVocabPage />} />
          <Route path="/english-reading" element={<EnglishReadingLegacyRedirect />} />
          <Route
            path="/english/courses/:id"
            element={<EnglishCourseLegacyRedirect />}
          />
          <Route path="/palaces/list" element={<PalaceListPage />} />
          <Route path="/palaces/new" element={<PalaceEditPage />} />
          <Route path="/batch-generation" element={<BatchGenerationPage />} />
          {/* 保留：若删除此行，/palaces/quiz 会被下面的 /palaces/:id 捕获并落到 NaN 坏页。 */}
          <Route path="/palaces/quiz" element={<Navigate to="/palaces" replace />} />
          <Route path="/palaces/:id" element={<PalaceViewPage />} />
          <Route path="/palaces/:id/quiz" element={<PalaceQuizPage />} />
          <Route path="/palaces/:id/practice" element={<PalacePracticePage />} />
          <Route path="/segments/:id/practice" element={<SegmentPracticePage />} />
          <Route path="/palaces/:id/edit" element={<PalaceEditPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/review" element={<ReviewOverviewPage />} />
          <Route path="/review/feedback-preview" element={<ReviewFeedbackPreviewRoute />} />
          <Route path="/review/session/:id" element={<ReviewSessionPage />} />
          <Route path="/review/completed/:reviewLogId" element={<ReviewCompletionPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/timer" element={<ProfileTimerPage />} />
          <Route path="/profile/feedback" element={<ProfileFeedbackPage />} />
          <Route path="/profile/ai" element={<ProfileAiPage />} />
          <Route path="/profile/backups" element={<ProfileBackupsPage />} />
          {import.meta.env.DEV ? <Route path="/dev/tokens" element={<DevTokensPage />} /> : null}
          <Route path="*" element={<RouteNotFound pathname={fallbackPathname} />} />
        </Routes>
      </RouteErrorBoundary>
    </Suspense>
  )
}
