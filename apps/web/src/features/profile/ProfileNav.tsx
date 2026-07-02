import { Bot, HardDriveDownload, Settings, Sparkles, Timer } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'

export function ProfileNav() {
  const location = useLocation()
  const currentPath = location.pathname

  const items = [
    { href: '/profile', label: '复习配置与导入导出', icon: Settings },
    { href: '/profile/timer', label: '计时与休息', icon: Timer },
    { href: '/profile/feedback', label: '反馈中心', icon: Sparkles },
    { href: '/profile/ai', label: 'AI管理', icon: Bot },
    { href: '/profile/backups', label: '备份与恢复', icon: HardDriveDownload },
  ]

  return (
    <nav className="flex flex-wrap gap-2 rounded-lg border border-border/70 bg-card/70 p-2 lg:flex-col">
      {items.map(({ href, label, icon: Icon }) => {
        const active = currentPath === href || (href === '/profile/ai' && currentPath.startsWith('/profile/ai'))
        return (
          <Link
            key={href}
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
        )
      })}
    </nav>
  )
}
