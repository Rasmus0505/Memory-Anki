import * as React from 'react'
import { Label } from '@/shared/components/ui/label'
import { cn } from '@/shared/lib/utils'

const FieldGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('flex flex-col gap-4', className)} {...props} />,
)
FieldGroup.displayName = 'FieldGroup'

interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: 'vertical' | 'horizontal'
}

const Field = React.forwardRef<HTMLDivElement, FieldProps>(
  ({ className, orientation = 'vertical', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'grid gap-2 data-[disabled]:opacity-70',
        orientation === 'horizontal' && 'grid-cols-[minmax(0,1fr)_auto] items-center gap-3',
        className,
      )}
      {...props}
    />
  ),
)
Field.displayName = 'Field'

const FieldLabel = React.forwardRef<React.ElementRef<typeof Label>, React.ComponentPropsWithoutRef<typeof Label>>(
  ({ className, ...props }, ref) => <Label ref={ref} className={cn('text-sm font-medium', className)} {...props} />,
)
FieldLabel.displayName = 'FieldLabel'

const FieldTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('text-sm font-medium', className)} {...props} />,
)
FieldTitle.displayName = 'FieldTitle'

const FieldDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-xs leading-5 text-muted-foreground', className)} {...props} />
  ),
)
FieldDescription.displayName = 'FieldDescription'

const FieldError = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn('text-xs text-destructive', className)} {...props} />,
)
FieldError.displayName = 'FieldError'

const FieldSet = React.forwardRef<HTMLFieldSetElement, React.FieldsetHTMLAttributes<HTMLFieldSetElement>>(
  ({ className, ...props }, ref) => <fieldset ref={ref} className={cn('grid gap-3', className)} {...props} />,
)
FieldSet.displayName = 'FieldSet'

const FieldLegend = React.forwardRef<
  HTMLLegendElement,
  React.HTMLAttributes<HTMLLegendElement> & { variant?: 'default' | 'label' }
>(({ className, variant = 'default', ...props }, ref) => (
  <legend ref={ref} className={cn(variant === 'label' ? 'text-sm font-medium' : 'text-base font-semibold', className)} {...props} />
))
FieldLegend.displayName = 'FieldLegend'

export {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
}
