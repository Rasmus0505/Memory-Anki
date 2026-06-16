import * as React from 'react'
import { formatDuration } from '@/entities/session/model'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

interface CompletionDecisionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onMarkCompleted: () => void
  onMarkUncompleted: () => void
  submitting?: boolean
  durationSeconds?: number
}

export function CompletionDecisionDialog({
  open,
  onOpenChange,
  onMarkCompleted,
  onMarkUncompleted,
  submitting = false,
  durationSeconds,
}: CompletionDecisionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>完成本次练习/复习</DialogTitle>
          <DialogDescription>
            你可以标记本轮已完成，或保留当前进度稍后继续。
          </DialogDescription>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>
        <div className="space-y-3 px-6 py-5">
          {typeof durationSeconds === 'number' ? (
            <div className="rounded-2xl border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              本次耗时：<span className="font-medium text-foreground">{formatDuration(durationSeconds)}</span>
            </div>
          ) : null}
          <Button
            type="button"
            className="h-auto w-full flex-col items-center justify-center gap-1 px-4 py-4"
            variant="default"
            disabled={submitting}
            onClick={onMarkCompleted}
          >
            <span className="text-sm font-semibold">已完成</span>
            <span className="text-xs font-normal opacity-80">
              揭示剩余卡片，标记本轮完成并推进复习阶段
            </span>
          </Button>
          <Button
            type="button"
            className="h-auto w-full flex-col items-center justify-center gap-1 px-4 py-4"
            variant="outline"
            disabled={submitting}
            onClick={onMarkUncompleted}
          >
            <span className="text-sm font-semibold">未完成</span>
            <span className="text-xs font-normal text-muted-foreground">
              保存当前进度，下次可继续复习；不标记完成
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
