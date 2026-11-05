import * as React from 'react'
import { cn } from '@/shared/lib/utils'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      data-feedback="field"
      className={cn(
        'flex min-h-[60px] w-full rounded-lg border border-input bg-card px-3 py-2 text-base leading-relaxed shadow-[inset_0_1px_2px_rgb(0_0_0/0.04)] md:text-sm placeholder:text-muted-foreground/80 hover:border-foreground/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Textarea.displayName = 'Textarea'
export { Textarea }
