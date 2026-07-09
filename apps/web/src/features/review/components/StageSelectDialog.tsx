import * as React from 'react'
import { formatDuration } from '@/entities/session/model'
import type { ReviewStageSummary } from '@/shared/api/contracts'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import { isEditableKeyboardTarget } from '@/shared/keyboard/keyboardTargets'
import { cn } from '@/shared/lib/utils'

interface StageSelectDialogProps {
  open: boolean
  stageLabels: string[]
  stages: ReviewStageSummary[]
  currentReviewNumber: number
  durationSeconds?: number
  onConfirm: (targetReviewNumber: number, needsPractice: boolean, note: string) => void
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
  durationSeconds,
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
  const [note, setNote] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setSelectedNumber(defaultTarget)
      setNote('')
    }
  }, [open, defaultTarget])

  const nextAfterDefault = normalizedStages[defaultTarget + 1]
  const nextAfterDefaultLabel = nextAfterDefault?.label ?? '完成全部'

  const handleConfirm = (needsPractice: boolean) => {
    onConfirm(selectedNumber, needsPractice, note.trim())
  }

  const total = normalizedStages.length
  const numberShortcutLimit = Math.min(5, total)

  React.useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (isEditableKeyboardTarget(event.target)) return
      const digit = event.code.startsWith('Digit')
        ? Number(event.code.slice('Digit'.length))
        : Number(event.key)
      if (!Number.isInteger(digit) || digit < 1 || digit > numberShortcutLimit) return
      event.preventDefault()
      event.stopPropagation()
      setSelectedNumber(digit - 1)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [numberShortcutLimit, open])

  if (total <= 0) return null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>选择复习进度</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 px-6 py-4">
          {typeof durationSeconds === 'number' ? (
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              本次耗时：<span className="font-medium text-foreground">{formatDuration(durationSeconds)}</span>
            </div>
          ) : null}
          <p className="text-sm text-muted-foreground">
            当前正在复习{' '}
            <span className="font-medium text-foreground">
              第 {currentReviewNumber + 1} 次（{normalizedStages[currentReviewNumber]?.label ?? '?'}）
            </span>
            。默认完成后标记第 {defaultTarget + 1} 次为已完成，下次复习将是{' '}
            <span className="font-medium text-foreground">
              第 {defaultTarget + 2} 次（{nextAfterDefaultLabel}）
            </span>
            。你也可以选择其他阶段来调整进度：
          </p>
          {numberShortcutLimit > 0 ? (
            <p className="text-xs text-muted-foreground">
              快捷键 1-{numberShortcutLimit} 可选择前 {numberShortcutLimit} 个复习阶段。
            </p>
          ) : null}

          <div className="relative py-6">
            <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-border" />
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
                    title={`${getStageTooltip(stage)}${index < 5 ? ` · 快捷键 ${index + 1}` : ''}`}
                    onClick={() => setSelectedNumber(index)}
                    className={cn(
                      'relative size-5 rounded-full border-2 transition-all',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isCompleted
                        ? 'border-success bg-success'
                        : isPast
                          ? 'border-muted-foreground/40 bg-muted-foreground/20'
                          : 'border-border bg-background',
                      isDefault && !isSelected && 'ring-2 ring-info ring-offset-1',
                      isSelected && 'ring-2 ring-warning ring-offset-1 scale-125',
                      isCurrent && 'border-muted-foreground',
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

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              复盘一句（可选）：这次哪里卡了、下次注意什么
            </div>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：心脏瓣膜顺序又忘了，下次先背口诀"
              rows={2}
              maxLength={500}
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          <Button variant="outline" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleConfirm(true)}>
            完成，但仍需练习
          </Button>
          <Button size="sm" onClick={() => handleConfirm(false)}>
            {selectedNumber === defaultTarget
              ? `默认（标记第 ${defaultTarget + 1} 次完成）`
              : `标记第 ${selectedNumber + 1} 次完成（${normalizedStages[selectedNumber]?.label ?? '?'}）`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
