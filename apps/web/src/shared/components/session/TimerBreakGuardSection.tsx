import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import type {
  BreakGuardAlertStrength,
  BreakGuardConfig,
} from '@/shared/components/session/break-guard-config'
import type {
  BreakBooleanFieldKey,
  BreakDraft,
  BreakNumberFieldKey,
  BreakTextFieldKey,
} from '@/shared/components/session/timerAutomationDialogModel'

export function TimerBreakGuardSection({
  breakDraft,
  parsedBreakConfig,
  onBreakBooleanChange,
  onBreakNumberChange,
  onBreakTextChange,
  onBreakAlertStrengthChange,
}: {
  breakDraft: BreakDraft
  parsedBreakConfig: BreakGuardConfig
  onBreakBooleanChange: (field: BreakBooleanFieldKey, checked: boolean) => void
  onBreakNumberChange: (field: BreakNumberFieldKey, value: string) => void
  onBreakTextChange: (field: BreakTextFieldKey, value: string) => void
  onBreakAlertStrengthChange: (value: BreakGuardAlertStrength) => void
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/70 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">休息设置</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            完成一轮后可手动开始 5 分钟休息；到点只提醒，下一轮需要手动开始。
          </p>
        </div>
        <label className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-1.5 text-xs">
          <input
            type="checkbox"
            className="size-4"
            checked={breakDraft.enabled}
            onChange={(event) => onBreakBooleanChange('enabled', event.target.checked)}
          />
          启用休息倒计时
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={breakDraft.promptOnWindowLeave}
            onChange={(event) => onBreakBooleanChange('promptOnWindowLeave', event.target.checked)}
          />
          <span>
            <span className="block font-medium text-foreground">离开窗口时询问是否休息</span>
            <span className="text-xs text-muted-foreground">默认关闭，查资料或查看 PDF 时不会弹出休息询问。</span>
          </span>
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">休息时长按钮（分钟，英文逗号分隔）</span>
          <Input
            value={breakDraft.presetMinutes}
            onChange={(event) => onBreakTextChange('presetMinutes', event.target.value)}
            placeholder="5"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {([
          ['gentle', '温和提醒（推荐）', '到点后提示休息结束，但不会自动开始下一轮学习。'],
          ['strong', '强提醒', '使用更明显的到点提醒，并可把主窗口带回目标页面。'],
        ] as const).map(([value, title, description]) => (
          <button
            key={value}
            type="button"
            className={cn(
              'rounded-lg border px-4 py-4 text-left transition-all',
              breakDraft.alertStrength === value
                ? 'border-primary bg-primary/8 shadow-sm ring-1 ring-primary/30'
                : 'border-border/70 bg-background/70 hover:bg-secondary/70',
            )}
            onClick={() => onBreakAlertStrengthChange(value)}
          >
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
          </button>
        ))}
      </div>

      <details className="mt-4 rounded-lg border border-border/70 bg-background/45 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          高级设置：离开检测、自动结束与日志
        </summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {([
            ['allowCustomMinutes', '允许自定义时长', '休息询问里展示自定义分钟输入。'],
            ['autoFinishOnStudyReturn', '学习即结束休息', '检测到学习操作时自动结束休息；默认关闭。'],
            ['resumeInterruptedStudyOnReturn', '自动恢复学习计时', '休息结束时自动恢复之前的学习计时；默认关闭。'],
            ['recordBreakLogs', '记录休息日志', '记录开始、结束、超时和延后次数。'],
          ] as const).map(([field, title, description]) => (
            <label key={field} className="flex items-start gap-3 rounded-xl border border-border/60 bg-card/60 px-3 py-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={breakDraft[field]}
                onChange={(event) => onBreakBooleanChange(field, event.target.checked)}
              />
              <span>
                <span className="block font-medium text-foreground">{title}</span>
                <span className="text-xs text-muted-foreground">{description}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1.5 text-sm">
            <span className="text-xs text-muted-foreground">离开后询问延迟（秒）</span>
            <Input
              inputMode="numeric"
              value={breakDraft.promptDelaySeconds}
              onChange={(event) => onBreakNumberChange('promptDelaySeconds', event.target.value)}
            />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="text-xs text-muted-foreground">休息到点后打开路径</span>
            <Input
              value={breakDraft.targetPath}
              onChange={(event) => onBreakTextChange('targetPath', event.target.value)}
              placeholder="/freestyle"
            />
          </label>
          <label className="space-y-1.5 text-sm md:col-span-2">
            <span className="text-xs text-muted-foreground">延后按钮（分钟，英文逗号分隔）</span>
            <Input
              value={breakDraft.snoozeMinutes}
              onChange={(event) => onBreakTextChange('snoozeMinutes', event.target.value)}
              placeholder="1, 3, 5"
            />
          </label>
        </div>
      </details>

      <div className="mt-3 rounded-lg border border-dashed border-border/70 bg-background/55 px-3 py-3 text-xs text-muted-foreground">
        当前预览：休息按钮 {parsedBreakConfig.presetMinutes.join(' / ')} 分钟；
        {parsedBreakConfig.promptOnWindowLeave
          ? `离开窗口 ${parsedBreakConfig.promptDelaySeconds} 秒后询问；`
          : '离开窗口不会自动询问；'}
        休息结束后{parsedBreakConfig.resumeInterruptedStudyOnReturn ? '会' : '不会'}自动恢复学习。
      </div>
    </div>
  )
}
