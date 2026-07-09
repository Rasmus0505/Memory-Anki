import { Skeleton } from '@/shared/components/ui/skeleton'
import { cn } from '@/shared/lib/utils'

/** Page header placeholder: title block plus optional icon and action buttons. */
export function SkeletonPageHeader({
  actions = 0,
  titleClassName = 'h-8 w-32',
  withIcon = false,
}: {
  actions?: number
  titleClassName?: string
  withIcon?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        {withIcon ? <Skeleton className="size-8 rounded-md" /> : null}
        <Skeleton className={titleClassName} />
      </div>
      {actions > 0 ? (
        <div className="flex gap-2">
          {Array.from({ length: actions }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-md" />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Toolbar placeholder: one search field plus compact action buttons. */
export function SkeletonToolbar({
  buttons = 1,
  framed = false,
}: {
  buttons?: number
  framed?: boolean
}) {
  return (
    <div className={cn('flex items-center gap-3', framed && 'rounded-lg border p-4')}>
      <Skeleton className="h-9 max-w-xs flex-1 rounded-md" />
      {Array.from({ length: buttons }).map((_, i) => (
        <Skeleton key={i} className="size-9 rounded-md" />
      ))}
    </div>
  )
}

/** Repeated list row placeholder: icon, two text lines, and optional trailing badge. */
export function SkeletonListRows({
  rows = 3,
  withTrailing = false,
  framed = false,
  iconClassName = 'size-10 rounded-lg',
  trailingClassName = 'h-6 w-14 rounded-md',
}: {
  rows?: number
  withTrailing?: boolean
  framed?: boolean
  iconClassName?: string
  trailingClassName?: string
}) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={cn('flex items-center gap-3 py-2', framed && 'rounded-xl border p-4 py-4')}
        >
          <Skeleton className={iconClassName} />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          {withTrailing ? <Skeleton className={trailingClassName} /> : null}
        </div>
      ))}
    </div>
  )
}

/** Repeated form row placeholder: label plus input field. */
export function SkeletonFormRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-9 w-full max-w-md rounded-md" />
        </div>
      ))}
    </div>
  )
}

/** Repeated block rows for menu items, buttons, or compact stacked controls. */
export function SkeletonBlockRows({
  rows = 3,
  className = 'h-9 w-full rounded-md',
}: {
  rows?: number
  className?: string
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={className} />
      ))}
    </>
  )
}

/** Large content placeholder for charts, canvases, or editor regions. */
export function SkeletonPanel({
  heightClassName = 'h-52',
  framed = false,
}: {
  heightClassName?: string
  framed?: boolean
}) {
  const panel = <Skeleton className={cn('w-full rounded-xl', heightClassName)} />

  return framed ? <div className="rounded-lg border p-4">{panel}</div> : panel
}
