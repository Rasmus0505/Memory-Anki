import {
  FREESTYLE_CONTENT_TYPES,
  type FreestyleActionFrequency,
  type FreestyleConfig,
  type FreestyleOrderMode,
} from '@/features/freestyle/model/freestyle'
import {
  ACTION_FREQUENCY_LABELS,
  CONTENT_TYPE_LABELS,
  ORDER_MODE_LABELS,
  QUESTION_TYPE_OPTIONS,
  RANGE_LABELS,
} from '@/features/freestyle/model/freestyle-labels'
import type {
  FreestylePalaceContext,
  FreestyleQuestionTypeFilter,
} from '@/shared/api/contracts'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Switch } from '@/shared/components/ui/switch'
import { cn } from '@/shared/lib/utils'

export function FreestyleSettingsDialog({
  open,
  config,
  palaceOptions,
  onOpenChange,
  onConfigChange,
}: {
  open: boolean
  config: FreestyleConfig
  palaceOptions: FreestylePalaceContext[]
  onOpenChange: (open: boolean) => void
  onConfigChange: (updater: (current: FreestyleConfig) => FreestyleConfig) => void
}) {
  const selectedPalaceIds = new Set(config.specificPalaceIds)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] max-w-4xl flex-col overflow-hidden rounded-lg border-border/70 bg-background p-0">
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle>随心设置</DialogTitle>
            <DialogDescription className="mt-1">范围、顺序、题型和跳转卡。</DialogDescription>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">内容范围</span>
              <select
                value={config.range}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) =>
                  onConfigChange((current) => ({
                    ...current,
                    range: event.target.value as FreestyleConfig['range'],
                  }))
                }
              >
                {Object.entries(RANGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">刷题顺序</span>
              <select
                value={config.orderMode}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) =>
                  onConfigChange((current) => ({
                    ...current,
                    orderMode: event.target.value as FreestyleOrderMode,
                  }))
                }
              >
                {Object.entries(ORDER_MODE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">题型</span>
              <select
                value={config.questionType}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) =>
                  onConfigChange((current) => ({
                    ...current,
                    questionType: event.target.value as FreestyleQuestionTypeFilter,
                  }))
                }
              >
                {QUESTION_TYPE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">跳转卡频率</span>
              <select
                value={config.actionFrequency}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) =>
                  onConfigChange((current) => ({
                    ...current,
                    actionFrequency: event.target.value as FreestyleActionFrequency,
                  }))
                }
              >
                {Object.entries(ACTION_FREQUENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {FREESTYLE_CONTENT_TYPES.map((type) => (
              <label
                key={type}
                className="flex items-center justify-between rounded-lg border border-border/70 bg-card/70 px-3 py-3 text-sm"
              >
                <span>{CONTENT_TYPE_LABELS[type]}</span>
                <Switch
                  checked={config.contentTypes[type]}
                  onCheckedChange={(checked) =>
                    onConfigChange((current) => ({
                      ...current,
                      contentTypes: {
                        ...current.contentTypes,
                        [type]: Boolean(checked),
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>

          {config.range === 'specific_palaces' ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">指定宫殿</div>
              <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border border-border/70 p-2 md:grid-cols-2">
                {palaceOptions.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">暂无宫殿</div>
                ) : (
                  palaceOptions.map((palace) => {
                    const checked = selectedPalaceIds.has(palace.id)
                    return (
                      <label
                        key={palace.id}
                        className={cn(
                          'flex min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-sm',
                          checked ? 'border-primary bg-primary/6' : 'border-border/70 bg-background',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={checked}
                          onChange={(event) => {
                            const nextChecked = event.target.checked
                            onConfigChange((current) => {
                              const currentIds = new Set(current.specificPalaceIds)
                              if (nextChecked) {
                                currentIds.add(palace.id)
                              } else {
                                currentIds.delete(palace.id)
                              }
                              return {
                                ...current,
                                specificPalaceIds: Array.from(currentIds),
                              }
                            })
                          }}
                        />
                        <span className="min-w-0 truncate">
                          {palace.resolved_title || palace.title || `宫殿 ${palace.id}`}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
