import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Plus } from 'lucide-react'
import type { TimeRecordQuickAddFormState } from '@/features/profile/model/time-record-form'
import {
  QUICK_ADD_MINUTE_PRESETS,
  createCustomTimeRecordTag,
  listTimeRecordTagOptions,
  type CustomTimeRecordTag,
} from '@/features/profile/model/time-record-tags'
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

interface TimeRecordQuickAddDialogProps {
  open: boolean
  form: TimeRecordQuickAddFormState
  customTags: CustomTimeRecordTag[]
  error: string | null
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onChange: (patch: Partial<TimeRecordQuickAddFormState>) => void
  onCustomTagsChange: (tags: CustomTimeRecordTag[]) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function TimeRecordQuickAddDialog({
  open,
  form,
  customTags,
  error,
  isSubmitting,
  onOpenChange,
  onChange,
  onCustomTagsChange,
  onSubmit,
}: TimeRecordQuickAddDialogProps) {
  const minutesRef = useRef<HTMLInputElement | null>(null)
  const [newTagName, setNewTagName] = useState('')
  const [tagError, setTagError] = useState<string | null>(null)
  const [creatingTag, setCreatingTag] = useState(false)
  const tagOptions = useMemo(
    () => listTimeRecordTagOptions(customTags),
    [customTags],
  )

  useEffect(() => {
    if (!open) {
      setNewTagName('')
      setTagError(null)
      setCreatingTag(false)
      return
    }
    const timer = window.setTimeout(() => {
      minutesRef.current?.focus()
      minutesRef.current?.select()
    }, 50)
    return () => window.clearTimeout(timer)
  }, [open])

  const handleCreateTag = () => {
    const result = createCustomTimeRecordTag(newTagName, customTags)
    if ('error' in result) {
      setTagError(result.error)
      return
    }
    onCustomTagsChange(result.tags)
    onChange({ tagId: result.tag.id })
    setNewTagName('')
    setTagError(null)
    setCreatingTag(false)
  }

  const handleMinutesKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      // Allow form submit via Enter in minutes field.
      return
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-lg border-border/70 bg-background/98 p-0 sm:max-w-lg">
        <DialogHeader>
          <div>
            <DialogTitle>快速记一笔</DialogTitle>
            <div className="text-sm text-muted-foreground">
              选标签、填分钟即可；适合补记未走计时器的学习时长。
            </div>
          </div>
          <DialogClose
            onClick={() => {
              if (!isSubmitting) onOpenChange(false)
            }}
          />
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5 p-6">
          <div className="space-y-2">
            <Label>标签</Label>
            <div className="flex flex-wrap gap-2">
              {tagOptions.map((tag) => {
                const selected = form.tagId === tag.id
                return (
                  <Button
                    key={tag.id}
                    type="button"
                    size="sm"
                    variant={selected ? 'default' : 'outline'}
                    className="h-8"
                    disabled={isSubmitting}
                    onClick={() => onChange({ tagId: tag.id })}
                  >
                    {tag.name}
                  </Button>
                )
              })}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                disabled={isSubmitting}
                onClick={() => {
                  setCreatingTag((current) => !current)
                  setTagError(null)
                }}
              >
                <Plus className="mr-1 size-3.5" />
                新建
              </Button>
            </div>
            {creatingTag ? (
              <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                <div className="flex gap-2">
                  <Input
                    value={newTagName}
                    placeholder="例如：论文、读书"
                    maxLength={20}
                    disabled={isSubmitting}
                    onChange={(event) => {
                      setNewTagName(event.target.value)
                      setTagError(null)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        handleCreateTag()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    disabled={isSubmitting || !newTagName.trim()}
                    onClick={handleCreateTag}
                  >
                    添加
                  </Button>
                </div>
                {tagError ? (
                  <div className="text-sm text-destructive">{tagError}</div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    回车添加，最多 20 字，两台设备会同步。
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="quick-add-minutes">时长（分钟）</Label>
            <Input
              id="quick-add-minutes"
              ref={minutesRef}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={form.minutes}
              disabled={isSubmitting}
              onChange={(event) => onChange({ minutes: event.target.value })}
              onKeyDown={handleMinutesKeyDown}
            />
            <div className="flex flex-wrap gap-2">
              {QUICK_ADD_MINUTE_PRESETS.map((minutes) => (
                <Button
                  key={minutes}
                  type="button"
                  size="sm"
                  variant={form.minutes === String(minutes) ? 'default' : 'outline'}
                  className="h-7 px-2"
                  disabled={isSubmitting}
                  onClick={() => onChange({ minutes: String(minutes) })}
                >
                  {minutes}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="quick-add-date">日期</Label>
            <Input
              id="quick-add-date"
              type="date"
              value={form.date}
              disabled={isSubmitting}
              onChange={(event) => onChange({ date: event.target.value })}
            />
          </div>

          <button
            type="button"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => onChange({ showAdvanced: !form.showAdvanced })}
          >
            {form.showAdvanced ? '收起更多选项' : '更多选项（标题 / 起止时间）'}
          </button>

          {form.showAdvanced ? (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 md:col-span-2">
                <Label>标题</Label>
                <Input
                  value={form.title}
                  disabled={isSubmitting}
                  onChange={(event) => onChange({ title: event.target.value })}
                />
              </label>
              <label className="space-y-2">
                <Label>开始时间</Label>
                <Input
                  type="datetime-local"
                  step="1"
                  value={form.startedAt}
                  disabled={isSubmitting}
                  onChange={(event) =>
                    onChange({
                      startedAt: event.target.value,
                      titleEdited: true,
                      showAdvanced: true,
                    })
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
                    onChange({
                      endedAt: event.target.value,
                      titleEdited: true,
                      showAdvanced: true,
                    })
                  }
                />
              </label>
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
              {isSubmitting ? '添加中...' : '添加'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
