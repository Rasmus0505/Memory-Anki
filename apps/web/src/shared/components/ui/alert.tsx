import * as React from 'react'
import { AlertCircle } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: 'default' | 'destructive' | 'success' | 'warning' | 'info'
  }
>(({ className, variant = 'default', ...props }, ref) => {
  const variants = {
    default: 'border-border bg-card text-card-foreground',
    destructive: 'border-destructive/30 bg-destructive/8 text-destructive',
    success: 'border-success/30 bg-success/8 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    info: 'border-info/30 bg-info/8 text-info',
  }
  return (
    <div
      ref={ref}
      role="alert"
      className={cn('relative grid w-full gap-1 rounded-lg border px-4 py-3 text-sm', variants[variant], className)}
      {...props}
    />
  )
})
Alert.displayName = 'Alert'

const AlertIcon = ({ className, ...props }: React.ComponentProps<typeof AlertCircle>) => (
  <AlertCircle className={cn('size-4', className)} {...props} />
)
AlertIcon.displayName = 'AlertIcon'

const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h5 ref={ref} className={cn('mb-1 font-medium leading-none tracking-tight', className)} {...props} />
  ),
)
AlertTitle.displayName = 'AlertTitle'

const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm leading-relaxed [&_p]:leading-relaxed', className)} {...props} />
  ),
)
AlertDescription.displayName = 'AlertDescription'

export { Alert, AlertDescription, AlertIcon, AlertTitle }
