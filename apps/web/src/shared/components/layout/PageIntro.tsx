import type { ReactNode } from 'react'

interface PageIntroProps {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  compact?: boolean
}

export function PageIntro({ eyebrow, title, description, actions, compact = false }: PageIntroProps) {
  return (
    <div className={`flex flex-col rounded-[28px] border border-border/70 bg-card/90 shadow-card lg:flex-row lg:justify-between ${compact ? 'gap-2 px-4 py-3 sm:px-5' : 'gap-4 px-5 py-5 sm:px-6 lg:items-end'}`}>
      <div className={compact ? 'space-y-1' : 'space-y-2'}>
        {eyebrow ? (
          <div className={`font-semibold uppercase tracking-[0.24em] text-muted-foreground ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
            {eyebrow}
          </div>
        ) : null}
        <div>
          <h1 className={`${compact ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'} font-semibold tracking-tight`}>{title}</h1>
          {description && !compact ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground sm:text-[15px]">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className={`flex shrink-0 items-center gap-2 ${compact ? 'self-start lg:self-center' : ''}`}>{actions}</div> : null}
    </div>
  )
}
