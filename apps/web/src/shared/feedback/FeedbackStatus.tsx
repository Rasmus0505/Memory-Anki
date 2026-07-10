import * as React from 'react'
import { AlertCircle, Check, CircleAlert, LoaderCircle, RotateCcw } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

export type FeedbackStatusTone = 'neutral' | 'success' | 'warning' | 'error'

const TONE_CLASS: Record<FeedbackStatusTone, string> = {
  neutral: 'border-border/70 bg-secondary/45 text-foreground',
  success: 'border-emerald-500/25 bg-emerald-500/8 text-emerald-900 dark:text-emerald-100',
  warning: 'border-amber-500/30 bg-amber-500/9 text-amber-950 dark:text-amber-100',
  error: 'border-red-500/25 bg-red-500/8 text-red-900 dark:text-red-100',
}

function StatusIcon({ tone, pending }: { tone: FeedbackStatusTone; pending?: boolean }) {
  if (pending) return <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
  if (tone === 'success') return <Check className="size-4" aria-hidden="true" />
  if (tone === 'warning') return <CircleAlert className="size-4" aria-hidden="true" />
  if (tone === 'error') return <AlertCircle className="size-4" aria-hidden="true" />
  return null
}

export function InlineFeedback({
  message,
  tone = 'neutral',
  pending = false,
  className,
}: {
  message: string
  tone?: FeedbackStatusTone
  pending?: boolean
  className?: string
}) {
  return (
    <div
      className={cn('inline-flex min-h-8 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm', TONE_CLASS[tone], className)}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
    >
      <StatusIcon tone={tone} pending={pending} />
      <span>{message}</span>
    </div>
  )
}

export type TaskFeedbackState = 'queued' | 'running' | 'success' | 'error'

export function TaskFeedbackPanel({
  title,
  description,
  state,
  progress,
  onRetry,
  className,
}: {
  title: string
  description?: string
  state: TaskFeedbackState
  progress?: number | null
  onRetry?: () => void
  className?: string
}) {
  const pending = state === 'queued' || state === 'running'
  const tone: FeedbackStatusTone = state === 'success' ? 'success' : state === 'error' ? 'error' : 'neutral'
  const safeProgress = progress == null ? null : Math.max(0, Math.min(100, Math.round(progress)))

  return (
    <section
      className={cn('rounded-xl border p-4', TONE_CLASS[tone], className)}
      role={state === 'error' ? 'alert' : 'status'}
      aria-live={state === 'error' ? 'assertive' : 'polite'}
      aria-busy={pending}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-background/75">
            <StatusIcon tone={tone} pending={pending} />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            {description ? <p className="mt-1 text-sm leading-5 opacity-75">{description}</p> : null}
          </div>
        </div>
        {state === 'error' && onRetry ? (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            <RotateCcw className="mr-2 size-3.5" />
            重试
          </Button>
        ) : null}
      </div>
      {safeProgress != null ? (
        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
            <div
              className="h-full rounded-full bg-current transition-[width] duration-300"
              style={{ width: `${safeProgress}%` }}
            />
          </div>
          <span className="sr-only">进度 {safeProgress}%</span>
        </div>
      ) : null}
    </section>
  )
}
