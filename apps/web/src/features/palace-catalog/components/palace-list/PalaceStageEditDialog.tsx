import type { ReviewStageAdjustmentResponse } from '@/shared/api/contracts'
import type { StageEditState } from '@/features/palace-catalog/components/palace-list/utils'
import { formatApiDateTime } from '@/shared/lib/dateTime'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Switch } from '@/shared/components/ui/switch'
import { Textarea } from '@/shared/components/ui/textarea'

interface PalaceStageEditDialogProps {
  stageEdit: StageEditState | null
  completedAt: string
  needsPractice: boolean
  note: string
  preview: ReviewStageAdjustmentResponse | null
  previewLoading: boolean
  error: string | null
  saving: boolean
  onCompletedAtChange: (value: string) => void
  onNeedsPracticeChange: (value: boolean) => void
  onNoteChange: (value: string) => void
  onClose: () => void
  onConfirm: () => void
  onReset: () => void
}

function stageCountLabel(count: number, stageLabel: string | null) {
  return count > 0 ? `${count} 个阶段（${stageLabel ?? '未知阶段'}）` : '未开始'
}

function affectedStageText(labels: string[]) {
  return labels.length > 0 ? labels.join('、') : '无'
}

export function PalaceStageEditDialog({
  stageEdit,
  completedAt,
  needsPractice,
  note,
  preview,
  previewLoading,
  error,
  saving,
  onCompletedAtChange,
  onNeedsPracticeChange,
  onNoteChange,
  onClose,
  onConfirm,
  onReset,
}: PalaceStageEditDialogProps) {
  const targetLabel = stageEdit?.stage.label ?? preview?.target_stage_label ?? '所选阶段'
  const isBackward = preview?.direction === 'backward' || preview?.direction === 'reset'
  const canReset = (preview?.previous_completed_count ?? stageEdit?.palace.review_stage_completed ?? 0) > 0

  return (
    <Dialog open={stageEdit !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>调整宫殿复习进度</DialogTitle>
          <DialogDescription>{stageEdit?.palace.resolved_title ?? stageEdit?.palace.title}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <div className="rounded-xl border border-border/70 bg-muted/30 p-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs text-muted-foreground">当前进度</div>
                <div className="mt-1 font-medium">
                  {stageCountLabel(
                    preview?.previous_completed_count ?? stageEdit?.palace.review_stage_completed ?? 0,
                    preview?.current_stage_label ?? null,
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">目标进度</div>
                <div className="mt-1 font-medium">
                  {stageCountLabel(stageEdit?.targetCompletedCount ?? 0, targetLabel)}
                </div>
              </div>
            </div>
          </div>

          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">目标阶段完成时间</span>
            <Input
              type="datetime-local"
              value={completedAt}
              onChange={(event) => onCompletedAtChange(event.target.value)}
              disabled={saving}
            />
          </label>

          <label className="flex items-center justify-between gap-4 rounded-xl border border-border/70 px-4 py-3">
            <span>
              <span className="block text-sm font-medium">仍需练习</span>
              <span className="block text-xs text-muted-foreground">保留在需要额外练习的宫殿范围中</span>
            </span>
            <Switch
              checked={needsPractice}
              onCheckedChange={onNeedsPracticeChange}
              disabled={saving}
              aria-label="仍需练习"
            />
          </label>

          <label className="space-y-2">
            <span className="text-sm font-medium text-foreground">调整原因（可选）</span>
            <Textarea
              value={note}
              onChange={(event) => onNoteChange(event.target.value)}
              placeholder="例如：补录线下复习，或修正误操作的阶段"
              rows={2}
              maxLength={2000}
              disabled={saving}
            />
          </label>

          <div className="rounded-xl border border-border/70 p-4 text-sm">
            <div className="font-medium">影响预览</div>
            {previewLoading ? (
              <p className="mt-2 text-muted-foreground">正在计算新的复习安排…</p>
            ) : preview ? (
              <div className="mt-3 space-y-2 text-muted-foreground">
                <p>保留阶段：{affectedStageText(preview.preserved_stage_labels)}</p>
                <p>新增完成：{affectedStageText(preview.added_stage_labels)}</p>
                <p>撤销完成：{affectedStageText(preview.removed_stage_labels)}</p>
                <p>
                  下次复习：{preview.next_stage_label ?? '已完成全部阶段'}
                  {preview.next_review_at ? ` · ${formatApiDateTime(preview.next_review_at)}` : ''}
                </p>
              </div>
            ) : (
              <p className="mt-2 text-muted-foreground">暂无可用预览。</p>
            )}
          </div>

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-wrap justify-between">
          <div>
            {canReset ? (
              <Button type="button" variant="ghost" className="text-destructive" onClick={onReset} disabled={saving}>
                重置为未开始
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              取消
            </Button>
            <Button
              type="button"
              variant={isBackward ? 'destructive' : 'default'}
              onClick={onConfirm}
              loading={saving}
              loadingText="正在调整"
              disabled={!preview || previewLoading}
            >
              调整到“{targetLabel}”
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
