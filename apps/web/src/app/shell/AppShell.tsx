import { useEffect, useState, type PropsWithChildren } from 'react'
import {
  BookOpen,
  BookOpenText,
  Captions,
  Brain,
  ChevronRight,
  ClipboardList,
  Cloud,
  CloudAlert,
  FolderTree,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  User,
  X,
} from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import type { RuntimeInfo } from '@/shared/api/contracts'
import { getRuntimeInfoApi } from '@/shared/api/modules/runtime'
import { prefetchPalaceSubjectShelfApi } from '@/shared/api/modules/palaces'
import { ShellProvider, useShellContext } from '@/shared/components/layout/ShellContext'
import { useClientPreferenceBootstrap } from '@/shared/preferences/useClientPreferenceBootstrap'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { AppLogDrawer } from '@/shared/logs/components/AppLogDrawer'
import { MutationQueueDrawer } from '@/shared/persistence/components/MutationQueueDrawer'
import { useMutationQueueState } from '@/shared/persistence/useMutationQueue'
import { useRunningTaskCountBySection, type BackgroundTaskSection } from '@/shared/background-tasks/backgroundTaskRegistry'
import { BackgroundTaskBar } from '@/shared/background-tasks/BackgroundTaskBar'
import { QuizGenerationBubbleLayer } from '@/shared/background-tasks/QuizGenerationBubbleLayer'
import { cn } from '@/shared/lib/utils'

type NavSectionKey =
  | 'dashboard'
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
    prefetchPalaceSubjectShelfApi()
  }
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
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [logDrawerOpen, setLogDrawerOpen] = useState(false)
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false)
  const { summary: mutationSummary } = useMutationQueueState()
  const syncHasAttention = mutationSummary.conflict > 0 || mutationSummary.failed > 0 || mutationSummary.manual > 0
  const syncCount = mutationSummary.total

  useClientPreferenceBootstrap()

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

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
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur lg:hidden">
          <div className="flex h-15 items-center justify-between px-4">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-card text-foreground"
              aria-label="打开导航"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex flex-col items-center gap-1">
              <div className="text-sm font-semibold">记忆宫殿</div>
              <RuntimeChannelBadge runtimeInfo={runtimeInfo} compact />
            </div>
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
              <Button
                type="button"
                variant={syncHasAttention ? 'default' : 'outline'}
                size="icon"
                onClick={() => setSyncDrawerOpen(true)}
                aria-label="打开数据同步侧边栏"
                title="打开数据同步侧边栏"
              >
                {syncHasAttention ? <CloudAlert className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </header>

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px]"
              onClick={() => setMobileOpen(false)}
              aria-label="关闭导航遮罩"
            />
            <aside className="relative z-10 flex h-full w-[82vw] max-w-[320px] flex-col border-r border-border/70 bg-background shadow-2xl">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-4">
                <div className="text-sm font-semibold">导航</div>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/70"
                  aria-label="关闭导航"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <SidebarContent runtimeInfo={runtimeInfo} />
            </aside>
          </div>
        ) : null}

        <aside
          className={cn(
            'fixed inset-y-4 left-4 z-20 hidden overflow-hidden rounded-[30px] border border-border/70 bg-background/92 shadow-floating backdrop-blur lg:flex lg:flex-col transition-all duration-300',
            sidebarCollapsed ? 'w-[84px]' : 'w-[250px]',
          )}
        >
          <div className={cn('flex justify-end px-3 pt-3', sidebarCollapsed ? 'pb-1' : 'pb-0')}>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={syncHasAttention ? 'default' : 'outline'}
                size="icon"
                onClick={() => setSyncDrawerOpen(true)}
                aria-label="打开数据同步侧边栏"
                title={syncCount > 0 ? `待同步 ${syncCount} 项` : '数据已同步'}
              >
                {syncHasAttention ? <CloudAlert className="h-4 w-4" /> : <Cloud className="h-4 w-4" />}
              </Button>
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
            sidebarCollapsed ? 'lg:pl-[122px]' : 'lg:pl-[282px]',
          )}
        >
          <div className="mx-auto w-full max-w-[1700px] px-3 py-3 sm:px-5 sm:py-5 lg:px-6 lg:py-6 xl:px-8">
            <BackgroundTaskBar />
            {children}
          </div>
        </main>
        <QuizGenerationBubbleLayer />
        <AppLogDrawer open={logDrawerOpen} onOpenChange={setLogDrawerOpen} />
        <MutationQueueDrawer open={syncDrawerOpen} onOpenChange={setSyncDrawerOpen} />
      </div>
    </ShellProvider>
  )
}

export function AppShell({ children }: PropsWithChildren) {
  return <ShellFrame>{children}</ShellFrame>
}
