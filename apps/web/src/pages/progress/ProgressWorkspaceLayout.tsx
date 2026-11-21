import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'

const pages = [
  { to: '/progress', label: '学习进度' },
  { to: '/dashboard', label: '今日学案' },
  { to: '/exam', label: '考试作战室' },
]

export function ProgressWorkspaceLayout() {
  return (
    <div className="min-w-0 [--progress-navigation-height:3.25rem]">
      <nav aria-label="进度分区" className="mx-auto mb-2 flex h-11 max-w-7xl gap-4 border-b border-border px-1 sm:gap-6">
        {pages.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) => cn(
              'inline-flex items-center whitespace-nowrap border-b-2 px-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
