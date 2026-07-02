import * as React from 'react'
import { cn } from '@/shared/lib/utils'

const Empty = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex min-h-40 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-border/80 p-8 text-center', className)} {...props} />
  ),
)
Empty.displayName = 'Empty'

const EmptyHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('flex flex-col items-center gap-2', className)} {...props} />,
)
EmptyHeader.displayName = 'EmptyHeader'

const EmptyMedia = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { variant?: 'icon' | 'default' }
>(({ className, variant = 'default', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center justify-center rounded-lg bg-muted text-muted-foreground',
      variant === 'icon' ? 'size-10 [&_svg]:size-5' : 'min-h-16 min-w-16',
      className,
    )}
    {...props}
  />
))
EmptyMedia.displayName = 'EmptyMedia'

const EmptyTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h3 ref={ref} className={cn('text-base font-semibold', className)} {...props} />,
)
EmptyTitle.displayName = 'EmptyTitle'

const EmptyDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('max-w-sm text-sm leading-6 text-muted-foreground', className)} {...props} />
  ),
)
EmptyDescription.displayName = 'EmptyDescription'

const EmptyContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('flex items-center gap-2', className)} {...props} />,
)
EmptyContent.displayName = 'EmptyContent'

export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle }
