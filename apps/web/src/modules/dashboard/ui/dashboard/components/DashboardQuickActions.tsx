import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { BookOpen, BrainCircuit, ClipboardList, Plus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

interface DashboardQuickActionsProps {
  todayTodoTotal: number
}

export function DashboardQuickActions({ todayTodoTotal }: DashboardQuickActionsProps) {
  const quickActions: Array<{
    label: string
    description: string
    to: string
    icon: LucideIcon
  }> = [
    {
      label: '开始复习',
      description: todayTodoTotal > 0 ? `${todayTodoTotal} 项待处理` : '查看复习队列',
      to: '/review',
      icon: BookOpen,
    },
    {
      label: '新建宫殿',
      description: '录入新的知识结构',
      to: '/palaces/new',
      icon: Plus,
    },
    {
      label: '做题练习',
      description: '进入宫殿题库入口',
      to: '/palaces',
      icon: ClipboardList,
    },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <BrainCircuit className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">快速操作</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {quickActions.map((action) => {
            const Icon = action.icon
            return (
              <Link
                key={action.label}
                to={action.to}
                className="group flex min-w-0 items-center gap-3 rounded-lg border border-border/70 bg-background/80 px-3 py-3 transition-colors hover:border-primary/30 hover:bg-accent/70"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-card text-muted-foreground transition-colors group-hover:text-primary">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{action.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{action.description}</span>
                </span>
              </Link>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
