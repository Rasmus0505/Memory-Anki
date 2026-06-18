import { formatStageDateTime } from '@/features/palace-catalog/components/palace-list/PalaceStageProgress'
import type { StageEditState } from '@/features/palace-catalog/components/palace-list/utils'
import { getSegmentDisplayName } from '@/features/palace-catalog/components/palace-list/utils'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'

interface PalaceStageEditDialogProps {
  stageEdit: StageEditState | null
  stageCompletedAt: string
  stageEditError: string | null
  stageEditSaving: boolean
  onStageCompletedAtChange: (value: string) => void
  onClose: () => void
  onSaveCompletedAt: () => void
  onAdvanceToStage: () => void
  onRollbackBeforeStage: () => void
}

export function PalaceStageEditDialog({
  stageEdit,
  stageCompletedAt,
  stageEditError,
  stageEditSaving,
  onStageCompletedAtChange,
  onClose,
  onSaveCompletedAt,
  onAdvanceToStage,
  onRollbackBeforeStage,
}: PalaceStageEditDialogProps) {
  return (
    <Dialog open={stageEdit !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div>
            <DialogTitle>
              {stageEdit?.segment
                ? `${getSegmentDisplayName(stageEdit.segment, 0)} · ${stageEdit.stage.label}`
                : '复习节点'}
            </DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {stageEdit?.stage.completed
                ? `完成于 ${formatStageDateTime(stageEdit.stage.completed_at)}`
                : `预计 ${formatStageDateTime(stageEdit?.stage.scheduled_at ?? null)}`}
            </p>
          </div>
          <DialogClose onClick={onClose} />
        </DialogHeader>

        <div className="space-y-4 p-6">
          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">完成时间</span>
            <Input
              type="datetime-local"
              value={stageCompletedAt}
              onChange={(event) => onStageCompletedAtChange(event.target.value)}
            />
          </label>

          {stageEditError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {stageEditError}
            </div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={stageEditSaving}>
              取消
            </Button>
            {stageEdit?.stage.completed ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onRollbackBeforeStage}
                  disabled={stageEditSaving}
                >
                  退回到此节点前
                </Button>
                <Button type="button" onClick={onSaveCompletedAt} disabled={stageEditSaving}>
                  保存时间
                </Button>
              </>
            ) : (
              <Button type="button" onClick={onAdvanceToStage} disabled={stageEditSaving}>
                前进到此节点
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
