import type { HTMLAttributes } from 'react'
import { cn } from '@/shared/lib/utils'

interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants: Record<string, string> = {
    // Low-chroma fill, high-contrast ink: status reads without shouting.
    default: 'border-primary/15 bg-primary-soft text-primary-strong',
    secondary: 'border-transparent bg-secondary text-secondary-foreground',
    destructive: 'border-destructive/15 bg-danger-soft text-danger-strong',
    outline: 'border-border text-foreground',
    success: 'border-success/15 bg-success-soft text-success-strong',
    warning: 'border-warning/20 bg-warning-soft text-warning-strong',
    info: 'border-info/15 bg-info-soft text-info-strong',
  }
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium tabular-nums transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
        variants[variant],
        className,
      )}
      {...props}
    />
  )
}
export { Badge }
