import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import type { TimerAutomationRule } from '@/shared/components/session/timer-automation-config'
import type { FieldKey } from '@/shared/components/session/timerAutomationDialogModel'

export function RuleEditor({
  label,
  description,
  value,
  onFieldChange,
  onAutoStartChange,
  defaults,
  compact = false,
}: {
  label: string
  description: string
  value: {
    autoStartOnPageEnter: boolean
    inactiveAutoPauseSeconds: string
    inactivePauseGraceSeconds: string
    hiddenAutoPauseSeconds: string
    autoPauseRollbackSeconds: string
  }
  onFieldChange: (field: FieldKey, value: string) => void
  onAutoStartChange: (checked: boolean) => void
  defaults: TimerAutomationRule
  compact?: boolean
}) {
  return (
    <div className={cn('rounded-lg border border-border/70 bg-card/70', compact ? 'p-3.5' : 'p-4')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground">{label}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <label className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-xs">
          <input
            type="checkbox"
            className="size-4"
            checked={value.autoStartOnPageEnter}
            onChange={(event) => onAutoStartChange(event.target.checked)}
          />
          <span>{`${label}进入页面自动开始`}</span>
        </label>
      </div>

      <div className={cn('mt-3 grid gap-3', compact ? 'md:grid-cols-2' : 'lg:grid-cols-2')}>
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">闲置预警阈值（秒）</span>
          <Input
            inputMode="numeric"
            value={value.inactiveAutoPauseSeconds}
            onChange={(event) => onFieldChange('inactiveAutoPauseSeconds', event.target.value)}
          />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">预警宽限时间（秒）</span>
          <Input
            inputMode="numeric"
            value={value.inactivePauseGraceSeconds}
            onChange={(event) => onFieldChange('inactivePauseGraceSeconds', event.target.value)}
          />
        </label>
      </div>

      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        达到闲置阈值后先显示“仍在学习吗”，宽限期内任意有效学习操作都会继续计时。
      </p>

      <details className="mt-3 rounded-lg border border-border/60 bg-background/45 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-foreground">高级暂停规则</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="text-xs text-muted-foreground">后台/失焦自动暂停（秒）</span>
            <Input
              inputMode="numeric"
              value={value.hiddenAutoPauseSeconds}
              onChange={(event) => onFieldChange('hiddenAutoPauseSeconds', event.target.value)}
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-xs text-muted-foreground">自动暂停回退时长（秒）</span>
            <Input
              inputMode="numeric"
              value={value.autoPauseRollbackSeconds}
              onChange={(event) => onFieldChange('autoPauseRollbackSeconds', event.target.value)}
            />
          </label>
        </div>
      </details>

      <div className="mt-3 text-xs text-muted-foreground">
        默认值：
        {` 自动开始 ${defaults.autoStartOnPageEnter ? '开' : '关'}，闲置 ${defaults.inactiveAutoPauseSeconds}s 后预警，宽限 ${defaults.inactivePauseGraceSeconds ?? 30}s，回退 ${defaults.autoPauseRollbackSeconds}s`}
      </div>
    </div>
  )
}
