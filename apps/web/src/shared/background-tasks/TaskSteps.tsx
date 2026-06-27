import { Check, Circle, LoaderCircle, XCircle } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { TaskStep } from '@/shared/background-tasks/backgroundTaskRegistry'

/**
 * 分步进度指示器。在 BackgroundTaskBar 内展示长任务的各阶段。
 */
export function TaskSteps({ steps, className }: { steps: TaskStep[]; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1 text-xs', className)}>
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-1">
          {i > 0 && <div className="h-px w-3 bg-current/20" />}
          <StepIcon status={step.status} />
          <span
            className={cn(
              'truncate',
              step.status === 'active' && 'font-medium text-current',
              step.status === 'done' && 'text-current/60',
              step.status === 'pending' && 'text-current/40',
              step.status === 'failed' && 'text-red-600',
            )}
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  )
}

function StepIcon({ status }: { status: TaskStep['status'] }) {
  switch (status) {
    case 'done':
      return <Check className="h-3 w-3 shrink-0 text-current/60" />
    case 'active':
      return <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" />
    case 'failed':
      return <XCircle className="h-3 w-3 shrink-0 text-red-600" />
    case 'pending':
    default:
      return <Circle className="h-3 w-3 shrink-0 text-current/30" />
  }
}
