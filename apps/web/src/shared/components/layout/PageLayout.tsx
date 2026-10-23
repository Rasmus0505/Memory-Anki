import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export function PageContainer({
  children,
  wide = false,
  className,
}: {
  children: ReactNode
  wide?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        // Phones get a tighter rhythm: every page stacked 24px gaps between
        // sections, which spent a third of the first screen on whitespace.
        'mx-auto flex w-full flex-col gap-4 sm:gap-6',
        wide ? 'max-w-7xl' : 'max-w-5xl',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      {title || actions ? (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title ? <h2 className="text-base font-semibold tracking-tight">{title}</h2> : null}
            {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
