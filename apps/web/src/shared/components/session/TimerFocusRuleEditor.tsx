import { Input } from '@/shared/components/ui/input'
import { DEFAULT_TIMER_FOCUS_CONFIG } from '@/shared/components/session/timer-focus-config'
import type { FocusDraft, FocusFieldKey } from '@/shared/components/session/timerAutomationDialogModel'

export function FocusRuleEditor({
  value,
  onFieldChange,
}: {
  value: FocusDraft
  onFieldChange: (field: FocusFieldKey, value: string) => void
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <label className="space-y-1.5 text-sm">
        <span className="text-xs text-muted-foreground">每轮专注目标（分钟）</span>
        <Input
          aria-label="每轮专注目标分钟"
          inputMode="numeric"
          value={value.primaryMinutes}
          onChange={(event) => onFieldChange('primaryMinutes', event.target.value)}
        />
      </label>
      <label className="space-y-1.5 text-sm">
        <span className="text-xs text-muted-foreground">阶段提醒间隔（分钟）</span>
        <Input
          aria-label="阶段提醒间隔分钟"
          inputMode="numeric"
          value={value.secondaryMinutes}
          onChange={(event) => onFieldChange('secondaryMinutes', event.target.value)}
        />
      </label>
      <div className="text-xs text-muted-foreground md:col-span-2">
        {`默认：每轮 ${DEFAULT_TIMER_FOCUS_CONFIG.primaryMinutes} 分钟，每 ${DEFAULT_TIMER_FOCUS_CONFIG.secondaryMinutes} 分钟轻提醒一次。`}
      </div>
    </div>
  )
}
