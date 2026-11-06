import { useEffect, useRef, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { useConfirmEnter } from '@/shared/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'

export type QuizProgressClearScope = 'palace' | 'all'

export interface QuizProgressClearChoice {
  scope: QuizProgressClearScope
  palaceId: number | null
}

/**
 * Two scopes only: the palace the learner is in, or everything. Clearing one
 * question was a third way to say "the row I am looking at", and a palace
 * dropdown asked the learner to re-pick a palace the window already knows.
 */
export function QuizProgressClearDialog({
  open,
  onOpenChange,
  defaultPalaceId,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The palace this window is showing. Null disables 当前宫殿. */
  defaultPalaceId: number | null
  onConfirm: (choice: QuizProgressClearChoice) => void
}) {
  const [scope, setScope] = useState<QuizProgressClearScope>('all')
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setScope(defaultPalaceId != null ? 'palace' : 'all')
  }, [defaultPalaceId, open])

  const canConfirm = scope === 'all' || defaultPalaceId != null

  const confirm = () => {
    if (!canConfirm) return
    onConfirm({
      scope,
      palaceId: scope === 'palace' ? defaultPalaceId : null,
    })
    onOpenChange(false)
  }
  useConfirmEnter(open, panelRef, confirm)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={panelRef}
        className="max-w-md"
        floatingId="quiz-progress-clear"
        data-confirm-dialog={open ? 'open' : undefined}
      >
        <DialogHeader>
          <DialogTitle>清除做题进度</DialogTitle>
          <DialogDescription>
            题目保留，作答次数不变。
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="清除范围" className="space-y-3 text-sm">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              className="mt-1"
              name="quiz-progress-clear-scope"
              aria-label="当前宫殿"
              checked={scope === 'palace'}
              disabled={defaultPalaceId == null}
              onChange={() => setScope('palace')}
            />
            <span className="font-medium">当前宫殿</span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              className="mt-1"
              name="quiz-progress-clear-scope"
              aria-label="全部宫殿"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            <span className="font-medium">全部宫殿</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="destructive" disabled={!canConfirm} onClick={confirm}>清除</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
