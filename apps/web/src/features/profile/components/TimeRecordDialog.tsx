import type { FormEvent } from 'react'
import {
  formatCompletionMethod,
  formatSessionKind,
  type SessionCompletionMethod,
  type SessionKind,
} from '@/entities/session/model'
import {
  completionMethodOptions,
  sessionKindOptions,
  type TimeRecordFormState,
} from '@/features/profile/model/time-record-form'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'

interface TimeRecordDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  form: TimeRecordFormState
  error: string | null
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onChange: (patch: Partial<TimeRecordFormState>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function TimeRecordDialog({
  open,
  mode,
  form,
  error,
  isSubmitting,
  onOpenChange,
  onChange,
  onSubmit,
}: TimeRecordDialogProps) {
  const submitText = isSubmitting
    ? mode === 'create'
      ? '新增中...'
      : '保存中...'
    : mode === 'create'
      ? '新增记录'
      : '保存修改'

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[28px] border-border/70 bg-background/98 p-0">
        <DialogHeader>
          <div>
            <DialogTitle>
              {mode === 'create' ? '手动新增记录' : '编辑时间记录'}
            </DialogTitle>
            <div className="text-sm text-muted-foreground">
              {mode === 'create'
                ? '手动新增一条时间记录。'
                : '修改后会同步更新图表与统计。'}
            </div>
          </div>
          <DialogClose
            onClick={() => {
              if (!isSubmitting) onOpenChange(false)
            }}
          />
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <Label>标题</Label>
              <Input
                value={form.title}
                disabled={isSubmitting}
                onChange={(event) => onChange({ title: event.target.value })}
              />
            </label>

            <label className="space-y-2">
              <Label>类型</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.kind}
                disabled={isSubmitting}
                onChange={(event) =>
                  onChange({ kind: event.target.value as SessionKind })
                }
              >
                {sessionKindOptions.map((kind) => (
                  <option key={kind} value={kind}>
                    {formatSessionKind(kind)}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <Label>开始时间</Label>
              <Input
                type="datetime-local"
                step="1"
                value={form.startedAt}
                disabled={isSubmitting}
                onChange={(event) =>
                  onChange({ startedAt: event.target.value })
                }
              />
            </label>

            <label className="space-y-2">
              <Label>结束时间</Label>
              <Input
                type="datetime-local"
                step="1"
                value={form.endedAt}
                disabled={isSubmitting}
                onChange={(event) =>
                  onChange({ endedAt: event.target.value })
                }
              />
            </label>

            <label className="space-y-2">
              <Label>有效时长（秒）</Label>
              <Input
                type="number"
                min="0"
                value={form.effectiveSeconds}
                disabled={isSubmitting}
                onChange={(event) =>
                  onChange({ effectiveSeconds: event.target.value })
                }
              />
            </label>

            <label className="space-y-2">
              <Label>暂停次数</Label>
              <Input
                type="number"
                min="0"
                value={form.pauseCount}
                disabled={isSubmitting}
                onChange={(event) =>
                  onChange({ pauseCount: event.target.value })
                }
              />
            </label>

            <label className="space-y-2">
              <Label>完成方式</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.completionMethod}
                disabled={isSubmitting}
                onChange={(event) =>
                  onChange({
                    completionMethod:
                      event.target.value as SessionCompletionMethod,
                  })
                }
              >
                {completionMethodOptions.map((method) => (
                  <option key={method} value={method}>
                    {formatCompletionMethod(method)}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <Label>宫殿 ID（可选）</Label>
              <Input
                value={form.palaceId}
                disabled={isSubmitting}
                onChange={(event) => onChange({ palaceId: event.target.value })}
              />
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={form.durationEdited}
              disabled={isSubmitting}
              onChange={(event) =>
                onChange({ durationEdited: event.target.checked })
              }
            />
            手动调整有效时长
          </label>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {submitText}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
