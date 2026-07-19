import type { ReactNode } from 'react'
import { ArrowRight, Play } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

export function EnglishContinueHero({
  eyebrow,
  title,
  description,
  meta,
  primaryLabel = '继续',
  onPrimary,
  primaryHref,
  secondary,
  empty,
  className,
}: {
  eyebrow: string
  title: string
  description?: string
  meta?: ReactNode
  primaryLabel?: string
  onPrimary?: () => void
  primaryHref?: string
  secondary?: ReactNode
  empty?: boolean
  className?: string
}) {
  return (
    <section
      data-testid="english-continue-hero"
      className={cn(
        'relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-card via-card to-info/5 p-5 shadow-card sm:p-7',
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-10 -top-12 size-44 rounded-full bg-info/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 left-10 size-40 rounded-full bg-success/10 blur-3xl" />

      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-info">
            {eyebrow}
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h2>
          {description ? (
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
          {meta ? <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">{meta}</div> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {secondary}
          {!empty && (onPrimary || primaryHref) ? (
            primaryHref ? (
              <Button asChild size="lg" className="min-h-11 rounded-xl px-5">
                <a href={primaryHref}>
                  <Play className="size-4" />
                  {primaryLabel}
                  <ArrowRight className="size-4" />
                </a>
              </Button>
            ) : (
              <Button size="lg" className="min-h-11 rounded-xl px-5" onClick={onPrimary}>
                <Play className="size-4" />
                {primaryLabel}
                <ArrowRight className="size-4" />
              </Button>
            )
          ) : null}
        </div>
      </div>
    </section>
  )
}
