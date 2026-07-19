import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export function EnglishStatStrip({
  items,
  className,
}: {
  items: Array<{ label: string; value: ReactNode }>
  className?: string
}) {
  return (
    <div
      data-testid="english-stat-strip"
      className={cn(
        'grid gap-3 sm:grid-cols-3',
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-2xl border border-border/70 bg-card/90 px-4 py-3 shadow-soft"
        >
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {item.label}
          </div>
          <div className="mt-1.5 text-lg font-semibold tracking-tight text-foreground">
            {item.value}
          </div>
        </div>
      ))}
    </div>
  )
}
