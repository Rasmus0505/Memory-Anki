import { useState, type ReactNode } from 'react'
import { ChevronsDown, ChevronsUp } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface PageIntroProps {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  compact?: boolean
  /** Collapse the title bar to a thin rail so a mind map can fill the page. */
  collapsible?: boolean
}

export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
  compact = false,
  collapsible = false,
}: PageIntroProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (collapsible && collapsed) {
    return (
      <div className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border/70 bg-card/90 px-2 shadow-card">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="展开标题"
          title="展开标题"
        >
          <ChevronsDown className="size-4" />
        </button>
        <div className="min-w-0 truncate text-sm font-medium">{title}</div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border border-border/70 bg-card/90 shadow-card lg:flex-row lg:justify-between',
        compact ? 'gap-2 px-4 py-3 sm:px-5' : 'gap-4 px-5 py-5 sm:px-6 lg:items-end',
      )}
    >
      <div className={cn('min-w-0', compact ? 'space-y-1' : 'space-y-2')}>
        {eyebrow ? (
          <div
            className={cn(
              'font-semibold uppercase tracking-[0.24em] text-muted-foreground',
              compact ? 'text-[10px]' : 'text-[11px]',
            )}
          >
            {eyebrow}
          </div>
        ) : null}
        <div>
          <h1
            className={cn(
              'break-words font-semibold tracking-tight',
              compact ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl',
            )}
          >
            {title}
          </h1>
          {description && !compact ? (
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-[15px]">{description}</p>
          ) : null}
        </div>
      </div>
      {actions || collapsible ? (
        <div
          className={cn(
            'flex max-w-full flex-wrap items-center gap-2 lg:justify-end',
            compact ? 'self-start lg:self-center' : '',
          )}
        >
          {actions}
          {collapsible ? (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="inline-flex size-9 items-center justify-center rounded-md border border-border/70 bg-background/80 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="收起标题"
              title="收起标题"
            >
              <ChevronsUp className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
