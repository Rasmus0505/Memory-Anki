import type { AutomationDraft, FieldKey } from '@/shared/components/session/timerAutomationDialogModel'
import { Input } from '@/shared/components/ui/input'

export function TimerAutomationSection({
  draft,
  onFieldChange,
  onAutoStartChange,
}: {
  draft: AutomationDraft
  onModeChange: (mode: AutomationDraft['mode']) => void
  onFieldChange: (scene: 'shared', field: FieldKey, value: string) => void
  onAutoStartChange: (scene: 'shared', checked: boolean) => void
  onActionChange: (field: never, checked: boolean) => void
}) {
  const idleMinutes = Math.max(1, Math.round((Number(draft.shared.inactiveAutoPauseSeconds) || 120) / 60))

  return (
    <div className="rounded-lg border border-border/70 bg-card/70 p-4">
      <div>
        <div className="text-sm font-semibold text-foreground">自动计时</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          所有学习页面共用同一套规则。只有主应用内容区内的鼠标点击会续活；切换到其他窗口或标签页会立即暂停。
        </p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="rounded-lg border border-border/60 bg-background/60 px-3 py-3 text-sm">
          <span className="block font-medium text-foreground">无点击自动暂停</span>
          <span className="mt-1 block text-xs text-muted-foreground">持续多少分钟没有点击主应用内容后暂停。</span>
          <div className="mt-3 flex items-center gap-2">
            <Input
              aria-label="无点击自动暂停分钟"
              type="number"
              min={1}
              max={180}
              value={idleMinutes}
              onChange={(event) => {
                const minutes = Math.max(1, Math.round(Number(event.target.value) || 1))
                onFieldChange('shared', 'inactiveAutoPauseSeconds', String(minutes * 60))
              }}
            />
            <span className="shrink-0 text-xs text-muted-foreground">分钟</span>
          </div>
        </label>

        <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-background/60 px-3 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={draft.shared.autoStartOnPageEnter}
            onChange={(event) => onAutoStartChange('shared', event.target.checked)}
          />
          <span>
            <span className="block font-medium text-foreground">进入学习页面自动开始</span>
            <span className="mt-1 block text-xs text-muted-foreground">所有编辑、练习、复习、测验与英语页面统一使用。</span>
          </span>
        </label>
      </div>
    </div>
  )
}
