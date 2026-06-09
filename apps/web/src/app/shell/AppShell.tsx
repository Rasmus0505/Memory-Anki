import { useEffect, useState, type PropsWithChildren } from 'react'
import {
  BookOpen,
  Captions,
  Brain,
  ChevronRight,
  ClipboardList,
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
import { ShellProvider, useShellContext } from '@/shared/components/layout/ShellContext'
import { useClientPreferenceBootstrap } from '@/shared/preferences/useClientPreferenceBootstrap'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { AppLogDrawer } from '@/shared/logs/components/AppLogDrawer'
import { cn } from '@/shared/lib/utils'

const navItems = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard },
  { to: '/palaces', label: '记忆宫殿', icon: BookOpen },
  { to: '/english', label: '英语区', icon: Captions },
  { to: '/knowledge', label: '知识大纲', icon: FolderTree },
  { to: '/review', label: '复习', icon: Brain },
  { to: '/profile', label: '个人中心', icon: User },
]

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
          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
          : 'border-sky-300 bg-sky-50 text-sky-700',
        compact ? 'px-2 py-0 text-[10px]' : 'px-2.5 py-0.5 text-[11px]',
      )}
      aria-label={`当前版本 ${label}${commitText ? ` ${commitText}` : ''}`}
    >
      {label}
      {commitText ? ` ${commitText}` : ''}
    </Badge>
  )
}

function SidebarContent({ runtimeInfo }: { runtimeInfo: RuntimeInfo | null }) {
  const { pathname } = useLocation()
  const shell = useShellContext()
  const compact = shell?.sidebarCollapsed ?? false
  const active = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to))
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

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
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={cn(
              'group flex items-center rounded-2xl text-sm font-medium transition-all',
              active(to)
                ? 'bg-primary text-primary-foreground shadow-[0_10px_30px_rgba(15,23,42,0.14)]'
                : 'text-muted-foreground hover:bg-secondary/80 hover:text-foreground',
              compact ? 'justify-center px-2.5 py-2.5' : 'gap-3 px-3.5 py-3',
            )}
          >
            <Icon className="h-4 w-4" />
            {!compact ? <span>{label}</span> : null}
            {!compact ? (
              <ChevronRight
                className={cn(
                  'ml-auto h-4 w-4 transition-transform',
                  active(to)
                    ? 'translate-x-0'
                    : '-translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100',
                )}
              />
            ) : null}
          </NavLink>
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
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setLogDrawerOpen(true)}
              aria-label="打开日志侧边栏"
            >
              <ClipboardList className="h-4 w-4" />
            </Button>
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
            'fixed inset-y-4 left-4 z-20 hidden overflow-hidden rounded-[30px] border border-border/70 bg-background/92 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur lg:flex lg:flex-col transition-all duration-300',
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
            sidebarCollapsed ? 'lg:pl-[122px]' : 'lg:pl-[282px]',
          )}
        >
          <div className="mx-auto w-full max-w-[1700px] px-3 py-3 sm:px-5 sm:py-5 lg:px-6 lg:py-6 xl:px-8">
            {children}
          </div>
        </main>
        <AppLogDrawer open={logDrawerOpen} onOpenChange={setLogDrawerOpen} />
      </div>
    </ShellProvider>
  )
}

export function AppShell({ children }: PropsWithChildren) {
  return <ShellFrame>{children}</ShellFrame>
}
