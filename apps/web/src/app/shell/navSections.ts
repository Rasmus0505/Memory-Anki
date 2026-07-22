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
    rememberLastVisited: false,
    matches: (pathname) =>
      pathname === '/freestyle' ||
      pathname === '/freestyle/session' ||
      isPracticeRoute(pathname),
    warmup: () => {
      void preloadFreestylePage()
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
    // Always open a fresh create route. Remembering the last /palaces/:id/edit
    // made "创建" reopen the previous palace and blocked starting a new one.
    rememberLastVisited: false,
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
