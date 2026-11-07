import { useState, type ReactNode } from 'react'
import { ChevronsDown, ChevronsUp } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  /** Rendered before the title, e.g. a 「返回随心」 button. */
  leading?: ReactNode
  actions?: ReactNode
  compact?: boolean
  /** Collapse the title bar to a thin rail so a mind map can fill the page. */
  collapsible?: boolean
  /**
   * Long instructional copy is a desktop luxury: on a phone it can eat the
   * whole first screen before any content. Keep it from sm up only.
   */
  hideDescriptionOnMobile?: boolean
}

export function PageHeader({
  eyebrow,
  title,
  description,
  leading,
  actions,
  compact = false,
  collapsible = false,
  hideDescriptionOnMobile = false,
}: PageHeaderProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (collapsible && collapsed) {
    return (
      <div className="flex h-9 shrink-0 items-center gap-2 rounded-xl border border-border/70 bg-card px-2 shadow-soft">
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

  // Standard pages: the title sits on the page ground; only the compact
  // mind-map header keeps a card, because it floats over a canvas.
  return (
    <div
      className={cn(
        // Title and actions share one row and wrap only when the actions do not fit.
        'flex flex-wrap items-center justify-between gap-x-4',
        compact
          ? 'gap-y-2 rounded-xl border border-border/70 bg-card px-4 py-2.5 shadow-soft sm:px-5'
          : 'gap-y-3 border-b border-border/70 px-1 pb-3 pt-1',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        <div className="min-w-0 space-y-1">
          {eyebrow ? (
            <div className="text-xs font-medium text-muted-foreground">{eyebrow}</div>
          ) : null}
          <h1
            className={cn(
              'break-words font-semibold',
              compact ? 'text-lg tracking-tight sm:text-xl' : 'text-[26px] leading-tight sm:text-[32px] sm:leading-[1.15]',
            )}
          >
            {title}
          </h1>
          {description && !compact ? (
            <p
              className={cn(
                'max-w-2xl text-sm leading-relaxed text-muted-foreground',
                hideDescriptionOnMobile && 'max-sm:hidden',
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {actions || collapsible ? (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
          {actions}
          {collapsible ? (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
