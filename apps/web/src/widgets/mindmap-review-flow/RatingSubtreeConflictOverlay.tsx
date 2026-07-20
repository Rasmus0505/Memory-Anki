import { Button } from '@/shared/components/ui/button'
import type { RatingConflictPolicy } from '@/features/review/api'

export function RatingSubtreeConflictOverlay({
  conflictCount,
  onResolve,
}: {
  conflictCount: number
  onResolve: (policy: RatingConflictPolicy | 'cancel') => void
}) {
  return (
    <div
      // fixed + high z-index so PWA / fullscreen / overflow-hidden frames still show the dialog
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-background/70 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rating-conflict-title"
      data-testid="rating-conflict-dialog"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-2xl">
        <h2 id="rating-conflict-title" className="text-base font-semibold text-foreground">
          子节点已有单独评分
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          当前子树中有 {conflictCount} 个节点已在本轮被评分（含子节点级联到孙节点的评分）。
          选择「避开」只更新尚未评分的节点，已有分数的子/孙节点全部保留；选择「覆盖」用父节点分数替换它们。
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onResolve('cancel')}>
            取消
          </Button>
          <Button type="button" variant="secondary" onClick={() => onResolve('skip_direct')}>
            避开
          </Button>
          <Button type="button" variant="destructive" onClick={() => onResolve('overwrite')}>
            覆盖
          </Button>
        </div>
      </div>
    </div>
  )
}
