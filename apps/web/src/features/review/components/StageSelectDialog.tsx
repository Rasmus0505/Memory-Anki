import * as React from 'react'
import type { ReviewStageSummary } from '@/shared/api/contracts'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

interface StageSelectDialogProps {
  open: boolean
  stageLabels: string[]
  stages: ReviewStageSummary[]
  currentReviewNumber: number
  onConfirm: (targetReviewNumber: number) => void
  onCancel: () => void
}

function getStageTooltip(stage: ReviewStageSummary): string {
  if (stage.completed && stage.completed_at) {
    return `${stage.label} · 已完成`
  }
  if (stage.scheduled_at) {
    return `${stage.label} · 预计 ${stage.scheduled_at}`
  }
  return stage.label
}

export function StageSelectDialog({
  open,
  stageLabels,
  stages,
  currentReviewNumber,
  onConfirm,
  onCancel,
}: StageSelectDialogProps) {
  const normalizedStages: ReviewStageSummary[] =
    stages.length === stageLabels.length
      ? stages
      : stageLabels.map((label, index) => ({
          review_number: index,
          label,
          completed: index <= currentReviewNumber,
          completed_at: null,
          scheduled_at: null,
        }))

  const defaultTarget = currentReviewNumber

  const [selectedNumber, setSelectedNumber] = React.useState<number>(defaultTarget)

  React.useEffect(() => {
    if (open) {
      setSelectedNumber(defaultTarget)
    }
  }, [open, defaultTarget])

  const defaultLabel = normalizedStages[defaultTarget]?.label ?? `第 ${defaultTarget + 1} 次`
  const nextAfterDefault = normalizedStages[defaultTarget + 1]
  const nextAfterDefaultLabel = nextAfterDefault?.label ?? '完成全部'

  const handleConfirm = () => {
    onConfirm(selectedNumber)
  }

  const total = normalizedStages.length
  if (total <= 0) return null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>选择复习进度</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-6 py-4">
          <p className="text-sm text-muted-foreground">
            当前正在复习{' '}
            <span className="font-medium text-foreground">
              第 {currentReviewNumber + 1} 次（{normalizedStages[currentReviewNumber]?.label ?? '?'}）
            </span>
            。默认完成后标记第 {defaultTarget + 1} 次为已完成，下次复习将是{' '}
            <span className="font-medium text-foreground">
              第 {defaultTarget + 2} 次（{nextAfterDefaultLabel}）
            </span>
            。你也可以选择其他节点来调整进度：
          </p>

          <div className="relative py-6">
            <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200" />
            <div className="relative flex items-center justify-between">
              {normalizedStages.map((stage, index) => {
                const isCompleted = stage.completed && index <= currentReviewNumber
                const isCurrent = index === currentReviewNumber
                const isDefault = index === defaultTarget
                const isSelected = index === selectedNumber
                const isPast = index < currentReviewNumber

                return (
                  <button
                    key={stage.review_number}
                    type="button"
                    title={getStageTooltip(stage)}
                    onClick={() => setSelectedNumber(index)}
                    className={cn(
                      'relative h-5 w-5 rounded-full border-2 transition-all',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isCompleted
                        ? 'border-emerald-400 bg-emerald-500'
                        : isPast
                          ? 'border-slate-400 bg-slate-300'
                          : 'border-slate-300 bg-white',
                      isDefault && !isSelected && 'ring-2 ring-blue-300 ring-offset-1',
                      isSelected && 'ring-2 ring-amber-400 ring-offset-1 scale-125',
                      isCurrent && 'border-slate-700',
                    )}
                  >
                    {(isSelected || isDefault) && (
                      <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                        {stage.label}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            {selectedNumber === defaultTarget
              ? `默认（标记第 ${defaultTarget + 1} 次完成）`
              : `标记第 ${selectedNumber + 1} 次完成（${normalizedStages[selectedNumber]?.label ?? '?'}）`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
