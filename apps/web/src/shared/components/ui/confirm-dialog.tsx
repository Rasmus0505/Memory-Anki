import { type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'

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

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
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
