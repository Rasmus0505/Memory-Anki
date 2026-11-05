import { Fragment } from 'react'
import { BellRing, Bot, HardDriveDownload, Settings, Sparkles } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'

const ITEMS = [
  { href: '/profile', label: '复习与偏好', icon: Settings },
  { href: '/profile/reminders', label: '复习提醒', icon: BellRing },
  { href: '/profile/feedback', label: '反馈中心', icon: Sparkles },
  { href: '/profile/ai', label: 'AI 管理', icon: Bot },
  { href: '/profile/backups', label: '数据与备份', icon: HardDriveDownload },
]

export function ProfileNav() {
  const { pathname } = useLocation()

  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:p-0">
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === '/profile' ? pathname === href : pathname.startsWith(href)
        return (
          <Fragment key={href}>
            {href === '/profile/backups' ? (
              <div className="my-1.5 hidden border-t border-border/70 lg:block" />
            ) : null}
            <Link
              to={href}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors lg:min-h-9 lg:w-full',
                active
                  ? 'bg-primary-soft text-primary-strong'
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
