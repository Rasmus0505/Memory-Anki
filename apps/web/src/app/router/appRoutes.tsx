import { Suspense } from 'react'
import { Navigate, Route, Routes, useParams, useSearchParams, type Location } from 'react-router-dom'
import { RouteErrorBoundary } from '@/app/providers/RouteErrorBoundary'
import { LoadingState } from '@/shared/components/state-placeholders'
import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'
import { readLastPageHistoryWorkspacePath } from '@/shared/page-history/pageHistoryStore'
import { resolveRouteFallbackTarget } from '@/shared/routing/routeManifest'

export const preloadPalaceViewPage = () => import('@/app/router/PalaceViewPage')
export const preloadDashboardPage = () => import('@/pages/insights/InsightsPage')
export const preloadPalaceListPage = () => import('@/pages/library/PalaceListPage')
export const preloadPalaceShelfPage = () => import('@/pages/library/PalaceLibraryPage')
export const preloadReviewOverviewPage = () => import('@/app/router/review/ReviewOverview')
/** Immersive freestyle card feed — default /freestyle entry. */
export const preloadFreestylePage = () => import('@/pages/today/ImmersiveFreestylePage')
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

export function preloadReviewRoutes() {
  void preloadReviewOverviewPage()
  void preloadReviewSessionPage()
}

export function preloadPracticeRoutes() {
  void preloadPalaceEditPage()
  void preloadPalaceViewPage()
  void preloadPalaceQuizPage()
  void preloadPalacePracticePage()
}

const KnowledgePage = lazyWithRetry(preloadKnowledgePage)
const DashboardPage = lazyWithRetry(preloadDashboardPage)
const PalaceListPage = lazyWithRetry(preloadPalaceListPage)
const PalaceShelfPage = lazyWithRetry(preloadPalaceShelfPage)
const ReviewOverviewPage = lazyWithRetry(preloadReviewOverviewPage)
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
const ReviewFeedbackPreviewRoute = lazyWithRetry(
  () => import('@/app/router/ReviewFeedbackPreviewRoute'),
)
const DevTokensPage = lazyWithRetry(() => import('@/app/dev/DevTokensPage'))

function RouteFallback() {
  return <LoadingState text="正在加载页面…" />
}

// 路由注册清单与回退规则统一在 @/shared/routing/routeManifest 维护；
// 这里保留 re-export 以维持既有调用方与测试的导入路径。
export { resolveRouteFallbackTarget }

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
