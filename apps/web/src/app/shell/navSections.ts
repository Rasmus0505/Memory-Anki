import {
  BookOpen,
  Brain,
  FolderTree,
  Languages,
  LayoutDashboard,
  Shuffle,
} from 'lucide-react'
import {
  prefetchPalacesGroupedSummaryApi,
  prefetchPalaceSubjectShelfApi,
} from '@/modules/content/public'
import {
  preloadEnglishHubPage,
  preloadEnglishReadingPage,
  preloadEnglishPatternsPage,
  preloadEnglishVocabPage,
  preloadEnglishWorkspacePage,
  preloadFreestylePage,
  preloadTodayLearningPage,
  preloadKnowledgePage,
  preloadPalaceEditPage,
  preloadPracticeRoutes,
  preloadReviewRoutes,
} from '@/app/router/appRoutes'
import { prefetchDashboardApi } from '@/modules/dashboard/public'
import { prefetchReviewQueueApi } from '@/modules/practice/public'

export type NavSectionKey =
  | 'freestyle'
  | 'palaces'
  | 'english'
  | 'knowledge'
  | 'review'

export interface NavSectionDefinition {
  key: NavSectionKey
  to: string
  label: string
  icon: typeof LayoutDashboard
  rememberLastVisited: boolean
  matches: (pathname: string) => boolean
  warmup?: () => void
}

const isPracticeRoute = (pathname: string) =>
  /^\/palaces\/\d+\/practice$/.test(pathname) ||
  /^\/segments\/\d+\/practice$/.test(pathname)

const isCreationRoute = (pathname: string) =>
  pathname === '/palaces/new' ||
  pathname === '/batch-generation' ||
  /^\/palaces\/\d+\/(edit|quiz)$/.test(pathname)

const isLibraryRoute = (pathname: string) =>
  pathname === '/palaces' ||
  pathname === '/palaces/list' ||
  /^\/palaces\/\d+$/.test(pathname) ||
  pathname === '/knowledge' ||
  pathname.startsWith('/knowledge/')

export const navSections: NavSectionDefinition[] = [
  {
    key: 'freestyle',
    to: '/freestyle',
    label: '随心',
    icon: Shuffle,
    // Restore last freestyle/practice URL when switching back from another section.
    // Clicking 随心 again while already active still returns to /freestyle (section root).
    rememberLastVisited: true,
    matches: (pathname) =>
      pathname === '/freestyle' ||
      pathname === '/freestyle/session' ||
      isPracticeRoute(pathname),
    warmup: () => {
      void preloadFreestylePage()
      void preloadTodayLearningPage()
      preloadPracticeRoutes()
      preloadReviewRoutes()
      prefetchReviewQueueApi()
    },
  },
  {
    key: 'palaces',
    to: '/palaces',
    label: '知识',
    icon: BookOpen,
    rememberLastVisited: true,
    matches: isLibraryRoute,
    warmup: () => {
      prefetchPalaceSubjectShelfApi()
      prefetchPalacesGroupedSummaryApi()
      void preloadKnowledgePage()
    },
  },
  {
    key: 'english',
    to: '/english',
    label: '英语',
    icon: Languages,
    rememberLastVisited: true,
    matches: (pathname) =>
      pathname === '/english' ||
      pathname.startsWith('/english/') ||
      pathname === '/english-reading' ||
      pathname.startsWith('/english-reading/'),
    warmup: () => {
      void preloadEnglishHubPage()
      void preloadEnglishWorkspacePage()
      void preloadEnglishReadingPage()
      void preloadEnglishPatternsPage()
      void preloadEnglishVocabPage()
    },
  },
  {
    key: 'knowledge',
    to: '/palaces/new',
    label: '创建',
    icon: FolderTree,
    // Remember the last create/edit/quiz URL when leaving this section.
    // Clicking 创建 again while already active returns to /palaces/new for a fresh draft.
    rememberLastVisited: true,
    matches: isCreationRoute,
    warmup: () => {
      void preloadPalaceEditPage()
    },
  },
  {
    key: 'review',
    to: '/dashboard',
    label: '洞察',
    icon: Brain,
    // Remember dashboard vs review-queue (and other insight routes) when switching sections.
    // Active review sessions are normalized to the dashboard hub; clicking 洞察 again
    // while already active returns to /dashboard so the hub remains one click away.
    rememberLastVisited: true,
    matches: (pathname) =>
      pathname === '/' ||
      pathname === '/dashboard' ||
      pathname === '/review' ||
      pathname.startsWith('/review/'),
    warmup: () => {
      prefetchDashboardApi()
      preloadReviewRoutes()
      prefetchReviewQueueApi()
    },
  },
]
