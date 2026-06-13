import { forwardRef, type HTMLAttributes, type PropsWithChildren, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface DialogProps extends PropsWithChildren {
  open: boolean
  onOpenChange: (open: boolean) => void
  modal?: boolean
  className?: string
}

export function Dialog({ open, onOpenChange, children, modal = true, className = '' }: DialogProps) {
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpenChange, open])

  if (!open) return null

  return createPortal(
    <div
      className={`fixed inset-0 z-[140] flex items-center justify-center p-4 ${
        modal ? '' : 'pointer-events-none'
      } ${className}`}
    >
      {modal ? (
        <button
          type="button"
          className="absolute inset-0 bg-black/45"
          aria-label="关闭弹窗"
          onClick={() => onOpenChange(false)}
        />
      ) : null}
      {children}
    </div>,
    document.body,
  )
}

export const DialogContent = forwardRef<HTMLDivElement, PropsWithChildren<HTMLAttributes<HTMLDivElement>>>(
  function DialogContent({ children, className = '', ...props }, ref) {
    return (
      <div
        ref={ref}
        {...props}
        className={`pointer-events-auto relative z-10 flex w-full max-w-3xl flex-col rounded-2xl border bg-background shadow-2xl ${className}`}
      >
        {children}
      </div>
    )
  },
)

export function DialogHeader({ children }: PropsWithChildren) {
  return (
    <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
      <div className="space-y-1">{children}</div>
    </div>
  )
}

export function DialogTitle({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return <h2 className={`text-lg font-semibold ${className}`}>{children}</h2>
}

export function DialogDescription({
  children,
  className = '',
}: PropsWithChildren<{ className?: string }>) {
  return <p className={`text-sm text-muted-foreground ${className}`}>{children}</p>
}

export function DialogFooter({
  children,
  className = '',
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={`flex items-center justify-end gap-3 border-t px-6 py-4 ${className}`}>
      {children}
    </div>
  )
}

export function DialogClose({
  onClick,
  className = '',
}: {
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${className}`}
      aria-label="关闭"
    >
      <X className="h-4 w-4" />
    </button>
  )
}
