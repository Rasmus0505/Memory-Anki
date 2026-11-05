import * as React from 'react'
import { cn } from '@/shared/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      data-feedback="field"
      className={cn(
        // 16px on phones: iOS Safari zooms the page on focus when a field's font-size is below 16px.
        'flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1 text-base shadow-[inset_0_1px_2px_rgb(0_0_0/0.04)] md:text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/80 hover:border-foreground/20 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
export { Input }
