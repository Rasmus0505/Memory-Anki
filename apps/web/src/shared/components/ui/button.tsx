import * as React from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg' | 'icon'
  asChild?: boolean
  /** 显示 loading spinner 并自动 disabled */
  loading?: boolean
  /** loading 时替换按钮文字 */
  loadingText?: string
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
  ({ className, variant = 'default', size = 'default', asChild = false, loading = false, loadingText, children, ...props }, ref) => {
    const base =
      'ma-pressable inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'
    const variants: Record<string, string> = {
      // 1px top highlight + tight contact shadow + soft coloured bloom; hover lifts 1px.
      default:
        'bg-primary text-primary-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,white_20%,transparent),0_0_0_1px_color-mix(in_srgb,var(--color-primary-strong)_40%,transparent),0_1px_2px_color-mix(in_srgb,var(--color-primary-strong)_30%,transparent),0_4px_12px_-4px_color-mix(in_srgb,var(--color-primary)_50%,transparent)] hover:-translate-y-px hover:bg-primary/94 hover:shadow-glow',
      destructive:
        'bg-destructive text-destructive-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,white_18%,transparent),0_1px_2px_color-mix(in_srgb,var(--color-destructive)_35%,transparent)] hover:-translate-y-px hover:bg-destructive/92',
      // Always pin text color: freestyle immersive chrome inherits light text from a dark shell,
      // and outline/ghost sit on light surfaces — missing text-* makes labels/icons invisible.
      outline:
        'border border-input bg-card text-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,white_6%,transparent),0_1px_2px_rgb(0_0_0/0.05)] hover:-translate-y-px hover:border-foreground/20 hover:bg-accent hover:text-accent-foreground hover:shadow-soft',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
      ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
      link: 'text-primary underline-offset-4 hover:underline',
    }
    const sizes: Record<string, string> = {
      default: 'h-9 px-4',
      sm: 'h-8 rounded-md px-3 text-xs',
      lg: 'h-11 rounded-[10px] px-6 text-[15px]',
      icon: 'size-9',
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

    const isDisabled = loading || props.disabled

    return (
      <button ref={ref} className={buttonClassName} data-feedback="button" disabled={isDisabled} {...props}>
        {loading ? (
          <>
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
            {loadingText ?? children}
          </>
        ) : (
          children
        )}
      </button>
    )
  },
)
Button.displayName = 'Button'
export { Button, type ButtonProps }
