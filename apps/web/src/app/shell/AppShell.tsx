import { memo, useEffect, useRef, useState, type PropsWithChildren } from 'react'
import {
  ChevronRight,
  ClipboardList,
  Ellipsis,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from 'lucide-react'
import { NavLink, useLocation } from 'react-router-dom'
import type { RuntimeInfo } from '@/shared/api/contracts'
import { getRuntimeInfoApi } from '@/modules/settings/public'
import {
  preloadDashboardPage,
  preloadFreestylePage,
  preloadPalaceEditPage,
  preloadPalaceListPage,
  preloadPalaceShelfPage,
  preloadPracticeRoutes,
  preloadProfilePage,
} from '@/app/router/appRoutes'
import { resolveAppLayoutMode, type AppLayoutMode } from '@/app/router/routeLayoutMeta'
import { prefetchDashboardApi } from '@/modules/dashboard/public'
import { ensureStudyTextLibrary } from '@/shared/study-text/studyTextLibrary'
import { markBoot } from '@/shared/lib/bootTiming'
import { ShellProvider, useShellContext } from '@/shared/components/layout/ShellContext'
import { useClientPreferenceBootstrap } from '@/app/providers/useClientPreferenceBootstrap'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { AppLogDrawer } from '@/shared/logs/components/AppLogDrawer'
import { SESSION_RECORDER_ANCHOR_ATTR, SessionRecorderHost } from '@/shared/debug/session-recorder'
import { useRunningTaskCountBySection, type BackgroundTaskSection } from '@/shared/background-tasks/backgroundTaskRegistry'
import { BackgroundTaskBar } from '@/shared/background-tasks/BackgroundTaskBar'
import { cn } from '@/shared/lib/utils'
import { GlobalCommandPalette } from '@/app/shell/GlobalCommandPalette'
import { useRouteDepthTransition } from '@/app/shell/useRouteDepthTransition'
import { useAmbientTone } from '@/app/shell/useAmbientTone'
import { AmbientLayer } from '@/shared/ambient/AmbientLayer'
import { installUiSounds, playUiSound } from '@/shared/feedback/uiSounds'
import { installPointerLight } from '@/shared/ambient/pointerLight'
import { GlobalBackButton } from '@/app/shell/GlobalBackButton'
import { navSections, type NavSectionDefinition } from '@/app/shell/navSections'
import {
  resolveNavSectionTarget,
  useRememberNavSectionVisit,
  warmNavSection,
} from '@/app/shell/navSectionMemory'

const sidebarDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
})
const sidebarTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

// Sidebar is an icon+label rail below lg and the full column from lg up; collapsing only affects lg.
const sidebarWidthClass = {
  expanded: 'w-(--spacing-shell-rail) lg:w-(--spacing-shell-sidebar)',
  collapsed: 'w-(--spacing-shell-rail) lg:w-(--spacing-shell-sidebar-collapsed)',
} as const

// Content offset past the floating sidebar. Flush hosts (full-window mind map) sit on the sidebar edge.
const contentOffsetClass = {
  inset: {
    expanded: 'md:pl-(--spacing-shell-main-rail) lg:pl-(--spacing-shell-main-sidebar)',
    collapsed: 'md:pl-(--spacing-shell-main-rail) lg:pl-(--spacing-shell-main-collapsed)',
  },
  flush: {
    expanded: 'md:pl-(--spacing-shell-rail) lg:pl-(--spacing-shell-sidebar)',
    collapsed: 'md:pl-(--spacing-shell-rail) lg:pl-(--spacing-shell-sidebar-collapsed)',
  },
} as const

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

const SidebarClock = memo(function SidebarClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <>
      <div className="mt-1 text-xs text-muted-foreground">{sidebarDateFormatter.format(now)}</div>
      <div className="text-xs font-medium text-foreground/80">{sidebarTimeFormatter.format(now)}</div>
    </>
  )
})

function NavSectionLink({
  section,
  pathname,
  collapsed,
}: {
  section: NavSectionDefinition
  pathname: string
  collapsed: boolean
}) {
  const { to, label, icon: Icon } = section
  const isActive = section.matches(pathname)
  const target = resolveNavSectionTarget(section, isActive)
  const runningCount = useRunningTaskCountBySection(
    section.key as BackgroundTaskSection,
  )
  return (
    <NavLink
      to={target}
      end={to === '/'}
      className={cn(
        'group relative flex items-center rounded-xl font-medium transition-[background-color,color,box-shadow] duration-200',
        isActive
          ? 'ma-nav-active bg-primary-soft text-primary-strong shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-primary)_18%,transparent)]'
          : cn(
              'hover:bg-secondary/80 hover:text-foreground',
              section.secondary ? 'text-ink-faint' : 'text-muted-foreground',
            ),
        collapsed
          ? 'justify-center px-2.5 py-2.5 text-sm'
          : 'flex-col justify-center gap-1 px-1 py-2.5 text-[11px] lg:flex-row lg:justify-start lg:gap-3 lg:px-3.5 lg:py-3 lg:text-sm',
      )}
      onMouseEnter={() => warmNavSection(section)}
      onFocus={() => warmNavSection(section)}
    >
      <Icon className="size-4" />
      {!collapsed ? <span className="max-w-full truncate">{label}</span> : null}
      {runningCount > 0 ? (
        <span
          className={cn(
            'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
            collapsed ? 'absolute right-1 top-1' : 'absolute right-1 top-1 lg:static lg:ml-auto',
            isActive
              ? 'bg-primary/15 text-primary'
              : 'bg-info text-info-foreground',
          )}
          title={`${runningCount} 个后台任务进行中`}
        >
          {runningCount}
        </span>
      ) : null}
      {!collapsed && runningCount === 0 ? (
        <ChevronRight
          className={cn(
            'ml-auto hidden size-4 transition-transform lg:block',
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
  const { pathname } = useLocation()
  const shell = useShellContext()
  const collapsed = shell?.sidebarCollapsed ?? false

  useRememberNavSectionVisit()

  useEffect(() => {
    // Page code is not the study library. Load those chunks immediately so a
    // later click does not sit on an empty shell. Do not fetch catalog data
    // here: that races the one text prepare and the first card.
    preloadPracticeRoutes()
    void preloadFreestylePage()
    void preloadDashboardPage()
    void preloadPalaceShelfPage()
    void preloadPalaceListPage()
  }, [])

  useEffect(() => {
    if (resolveAppLayoutMode(pathname) === 'immersive') return
    // The overview page is the earlier sibling of the page content, so this
    // warm starts before that page asks. Other pages wait until text is ready.
    if (pathname === '/' || pathname === '/dashboard') {
      prefetchDashboardApi()
      return
    }
    // Both warmups hit independent endpoints — the dashboard summary never reads
    // the study-text library — so start them together instead of waiting on one
    // before the other leaves.
    void ensureStudyTextLibrary().catch(() => undefined)
    prefetchDashboardApi()
  }, [pathname])

  useEffect(() => {
    if (pathname !== '/' && pathname !== '/dashboard') return
    return scheduleIdleWarmup(() => {
      void preloadPalaceEditPage()
    })
  }, [pathname])

  return (
    <>
      <div className={cn('border-b border-border/70', collapsed ? 'px-2 py-3' : 'px-2 py-3 lg:px-5 lg:py-5')}>
        <NavLink
          to="/freestyle"
          className={cn('flex items-center justify-center', !collapsed && 'lg:justify-start lg:gap-3')}
        >
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground shadow-sm">
            记
          </div>
          <div className={cn('min-w-0', collapsed ? 'hidden' : 'hidden lg:block')}>
            <div className="truncate text-sm font-semibold tracking-tight">Memory Anki</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">沉浸知识工作室</div>
            <SidebarClock />
            <div className="mt-2">
              <RuntimeChannelBadge runtimeInfo={runtimeInfo} />
            </div>
          </div>
        </NavLink>
        <div className={cn('mt-2 justify-center', collapsed ? 'flex' : 'hidden')}>
          <RuntimeChannelBadge runtimeInfo={runtimeInfo} compact />
        </div>
      </div>

      <nav className={cn('flex flex-1 flex-col gap-1', collapsed ? 'px-2 py-3' : 'px-2 py-3 lg:px-3 lg:py-4')}>
        {navSections.map((section) => (
          <NavSectionLink
            key={section.to}
            section={section}
            pathname={pathname}
            collapsed={collapsed}
          />
        ))}
      </nav>

      <div className={cn('border-t border-border/70', collapsed ? 'px-2 py-2' : 'px-2 py-2 lg:px-3 lg:py-3')}>
        <NavLink
          to="/profile"
          onPointerEnter={() => void preloadProfilePage()}
          onFocus={() => void preloadProfilePage()}
          className={({ isActive }) =>
            cn(
              'flex items-center rounded-lg font-medium transition-colors',
              collapsed
                ? 'justify-center px-0 py-2 text-sm'
                : 'flex-col justify-center gap-1 px-1 py-2 text-[11px] lg:flex-row lg:justify-start lg:gap-2.5 lg:px-2.5 lg:text-sm',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
            )
          }
          aria-label="设置"
          title="设置"
        >
          <Settings className="size-4 shrink-0" />
          {!collapsed ? <span className="truncate">设置</span> : null}
        </NavLink>
      </div>
    </>
  )
}

function MobileNavItem({
  to,
  label,
  icon: Icon,
  isActive,
  onWarm,
}: {
  to: string
  label: string
  icon: NavSectionDefinition['icon']
  isActive: boolean
  onWarm: () => void
}) {
  return (
    <NavLink
      to={to}
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-medium transition-colors',
        isActive
          ? 'ma-tab-active bg-primary-soft text-primary-strong'
          : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
      )}
      onFocus={onWarm}
      onTouchStart={onWarm}
    >
      <Icon className="size-4" />
      <span className="max-w-full truncate">{label}</span>
    </NavLink>
  )
}

/**
 * Phone tab bar: four study destinations plus 更多. Seven equal tabs left each
 * one ~50px wide with 11px labels - readable, but crowded and easy to mistap.
 * Everything stays reachable; the secondary flows just live one tap deeper.
 */
const MOBILE_PRIMARY_SECTION_KEYS = ['freestyle', 'palaces', 'english', 'progress'] as const

const mobileOverflowSections = navSections.filter(
  (section) => !(MOBILE_PRIMARY_SECTION_KEYS as readonly string[]).includes(section.key),
)

function MobileMoreSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 pb-[max(env(safe-area-inset-bottom),1rem)]"
        aria-label="更多入口"
      >
        <SheetHeader className="border-b border-border/70 px-5 pb-3 pr-14 pt-5">
          <SheetTitle>更多</SheetTitle>
          <SheetDescription>创建、洞察与设置都从这里进入。</SheetDescription>
        </SheetHeader>
        <nav className="flex flex-col gap-1 px-3 py-3" aria-label="更多入口列表">
          {mobileOverflowSections.map((section) => {
            const Icon = section.icon
            const description = section.key === 'knowledge'
              ? '新建宫殿、知识树与编辑'
              : section.key === 'review'
                ? '考试倒计时、薄弱点与学习动态'
                : ''
            return (
              <SheetClose asChild key={section.key}>
                <NavLink
                  to={section.to}
                  onTouchStart={() => warmNavSection(section)}
                  className="flex min-h-14 items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-secondary/70 active:bg-secondary"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-strong">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{section.label}</span>
                    {description ? (
                      <span className="block truncate text-xs text-muted-foreground">{description}</span>
                    ) : null}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </NavLink>
              </SheetClose>
            )
          })}
          <SheetClose asChild>
            <NavLink
              to="/profile"
              onTouchStart={() => void preloadProfilePage()}
              className="flex min-h-14 items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-secondary/70 active:bg-secondary"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-strong">
                <Settings className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">设置</span>
                <span className="block truncate text-xs text-muted-foreground">偏好、数据与备份</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </NavLink>
          </SheetClose>
        </nav>
      </SheetContent>
    </Sheet>
  )
}

function MobileBottomNav({ layoutMode }: { layoutMode: AppLayoutMode }) {
  const { pathname } = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  useRememberNavSectionVisit()

  // Freestyle owns full-screen chrome; section switch lives in the freestyle HUD menu.
  if (layoutMode === 'immersive') return null

  const primarySections = navSections.filter((section) => (
    MOBILE_PRIMARY_SECTION_KEYS as readonly string[]
  ).includes(section.key))
  const overflowActive = mobileOverflowSections.some((section) => section.matches(pathname))
    || pathname === '/profile' || pathname.startsWith('/profile/')

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border/70 bg-card/96 px-2 pb-[max(env(safe-area-inset-bottom),0.35rem)] pt-1.5 shadow-[0_-10px_34px_color-mix(in_srgb,var(--color-foreground)_12%,transparent)] backdrop-blur-md md:hidden"
        aria-label="移动端主导航"
      >
        {primarySections.map((section) => (
          <MobileNavItem
            key={section.key}
            to={resolveNavSectionTarget(section, section.matches(pathname))}
            label={section.label}
            icon={section.icon}
            isActive={section.matches(pathname)}
            onWarm={() => warmNavSection(section)}
          />
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(
            'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-medium transition-colors',
            overflowActive
              ? 'ma-tab-active bg-primary-soft text-primary-strong'
              : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
          )}
          data-testid="mobile-nav-more"
        >
          <Ellipsis className="size-4" aria-hidden />
          <span className="max-w-full truncate">更多</span>
        </button>
      </nav>
      <MobileMoreSheet open={moreOpen} onOpenChange={setMoreOpen} />
    </>
  )
}

function ShellFrame({ children }: PropsWithChildren) {
  // Start the one text prepare during render so the first card and later pages
  // join the same promise. A failed prepare falls through to the old page loads.
  void ensureStudyTextLibrary().catch(() => undefined)
  const { pathname } = useLocation()
  const layoutMode = resolveAppLayoutMode(pathname)
  const immersiveFeed = layoutMode === 'immersive'
  const mindMapHost = layoutMode !== 'standard'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const [logDrawerOpen, setLogDrawerOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useClientPreferenceBootstrap()
  // 首屏外壳挂载即视为「应用打开」的终点，配合入口打点显示整段启动耗时。
  useEffect(() => {
    markBoot('shell')
  }, [])
  const immersiveRef = useRef(immersiveFeed)
  immersiveRef.current = immersiveFeed
  useEffect(() => installUiSounds(() => immersiveRef.current), [])
  useEffect(() => installPointerLight(), [])
  useRouteDepthTransition({
    rootRef,
    contentRef,
    pathname,
    enabled: layoutMode === 'standard',
    onTransition: () => {
      if (!immersiveRef.current) playUiSound('paper')
    },
  })
  const ambientTone = useAmbientTone(!immersiveFeed)

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

  const sidebarState = sidebarCollapsed ? 'collapsed' : 'expanded'

  return (
    <ShellProvider value={{ sidebarCollapsed, setSidebarCollapsed }}>
      <div ref={rootRef} className={cn('isolate', mindMapHost ? 'flex h-dvh flex-col bg-background' : 'min-h-screen bg-background')}>
        {!immersiveFeed ? <AmbientLayer tone={ambientTone} /> : null}
        <aside
          className={cn(
            'memory-anki-warm-panel fixed z-20 hidden flex-col overflow-hidden border-border/80 bg-card transition-all duration-300 md:flex',
            mindMapHost
              ? 'inset-y-0 left-0 rounded-none border-y-0 border-l-0 border-r shadow-none'
              : 'inset-y-3 left-3 rounded-2xl border shadow-soft',
            sidebarWidthClass[sidebarState],
          )}
        >
          <div className={cn('flex justify-center px-3 pt-3', !sidebarCollapsed && 'lg:justify-start')}>
            <div
              {...{ [SESSION_RECORDER_ANCHOR_ATTR]: 'true' }}
              className="size-9 shrink-0"
              aria-hidden
            />
          </div>
          <div
            className={cn(
              'flex flex-col items-center gap-2 px-3 pt-2 pb-1',
              !sidebarCollapsed && 'lg:flex-row lg:justify-between lg:pb-0',
            )}
          >
            <GlobalBackButton placement="sidebar" compact={sidebarCollapsed} />
            <div className={cn('flex items-center gap-2 flex-col', !sidebarCollapsed && 'lg:flex-row')}>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setLogDrawerOpen(true)}
                aria-label="打开日志侧边栏"
                title="打开日志侧边栏"
              >
                <ClipboardList data-icon="inline-start" />
              </Button>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="hidden size-9 items-center justify-center rounded-md border border-border/70 bg-background/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:inline-flex"
                aria-label={sidebarCollapsed ? '展开导航' : '收起导航'}
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </button>
            </div>
          </div>
          <SidebarContent runtimeInfo={runtimeInfo} />
        </aside>

        <main
          className={cn(
            'min-w-0 transition-[padding] duration-300 md:pb-0',
            mindMapHost && 'flex min-h-0 flex-1 flex-col',
            immersiveFeed
              ? 'pb-0'
              : 'pb-[calc(var(--spacing-shell-bottom-nav)+env(safe-area-inset-bottom,0px))]',
            contentOffsetClass[mindMapHost ? 'flush' : 'inset'][sidebarState],
          )}
        >
          <GlobalBackButton placement="mobile" />
          <div
            ref={contentRef}
            className={cn(
              mindMapHost
                ? 'flex min-h-0 w-full max-w-none flex-1 flex-col p-0'
                : 'mx-auto w-full max-w-[1600px]',
              !mindMapHost && (immersiveFeed
                ? 'px-0 py-0 sm:px-5 sm:py-5 lg:px-7 lg:py-6 xl:px-9'
                : 'px-2 py-2 sm:px-5 sm:py-5 lg:px-7 lg:py-6 xl:px-9'),
            )}
          >
            <BackgroundTaskBar />
            {children}
          </div>
        </main>
        <MobileBottomNav layoutMode={layoutMode} />
        <AppLogDrawer open={logDrawerOpen} onOpenChange={setLogDrawerOpen} />
        <SessionRecorderHost />
        <GlobalCommandPalette />
      </div>
    </ShellProvider>
  )
}

export function AppShell({ children }: PropsWithChildren) {
  return <ShellFrame>{children}</ShellFrame>
}
