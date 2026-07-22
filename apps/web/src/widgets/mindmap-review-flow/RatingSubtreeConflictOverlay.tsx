import { Button } from '@/shared/components/ui/button'
import type { RatingConflictPolicy } from '@/modules/practice/public'

export type RatingSubtreeDialogChoice = RatingConflictPolicy | 'single' | 'cancel'

export function RatingSubtreeConflictOverlay({
  conflictCount,
  onResolve,
}: {
  conflictCount: number
  onResolve: (policy: RatingSubtreeDialogChoice) => void
}) {
  const hasConflicts = conflictCount > 0
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
          {hasConflicts ? '子树中已有节点被评分' : '选择评分范围'}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {hasConflicts
            ? `当前节点有子节点，且子树中有 ${conflictCount} 个节点已在本轮被评分（含直接评分与父/子节点级联写入的分数）。可只给选中父节点单独评分；或选择「避开」只更新尚未评分的节点；或「覆盖」用当前分数替换整棵子树。`
            : '当前节点有子节点。可只给选中的父节点单独评分，或将分数级联到整棵子树。'}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onResolve('cancel')}>
            取消
          </Button>
          <Button type="button" variant="outline" onClick={() => onResolve('single')}>
            单独评分选中的父节点
          </Button>
          {hasConflicts ? (
            <Button type="button" variant="secondary" onClick={() => onResolve('skip_direct')}>
              避开
            </Button>
          ) : null}
          <Button type="button" variant="destructive" onClick={() => onResolve('overwrite')}>
            {hasConflicts ? '覆盖' : '级联评分子树'}
          </Button>
        </div>
      </div>
    </div>
  )
}
