import {
  BookOpen,
  Brain,
  FolderTree,
  LayoutDashboard,
  Shuffle,
  User,
} from 'lucide-react'
import {
  prefetchPalacesGroupedSummaryApi,
  prefetchPalaceSubjectShelfApi,
} from '@/entities/palace/api'
import {
  preloadEnglishReadingPage,
  preloadEnglishWorkspacePage,
  preloadFreestylePage,
  preloadFreestyleSessionPage,
  preloadKnowledgePage,
  preloadPalaceEditPage,
  preloadPracticeRoutes,
  preloadProfilePage,
  preloadReviewRoutes,
} from '@/app/router/appRoutes'
import { prefetchDashboardApi } from '@/features/dashboard/api'
import { prefetchReviewQueueApi } from '@/features/review/api'

export type NavSectionKey =
  | 'freestyle'
  | 'palaces'
  | 'knowledge'
  | 'review'
  | 'profile'

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
  /^\/palaces\/\d+\/(practice|focus-practice)$/.test(pathname) ||
  /^\/segments\/\d+\/practice$/.test(pathname) ||
  /^\/mini-palaces\/\d+\/practice$/.test(pathname)

const isCreationRoute = (pathname: string) =>
  pathname === '/palaces/new' ||
  /^\/palaces\/\d+\/(edit|quiz)$/.test(pathname)

const isLibraryRoute = (pathname: string) =>
  pathname === '/palaces' ||
  pathname === '/palaces/list' ||
  /^\/palaces\/\d+$/.test(pathname) ||
  pathname === '/knowledge' ||
  pathname.startsWith('/knowledge/') ||
  pathname === '/english' ||
  pathname.startsWith('/english/') ||
  pathname === '/english-reading' ||
  pathname.startsWith('/english-reading/')

export const navSections: NavSectionDefinition[] = [
  {
    key: 'freestyle',
    to: '/freestyle',
    label: '今日学习',
    icon: Shuffle,
    rememberLastVisited: false,
    matches: (pathname) =>
      pathname === '/freestyle' ||
      pathname === '/freestyle/session' ||
      isPracticeRoute(pathname),
    warmup: () => {
      void preloadFreestylePage()
      void preloadFreestyleSessionPage()
      preloadPracticeRoutes()
      preloadReviewRoutes()
      prefetchReviewQueueApi()
    },
  },
  {
    key: 'palaces',
    to: '/palaces',
    label: '知识库',
    icon: BookOpen,
    rememberLastVisited: true,
    matches: isLibraryRoute,
    warmup: () => {
      prefetchPalaceSubjectShelfApi()
      prefetchPalacesGroupedSummaryApi()
      void preloadKnowledgePage()
      void preloadEnglishWorkspacePage()
      void preloadEnglishReadingPage()
    },
  },
  {
    key: 'knowledge',
    to: '/palaces/new',
    label: '内容创作',
    icon: FolderTree,
    rememberLastVisited: true,
    matches: isCreationRoute,
    warmup: () => {
      void preloadPalaceEditPage()
    },
  },
  {
    key: 'review',
    to: '/dashboard',
    label: '复习分析',
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
  {
    key: 'profile',
    to: '/profile',
    label: '系统设置',
    icon: User,
    rememberLastVisited: true,
    matches: (pathname) => pathname === '/profile' || pathname.startsWith('/profile/'),
    warmup: () => {
      void preloadProfilePage()
    },
  },
]
