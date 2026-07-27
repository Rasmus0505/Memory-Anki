import { Fragment } from 'react'
import { Bot, HardDriveDownload, Settings, Sparkles, Timer } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'

const ITEMS = [
  { href: '/profile', label: '复习与偏好', icon: Settings },
  { href: '/profile/timer', label: '计时与休息', icon: Timer },
  { href: '/profile/feedback', label: '反馈中心', icon: Sparkles },
  { href: '/profile/ai', label: 'AI 管理', icon: Bot },
  { href: '/profile/backups', label: '数据与备份', icon: HardDriveDownload },
]

export function ProfileNav() {
  const { pathname } = useLocation()

  return (
    <nav className="flex flex-wrap gap-2 rounded-lg border border-border/70 bg-card/70 p-2 lg:flex-col">
      {ITEMS.map(({ href, label, icon: Icon }, index) => {
        const active = href === '/profile' ? pathname === href : pathname.startsWith(href)
        return (
          <Fragment key={href}>
            {index === 3 ? <div className="hidden border-t border-border/70 lg:block" /> : null}
            <Link
              to={href}
              className={cn(
                'inline-flex min-h-11 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors lg:w-full',
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{label}</span>
            </Link>
          </Fragment>
        )
      })}
    </nav>
  )
}