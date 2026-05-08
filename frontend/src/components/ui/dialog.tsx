import { type PropsWithChildren, useEffect } from 'react'
import { X } from 'lucide-react'

interface DialogProps extends PropsWithChildren {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onOpenChange, open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/45"
        aria-label="关闭弹窗"
        onClick={() => onOpenChange(false)}
      />
      {children}
    </div>
  )
}

export function DialogContent({ children, className = '' }: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={`relative z-10 w-full max-w-3xl rounded-2xl border bg-background shadow-2xl ${className}`}>
      {children}
    </div>
  )
}

export function DialogHeader({ children }: PropsWithChildren) {
  return (
    <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
      <div className="space-y-1">{children}</div>
    </div>
  )
}

export function DialogTitle({ children }: PropsWithChildren) {
  return <h2 className="text-lg font-semibold">{children}</h2>
}

export function DialogClose({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      aria-label="关闭"
    >
      <X className="h-4 w-4" />
    </button>
  )
}
