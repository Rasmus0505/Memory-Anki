import { NavLink, useLocation } from 'react-router-dom'
import { Brain, LayoutDashboard } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

export type InsightsSectionTab = 'dashboard' | 'review'

const TABS: Array<{
  key: InsightsSectionTab
  to: string
  label: string
  description: string
  icon: typeof LayoutDashboard
  isActive: (pathname: string) => boolean
}> = [
  {
    key: 'dashboard',
    to: '/dashboard',
    label: '仪表盘',
    description: '时长、时间记录与学习统计',
    icon: LayoutDashboard,
    isActive: (pathname) => pathname === '/dashboard' || pathname === '/',
  },
  {
    key: 'review',
    to: '/review',
    label: '今日复习',
    description: '到期队列与当天强化',
    icon: Brain,
    isActive: (pathname) => pathname === '/review' || pathname.startsWith('/review/'),
  },
]

export function resolveInsightsSectionTab(pathname: string): InsightsSectionTab {
  if (pathname === '/review' || pathname.startsWith('/review/')) return 'review'
  return 'dashboard'
}

/** Shared hub switcher for 洞察: dashboard (time records) vs review queue. */
export function InsightsSectionNav() {
  const { pathname } = useLocation()
  const active = resolveInsightsSectionTab(pathname)

  return (
    <nav
      aria-label="洞察子导航"
      className="inline-flex w-full max-w-md rounded-lg border border-border/70 bg-muted/60 p-1 sm:w-auto"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon
        const isActive = tab.isActive(pathname) || tab.key === active
        return (
          <NavLink
            key={tab.key}
            to={tab.to}
            title={tab.description}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none sm:px-4',
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span>{tab.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}
