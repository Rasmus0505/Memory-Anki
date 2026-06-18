import type { PalaceGroupedItem } from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import {
  formatRelativeReviewTime,
  getSegmentDisplayName,
} from '@/features/palace-catalog/components/palace-list/utils'

interface PalaceBatchReviewDialogProps {
  palace: PalaceGroupedItem | null
  selectedSegmentIds: number[]
  onToggleSegment: (segmentId: number, checked: boolean) => void
  onClose: () => void
  onStart: () => void
}

export function PalaceBatchReviewDialog({
  palace,
  selectedSegmentIds,
  onToggleSegment,
  onClose,
  onStart,
}: PalaceBatchReviewDialogProps) {
  const dueSegments =
    palace?.segments?.filter(
      (segment) =>
        !segment.is_virtual_default &&
        segment.has_due_review &&
        Boolean(segment.current_review_schedule_id),
    ) ?? []

  return (
    <Dialog open={palace !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div>
            <DialogTitle>开始多块复习</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {palace?.title || '当前宫殿'} 中当前到期的分块会合并成一张思维导图，一次完成复习。
            </p>
          </div>
          <DialogClose onClick={onClose} />
        </DialogHeader>
        <div className="space-y-3 p-1">
          {dueSegments.map((segment, index) => {
            const checked = selectedSegmentIds.includes(segment.id)
            return (
              <label
                key={segment.id}
                className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/70 bg-background/80 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-accent/30"
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-input"
                  checked={checked}
                  onChange={(event) => onToggleSegment(segment.id, event.target.checked)}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: segment.color }}
                    />
                    <span className="truncate text-sm font-medium">
                      {getSegmentDisplayName(segment, index)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{segment.node_count} 节点</span>
                    <span>预计 {formatRelativeReviewTime(segment.next_review_at)}</span>
                    <span>{segment.estimated_review_seconds || 0} 秒</span>
                  </div>
                </div>
              </label>
            )
          })}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">已选择 {selectedSegmentIds.length} 个分块</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button onClick={onStart} disabled={selectedSegmentIds.length === 0}>
              开始复习
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
