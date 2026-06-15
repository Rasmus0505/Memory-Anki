import { LoaderCircle, CheckCircle2, XCircle, ArrowUpRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { useBackgroundTasks, dismissTask } from '@/shared/background-tasks/backgroundTaskRegistry'

/**
 * 全局后台任务栏。
 * 挂在 AppShell 主区域顶部，仅当存在任务（running / 待清除的 completed/failed）时显示。
 * 点击单条任务可跳回对应页面（依赖路由 keep-alive 命中缓存实例，恢复完整进度）。
 */
export function BackgroundTaskBar() {
  const tasks = useBackgroundTasks()
  const navigate = useNavigate()

  if (tasks.length === 0) return null

  const runningCount = tasks.filter((task) => task.status === 'running').length

  return (
    <div className="mb-4 space-y-2">
      {tasks.map((task) => {
        const isRunning = task.status === 'running'
        const isCompleted = task.status === 'completed'
        const Icon = isRunning ? LoaderCircle : isCompleted ? CheckCircle2 : XCircle
        const hasTarget = Boolean(task.navigateTarget)

        return (
          <div
            key={task.id}
            className={cn(
              'flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-sm',
              isRunning
                ? 'border-info/30 bg-info/5 text-info'
                : isCompleted
                  ? 'border-success/30 bg-success/5 text-success'
                  : 'border-red-200 bg-red-50/80 text-red-800',
            )}
          >
            <Icon
              className={cn('h-4 w-4 shrink-0', isRunning && 'animate-spin')}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{task.title}</div>
              {task.detail ? (
                <div className="truncate text-xs opacity-80">{task.detail}</div>
              ) : null}
            </div>
            {isRunning && typeof task.progress === 'number' ? (
              <div className="hidden items-center gap-2 sm:flex">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-info/20">
                  <div
                    className="h-full rounded-full bg-info transition-all"
                    style={{ width: `${Math.max(0, Math.min(100, task.progress))}%` }}
                  />
                </div>
                <span className="w-9 text-right text-xs tabular-nums">
                  {Math.max(0, Math.min(100, Math.round(task.progress)))}%
                </span>
              </div>
            ) : null}
            {hasTarget ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0"
                onClick={() => task.navigateTarget && navigate(task.navigateTarget)}
              >
                查看
                <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            ) : null}
            {!isRunning ? (
              <button
                type="button"
                aria-label="关闭提示"
                onClick={() => dismissTask(task.id)}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-current/70 hover:bg-black/5 hover:text-current"
              >
                ×
              </button>
            ) : null}
          </div>
        )
      })}
      {runningCount > 1 ? (
        <div className="text-xs text-muted-foreground">
          {runningCount} 个后台任务正在运行，切换页面不会中断它们。
        </div>
      ) : null}
    </div>
  )
}
