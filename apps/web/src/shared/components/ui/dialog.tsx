import { forwardRef, type HTMLAttributes, type PropsWithChildren } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

/**
 * 基于 Radix UI 的 Dialog 实现。
 *
 * 保持与旧自研版本完全一致的简化 API（Dialog / DialogContent / DialogHeader /
 * DialogTitle / DialogDescription / DialogFooter / DialogClose），调用方无需改动，
 * 同时获得开箱即用的无障碍能力：role=dialog、aria-modal、focus trap、焦点恢复、滚动锁定。
 *
 * `modal` prop 控制模态行为（与旧版一致，默认 true）。非模态（modal={false}）用于
 * 导入抽屉等需要背景交互的场景：不渲染遮罩、不锁定背景。
 */
function Dialog({
  open,
  onOpenChange,
  children,
  modal = true,
  className: _className,
}: PropsWithChildren<{
  open: boolean
  onOpenChange: (open: boolean) => void
  modal?: boolean
  className?: string
}>) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      {children}
    </DialogPrimitive.Root>
  )
}

const DialogContent = forwardRef<
  HTMLDivElement,
  PropsWithChildren<HTMLAttributes<HTMLDivElement>> & { showCloseButton?: boolean }
>(function DialogContent({ children, className, showCloseButton = false, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-[140] bg-black/45',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        {...props}
        className={cn(
          // 居中容器：用 fixed + flex 实现旧版的 items-center justify-center 行为
          'fixed inset-0 z-[141] flex items-center justify-center p-4',
          className,
        )}
      >
        <div
          className={cn(
            'pointer-events-auto relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          )}
        >
          {children}
          {showCloseButton ? (
            <DialogPrimitive.Close
              className="absolute right-4 top-4 rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          ) : null}
        </div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
})

function DialogHeader({ children }: PropsWithChildren) {
  return (
    <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function DialogTitle({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <DialogPrimitive.Title asChild>
      <h2 className={cn('text-lg font-semibold', className)}>{children}</h2>
    </DialogPrimitive.Title>
  )
}

function DialogDescription({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <DialogPrimitive.Description asChild>
      <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>
    </DialogPrimitive.Description>
  )
}

function DialogFooter({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={cn('flex items-center justify-end gap-3 border-t px-6 py-4', className)}>
      {children}
    </div>
  )
}

function DialogClose({
  onClick,
  className,
}: {
  onClick?: () => void
  className?: string
}) {
  return (
    <DialogPrimitive.Close
      onClick={onClick}
      className={cn(
        'rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
        className,
      )}
      aria-label="关闭"
    >
      <X className="h-4 w-4" />
    </DialogPrimitive.Close>
  )
}

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
}
