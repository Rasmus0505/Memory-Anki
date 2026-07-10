import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import type { TimerFocusRule } from '@/shared/components/session/timer-focus-config'
import type { FocusFieldKey } from '@/shared/components/session/timerAutomationDialogModel'

export function FocusRuleEditor({
  label,
  value,
  defaults,
  onFieldChange,
  compact = false,
}: {
  label: string
  value: {
    primaryMinutes: string
    secondaryMinutes: string
    breakMinutes: string
  }
  defaults: TimerFocusRule
  onFieldChange: (field: FocusFieldKey, value: string) => void
  compact?: boolean
}) {
  return (
    <div className={cn('rounded-lg border border-border/70 bg-card/70', compact ? 'p-3.5' : 'p-4')}>
      <div className="text-sm font-semibold text-foreground">{label}</div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        主数字持续显示本次有效学习时长；轮次目标显示进度，阶段间隔只负责轻量提醒。
      </p>
      <div className={cn('mt-3 grid gap-3', compact ? 'md:grid-cols-3' : 'lg:grid-cols-3')}>
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">每轮专注目标（分钟）</span>
          <Input
            inputMode="numeric"
            value={value.primaryMinutes}
            onChange={(event) => onFieldChange('primaryMinutes', event.target.value)}
          />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">阶段提醒间隔（分钟）</span>
          <Input
            inputMode="numeric"
            value={value.secondaryMinutes}
            onChange={(event) => onFieldChange('secondaryMinutes', event.target.value)}
          />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">建议休息（分钟）</span>
          <Input
            inputMode="numeric"
            value={value.breakMinutes}
            onChange={(event) => onFieldChange('breakMinutes', event.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        默认值：
        {` 每轮 ${defaults.primaryMinutes} 分钟，每 ${Math.min(defaults.primaryMinutes, defaults.secondaryMinutes)} 分钟轻提醒，建议休息 ${defaults.breakMinutes ?? 5} 分钟`}
      </div>
    </div>
  )
}
