import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

export function EnglishFocusChrome({
  backTo,
  backLabel = '返回',
  title,
  subtitle,
  trailing,
  className,
}: {
  backTo: string
  backLabel?: string
  title: string
  subtitle?: ReactNode
  trailing?: ReactNode
  className?: string
}) {
  return (
    <header
      data-testid="english-focus-chrome"
      className={cn(
        'flex shrink-0 items-center gap-2 border-b border-border/50 bg-background/90 px-3 py-2 backdrop-blur-sm sm:px-4',
        className,
      )}
    >
      <Button variant="ghost" size="icon" className="size-10 shrink-0 rounded-xl" asChild>
        <Link to={backTo} aria-label={backLabel}>
          <ArrowLeft className="size-4" />
        </Link>
      </Button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">{title}</div>
        {subtitle ? (
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
      {trailing ? <div className="flex shrink-0 items-center gap-1.5">{trailing}</div> : null}
    </header>
  )
}
