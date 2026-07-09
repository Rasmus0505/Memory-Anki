import {
  BookOpen,
  BookOpenText,
  Brain,
  Captions,
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
  preloadKnowledgePage,
  preloadPracticeRoutes,
  preloadProfilePage,
  preloadReviewRoutes,
} from '@/app/router/appRoutes'
import { prefetchDashboardApi } from '@/features/dashboard/api'
import { prefetchReviewQueueApi } from '@/features/review/api'

export type NavSectionKey =
  | 'dashboard'
  | 'freestyle'
  | 'palaces'
  | 'english'
  | 'englishReading'
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

export const navSections: NavSectionDefinition[] = [
  {
    key: 'dashboard',
    to: '/dashboard',
    label: '仪表盘',
    icon: LayoutDashboard,
    rememberLastVisited: false,
    matches: (pathname) => pathname === '/' || pathname === '/dashboard',
    warmup: () => {
      prefetchDashboardApi()
    },
  },
  {
    key: 'freestyle',
    to: '/freestyle',
    label: '随心模式',
    icon: Shuffle,
    rememberLastVisited: false,
    matches: (pathname) => pathname === '/freestyle',
    warmup: () => {
      void preloadFreestylePage()
    },
  },
  {
    key: 'palaces',
    to: '/palaces',
    label: '记忆宫殿',
    icon: BookOpen,
    rememberLastVisited: true,
    matches: (pathname) =>
      pathname === '/palaces' ||
      pathname === '/palaces/list' ||
      pathname === '/palaces/new' ||
      /^\/palaces\/\d+(?:\/(edit|practice|focus-practice|quiz))?$/.test(pathname),
    warmup: () => {
      preloadPracticeRoutes()
      prefetchPalaceSubjectShelfApi()
      prefetchPalacesGroupedSummaryApi()
    },
  },
  {
    key: 'english',
    to: '/english',
    label: '英语听力',
    icon: Captions,
    rememberLastVisited: true,
    matches: (pathname) =>
      pathname === '/english' || /^\/english\/courses\/\d+$/.test(pathname),
    warmup: () => {
      void preloadEnglishWorkspacePage()
    },
  },
  {
    key: 'englishReading',
    to: '/english-reading',
    label: '英语阅读',
    icon: BookOpenText,
    rememberLastVisited: true,
    matches: (pathname) => pathname === '/english-reading',
    warmup: () => {
      void preloadEnglishReadingPage()
    },
  },
  {
    key: 'knowledge',
    to: '/knowledge',
    label: '知识大纲',
    icon: FolderTree,
    rememberLastVisited: true,
    matches: (pathname) => pathname === '/knowledge' || pathname.startsWith('/knowledge/'),
    warmup: () => {
      void preloadKnowledgePage()
    },
  },
  {
    key: 'review',
    to: '/review',
    label: '复习',
    icon: Brain,
    rememberLastVisited: true,
    matches: (pathname) =>
      pathname === '/review' ||
      /^\/review\/session\/\d+$/.test(pathname),
    warmup: () => {
      preloadReviewRoutes()
      prefetchReviewQueueApi()
    },
  },
  {
    key: 'profile',
    to: '/profile',
    label: '个人中心',
    icon: User,
    rememberLastVisited: true,
    matches: (pathname) => pathname === '/profile' || pathname.startsWith('/profile/'),
    warmup: () => {
      void preloadProfilePage()
    },
  },
]
