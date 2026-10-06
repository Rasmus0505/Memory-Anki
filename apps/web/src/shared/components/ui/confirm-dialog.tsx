import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'

export function topOpenConfirmDialog() {
  if (typeof document === 'undefined') return null
  const openDialogs = document.querySelectorAll<HTMLElement>('[data-confirm-dialog="open"]')
  return openDialogs[openDialogs.length - 1] ?? null
}

export function isConfirmEnter(
  event: KeyboardEvent,
  options?: { allowTextInput?: boolean },
) {
  if (event.key !== 'Enter' || event.repeat || event.isComposing) return false
  if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false
  const target = event.target
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return false
  if (target instanceof HTMLElement && target.isContentEditable) return false
  if (
    !options?.allowTextInput
    && target instanceof HTMLInputElement
    && !['button', 'submit', 'checkbox', 'radio'].includes(target.type)
  ) {
    return false
  }
  return true
}

/** Enter confirms the topmost open confirmation dialog. Escape still cancels. */
export function useConfirmEnter(
  active: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onConfirm: () => void,
  options?: { allowTextInput?: boolean },
) {
  const onConfirmRef = useRef(onConfirm)
  onConfirmRef.current = onConfirm
  const allowTextInput = options?.allowTextInput === true
  useEffect(() => {
    if (!active) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = panelRef.current
      if (!panel || topOpenConfirmDialog() !== panel) return
      if (!isConfirmEnter(event, { allowTextInput })) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onConfirmRef.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [active, allowTextInput, panelRef])
}

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  tone?: 'default' | 'danger'
  confirmText?: string
  cancelText?: string
  onConfirm: () => void
  onCancel?: () => void
}

/**
 * 统一确认弹窗，替代全项目散落的 window.confirm / window.alert。
 *
 * - tone="danger"：确认按钮用 destructive 样式（删除、覆盖等不可逆操作）
 * - tone="default"：确认按钮用主操作样式
 *
 * 关闭（点遮罩 / ESC / 取消）统一走 onCancel；点确认走 onConfirm 后再关闭。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  tone = 'default',
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      onCancel?.()
    }
    onOpenChange(next)
  }

  const handleConfirm = () => {
    onConfirm()
    onOpenChange(false)
  }
  const panelRef = useRef<HTMLDivElement>(null)
  useConfirmEnter(open, panelRef, handleConfirm)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        ref={panelRef}
        className="max-w-md"
        floatingId="confirm-dialog"
        data-confirm-dialog={open ? 'open' : undefined}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {cancelText}
          </Button>
          <Button variant={tone === 'danger' ? 'destructive' : 'default'} onClick={handleConfirm}>
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
