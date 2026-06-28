import { useEffect, useState, type PropsWithChildren } from 'react'
import {
  BookOpen,
  BookOpenText,
  Captions,
  Brain,
  ChevronRight,
  ClipboardList,
  FolderTree,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Shuffle,
  User,
} from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import type { RuntimeInfo } from '@/shared/api/contracts'
import { getRuntimeInfoApi } from '@/entities/runtime/api/runtimeApi'
import {
  prefetchPalacesGroupedSummaryApi,
  prefetchPalaceSubjectShelfApi,
} from '@/entities/palace/api'
import {
  preloadEnglishReadingPage,
  preloadEnglishWorkspacePage,
  preloadFreestylePage,
  preloadKnowledgePage,
  preloadPalaceEditPage,
  preloadPracticeRoutes,
  preloadProfilePage,
  preloadReviewRoutes,
} from '@/app/router/appRoutes'
import { prefetchDashboardApi } from '@/features/dashboard/api/dashboardApi'
import {
  prefetchReviewQueueApi,
  prefetchSegmentReviewQueueApi,
} from '@/features/review/api/reviewApi'
import { ShellProvider, useShellContext } from '@/shared/components/layout/ShellContext'
import { useClientPreferenceBootstrap } from '@/app/providers/useClientPreferenceBootstrap'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { AppLogDrawer } from '@/shared/logs/components/AppLogDrawer'
import { useRunningTaskCountBySection, type BackgroundTaskSection } from '@/shared/background-tasks/backgroundTaskRegistry'
import { BackgroundTaskBar } from '@/shared/background-tasks/BackgroundTaskBar'
import { QuizGenerationBubbleLayer } from '@/shared/background-tasks/QuizGenerationBubbleLayer'
import { cn } from '@/shared/lib/utils'

type NavSectionKey =
  | 'dashboard'
  | 'freestyle'
  | 'palaces'
  | 'english'
  | 'englishReading'
  | 'knowledge'
  | 'review'
  | 'profile'

interface NavSectionDefinition {
  key: NavSectionKey
  to: string
  label: string
  icon: typeof LayoutDashboard
  rememberLastVisited: boolean
  matches: (pathname: string) => boolean
}

const navSectionLastUrls: Partial<Record<NavSectionKey, string>> = {}
const warmedNavSections = new Set<NavSectionKey>()

const navSections: NavSectionDefinition[] = [
  {
    key: 'dashboard',
    to: '/',
    label: '仪表盘',
    icon: LayoutDashboard,
    rememberLastVisited: false,
    matches: (pathname) => pathname === '/',
  },
  {
    key: 'freestyle',
    to: '/freestyle',
    label: '随心模式',
    icon: Shuffle,
    rememberLastVisited: false,
    matches: (pathname) => pathname === '/freestyle',
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
  },
  {
    key: 'english',
    to: '/english',
    label: '英语听力',
    icon: Captions,
    rememberLastVisited: true,
    matches: (pathname) =>
      pathname === '/english' || /^\/english\/courses\/\d+$/.test(pathname),
  },
  {
    key: 'englishReading',
    to: '/english-reading',
    label: '英语阅读',
    icon: BookOpenText,
    rememberLastVisited: true,
    matches: (pathname) => pathname === '/english-reading',
  },
  {
    key: 'knowledge',
    to: '/knowledge',
    label: '知识大纲',
    icon: FolderTree,
    rememberLastVisited: true,
    matches: (pathname) => pathname === '/knowledge' || pathname.startsWith('/knowledge/'),
  },
  {
    key: 'review',
    to: '/review',
    label: '复习',
    icon: Brain,
    rememberLastVisited: true,
    matches: (pathname) =>
      pathname === '/review' ||
      /^\/review\/session\/\d+$/.test(pathname) ||
      /^\/segment-review\/session\/\d+$/.test(pathname) ||
      pathname === '/segment-review/batch' ||
      /^\/mini-review\/session\/\d+$/.test(pathname),
  },
  {
    key: 'profile',
    to: '/profile',
    label: '个人中心',
    icon: User,
    rememberLastVisited: true,
    matches: (pathname) => pathname === '/profile' || pathname.startsWith('/profile/'),
  },
]

function findNavSection(pathname: string) {
  return navSections.find((section) => section.matches(pathname)) ?? null
}

function resolveNavSectionTarget(section: NavSectionDefinition) {
  if (!section.rememberLastVisited) return section.to
  return navSectionLastUrls[section.key] ?? section.to
}

export function resetNavSectionHistoryForTest() {
  for (const key of Object.keys(navSectionLastUrls) as NavSectionKey[]) {
    delete navSectionLastUrls[key]
  }
  warmedNavSections.clear()
}

function warmNavSection(section: NavSectionDefinition) {
  if (warmedNavSections.has(section.key)) return
  warmedNavSections.add(section.key)
  if (section.key === 'palaces') {
    preloadPracticeRoutes()
    prefetchPalaceSubjectShelfApi()
    prefetchPalacesGroupedSummaryApi()
  }
  if (section.key === 'dashboard') {
    prefetchDashboardApi()
  }
  if (section.key === 'freestyle') {
    void preloadFreestylePage()
  }
  if (section.key === 'review') {
    preloadReviewRoutes()
    prefetchReviewQueueApi()
    prefetchSegmentReviewQueueApi()
  }
  if (section.key === 'english') {
    void preloadEnglishWorkspacePage()
  }
  if (section.key === 'englishReading') {
    void preloadEnglishReadingPage()
  }
  if (section.key === 'knowledge') {
    void preloadKnowledgePage()
  }
  if (section.key === 'profile') {
    void preloadProfilePage()
  }
}

function scheduleIdleWarmup(callback: () => void) {
  if (typeof window === 'undefined') return () => {}
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void) => number
    cancelIdleCallback?: (handle: number) => void
  }
  if (typeof idleWindow.requestIdleCallback === 'function') {
    const handle = idleWindow.requestIdleCallback(callback)
    return () => idleWindow.cancelIdleCallback?.(handle)
  }
  const timeout = window.setTimeout(callback, 0)
  return () => window.clearTimeout(timeout)
}

function RuntimeChannelBadge({
  runtimeInfo,
  compact = false,
}: {
  runtimeInfo: RuntimeInfo | null
  compact?: boolean
}) {
  if (!runtimeInfo) return null
  const isStable = runtimeInfo.channel === 'stable'
  const label = isStable ? 'Stable' : 'Dev'
  const commitText = runtimeInfo.short_commit ?? runtimeInfo.commit?.slice(0, 8) ?? null
  return (
    <Badge
      variant="outline"
      className={cn(
        'border font-mono tracking-[0.08em]',
        isStable
          ? 'border-success/30 bg-success/5 text-success'
          : 'border-info/30 bg-info/5 text-info',
        compact ? 'px-2 py-0 text-[10px]' : 'px-2.5 py-0.5 text-[11px]',
      )}
      aria-label={`当前版本 ${label}${commitText ? ` ${commitText}` : ''}`}
    >
      {label}
      {commitText ? ` ${commitText}` : ''}
    </Badge>
  )
}

function NavSectionLink({
  section,
  pathname,
  compact,
}: {
  section: NavSectionDefinition
  pathname: string
  compact: boolean
}) {
  const { to, label, icon: Icon } = section
  const target = resolveNavSectionTarget(section)
  const isActive = section.matches(pathname)
  const runningCount = useRunningTaskCountBySection(
    section.key as BackgroundTaskSection,
  )
  return (
    <NavLink
      to={target}
      end={to === '/'}
      className={cn(
        'group relative flex items-center rounded-2xl text-sm font-medium transition-all',
        isActive
          ? 'bg-primary text-primary-foreground shadow-card'
          : 'text-muted-foreground hover:bg-secondary/80 hover:text-foreground',
        compact ? 'justify-center px-2.5 py-2.5' : 'gap-3 px-3.5 py-3',
      )}
      onMouseEnter={() => warmNavSection(section)}
      onFocus={() => warmNavSection(section)}
    >
      <Icon className="h-4 w-4" />
      {!compact ? <span>{label}</span> : null}
      {runningCount > 0 ? (
        <span
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
            compact ? 'absolute right-1 top-1' : 'ml-auto',
            isActive
              ? 'bg-primary-foreground/20 text-primary-foreground'
              : 'bg-info text-white',
          )}
          title={`${runningCount} 个后台任务进行中`}
        >
          {runningCount}
        </span>
      ) : null}
      {!compact && runningCount === 0 ? (
        <ChevronRight
          className={cn(
            'ml-auto h-4 w-4 transition-transform',
            isActive
              ? 'translate-x-0'
              : '-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100',
          )}
        />
      ) : null}
    </NavLink>
  )
}

function SidebarContent({ runtimeInfo }: { runtimeInfo: RuntimeInfo | null }) {
  const { pathname, search, hash } = useLocation()
  const shell = useShellContext()
  const compact = shell?.sidebarCollapsed ?? false
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const matchedSection = findNavSection(pathname)
    if (!matchedSection?.rememberLastVisited) return
    navSectionLastUrls[matchedSection.key] = `${pathname}${search}${hash}`
  }, [hash, pathname, search])

  useEffect(() => {
    return scheduleIdleWarmup(() => {
      preloadPracticeRoutes()
      preloadReviewRoutes()
      prefetchPalaceSubjectShelfApi()
      prefetchPalacesGroupedSummaryApi()
      prefetchReviewQueueApi()
      prefetchSegmentReviewQueueApi()
      void preloadFreestylePage()
    })
  }, [])

  useEffect(() => {
    if (pathname !== '/') return
    return scheduleIdleWarmup(() => {
      void preloadPalaceEditPage()
      prefetchDashboardApi()
    })
  }, [pathname])

  const currentDate = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(now)
  const currentTime = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now)

  return (
    <>
      <div className={cn('border-b border-border/70', compact ? 'px-2 py-3' : 'px-5 py-5')}>
        <NavLink to="/" className={cn('flex items-center', compact ? 'justify-center' : 'gap-3')}>
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-base font-semibold text-primary-foreground shadow-sm">
            记
          </div>
          {!compact ? (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">记忆宫殿</div>
              <div className="mt-1 text-xs text-muted-foreground">{currentDate}</div>
              <div className="text-xs font-medium text-foreground/80">{currentTime}</div>
              <div className="mt-2">
                <RuntimeChannelBadge runtimeInfo={runtimeInfo} />
              </div>
              {runtimeInfo ? (
                <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                  <div>数据代际 {runtimeInfo.runtime_generation}</div>
                  <div className="truncate" title={runtimeInfo.app_home}>
                    {runtimeInfo.app_home}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </NavLink>
        {compact ? (
          <div className="mt-2 flex justify-center">
            <RuntimeChannelBadge runtimeInfo={runtimeInfo} compact />
          </div>
        ) : null}
      </div>

      <nav className={cn('flex flex-1 flex-col gap-1', compact ? 'px-2 py-3' : 'px-3 py-4')}>
        {navSections.map((section) => (
          <NavSectionLink
            key={section.to}
            section={section}
            pathname={pathname}
            compact={compact}
          />
        ))}
      </nav>
    </>
  )
}

function ShellFrame({ children }: PropsWithChildren) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [logDrawerOpen, setLogDrawerOpen] = useState(false)

  useClientPreferenceBootstrap()

  useEffect(() => {
    let cancelled = false
    void getRuntimeInfoApi()
      .then((info) => {
        if (!cancelled) {
          setRuntimeInfo(info)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRuntimeInfo(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ShellProvider value={{ sidebarCollapsed, setSidebarCollapsed }}>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.09),_transparent_24%),linear-gradient(180deg,_rgba(248,250,252,0.96),_rgba(255,255,255,1))]">
        <aside
          className={cn(
            'memory-anki-warm-panel fixed inset-y-4 left-4 z-20 flex flex-col overflow-hidden rounded-[32px] border border-border/60 bg-background/90 shadow-floating backdrop-blur-xl transition-all duration-300',
            sidebarCollapsed ? 'w-[84px]' : 'w-[250px]',
          )}
        >
          <div className={cn('flex justify-end px-3 pt-3', sidebarCollapsed ? 'pb-1' : 'pb-0')}>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setLogDrawerOpen(true)}
                aria-label="打开日志侧边栏"
                title="打开日志侧边栏"
              >
                <ClipboardList className="h-4 w-4" />
              </Button>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70 bg-background/80 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={sidebarCollapsed ? '展开导航' : '收起导航'}
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          <div className={sidebarCollapsed ? 'origin-top scale-[0.92]' : ''}>
            <SidebarContent runtimeInfo={runtimeInfo} />
          </div>
        </aside>

        <main
          className={cn(
            'min-w-0 transition-[padding] duration-300',
            sidebarCollapsed ? 'pl-[122px]' : 'pl-[282px]',
          )}
        >
          <div className="mx-auto w-full max-w-[1680px] px-3 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-7 xl:px-8">
            <BackgroundTaskBar />
            {children}
          </div>
        </main>
        <QuizGenerationBubbleLayer />
        <AppLogDrawer open={logDrawerOpen} onOpenChange={setLogDrawerOpen} />
      </div>
    </ShellProvider>
  )
}

export function AppShell({ children }: PropsWithChildren) {
  return <ShellFrame>{children}</ShellFrame>
}
