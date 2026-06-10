import * as React from 'react'
import { cn } from '@/shared/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  asChild?: boolean
}

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === 'function') {
    ref(value)
    return
  }
  ;(ref as React.MutableRefObject<T | null>).current = value
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', asChild = false, children, ...props }, ref) => {
    const base =
      'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'
    const variants: Record<string, string> = {
      default: 'bg-primary text-primary-foreground shadow hover:bg-primary/90',
      destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
      outline: 'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
      secondary: 'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
      ghost: 'hover:bg-accent hover:text-accent-foreground',
      link: 'text-primary underline-offset-4 hover:underline',
    }
    const sizes: Record<string, string> = {
      default: 'h-9 px-4 py-2',
      sm: 'h-8 rounded-md px-3 text-xs',
      lg: 'h-10 rounded-md px-8',
      icon: 'h-9 w-9',
    }
    const buttonClassName = cn(base, variants[variant], sizes[size], className)

    if (asChild) {
      const child = React.Children.only(children)
      type ButtonChildProps = React.HTMLAttributes<HTMLElement> & {
        'data-feedback'?: string
      }
      if (!React.isValidElement<ButtonChildProps>(child)) return null
      const childElement = child as React.ReactElement<ButtonChildProps> & {
        ref?: React.Ref<HTMLButtonElement>
      }

      return React.cloneElement(childElement, {
        ...props,
        'data-feedback': 'button',
        className: cn(buttonClassName, childElement.props.className),
        ref: (value: HTMLButtonElement | null) => {
          assignRef(ref, value)
          assignRef(childElement.ref, value)
        },
      } as Partial<ButtonChildProps> & React.RefAttributes<HTMLButtonElement>)
    }

    return (
      <button ref={ref} className={buttonClassName} data-feedback="button" {...props}>
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'
export { Button, type ButtonProps }
