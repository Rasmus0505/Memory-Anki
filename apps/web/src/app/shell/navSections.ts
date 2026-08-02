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
  preloadDashboardPage,
  preloadPalaceListPage,
  preloadPalaceShelfPage,
  preloadPalaceEditPage,
  preloadPracticeRoutes,
} from '@/app/router/appRoutes'
import { prefetchDashboardApi } from '@/modules/dashboard/public'
// 路径归属规则统一由 routeManifest 派生（新增路由请在 manifest 登记）。
import { createNavSectionMatcher, type NavSectionKey } from '@/shared/routing/routeManifest'

export type { NavSectionKey }

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
    key: 'freestyle',
    to: '/freestyle',
    label: '随心',
    icon: Shuffle,
    // Restore last freestyle/practice URL when switching back from another section.
    // Clicking 随心 again while already active still returns to /freestyle (section root).
    rememberLastVisited: true,
    matches: createNavSectionMatcher('freestyle'),
    warmup: () => {
      void preloadFreestylePage()
      void preloadTodayLearningPage()
      preloadPracticeRoutes()
    },
  },
  {
    key: 'palaces',
    to: '/palaces',
    label: '知识',
    icon: BookOpen,
    rememberLastVisited: true,
    matches: createNavSectionMatcher('palaces'),
    warmup: () => {
      prefetchPalaceSubjectShelfApi()
      prefetchPalacesGroupedSummaryApi()
      void preloadPalaceShelfPage()
      void preloadPalaceListPage()
      void preloadKnowledgePage()
    },
  },
  {
    key: 'english',
    to: '/english',
    label: '英语',
    icon: Languages,
    rememberLastVisited: true,
    matches: createNavSectionMatcher('english'),
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
    matches: createNavSectionMatcher('knowledge'),
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
    // /today（今日工作台）也归属洞察分区，与页面历史的 dashboard 归类一致。
    rememberLastVisited: true,
    matches: createNavSectionMatcher('review'),
    warmup: () => {
      prefetchDashboardApi()
      void preloadDashboardPage()
    },
  },
]
