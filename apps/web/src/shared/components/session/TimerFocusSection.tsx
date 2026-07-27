import { Link } from 'react-router-dom'
import type { TimerFocusConfig } from '@/shared/components/session/timer-focus-config'
import type { BreakGuardConfig } from '@/shared/components/session/break-guard-config'
import type {
  FocusDraft,
  FocusFieldKey,
} from '@/shared/components/session/timerAutomationDialogModel'
import { FocusRuleEditor } from '@/shared/components/session/TimerFocusRuleEditor'

/**
 * How long a round of focus lasts. Deliberately only timing: what a completed
 * round sounds and looks like is a feedback concern and lives in the feedback
 * centre, where every other sound and animation setting already is.
 */
export function TimerFocusSection({
  focusDraft,
  parsedFocusConfig,
  parsedBreakConfig,
  onFocusFieldChange,
  variant = 'full',
}: {
  focusDraft: FocusDraft
  parsedFocusConfig: TimerFocusConfig
  parsedBreakConfig: BreakGuardConfig
  onFocusFieldChange: (field: FocusFieldKey, value: string) => void
  variant?: 'full' | 'compact'
}) {
  const suggestedBreakMinutes = parsedBreakConfig.presetMinutes[0] ?? 5

  return (
    <div className="rounded-lg border border-border/70 bg-card/70 p-4">
      <div className="mb-3">
        <div className="text-sm font-semibold text-foreground">专注轮次</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          主数字显示累计有效学习时长，下方展示当前轮次进度；阶段提醒不会抢占主视觉。
        </p>
      </div>

      <FocusRuleEditor value={focusDraft} onFieldChange={onFocusFieldChange} />

      <div className="mt-3 rounded-lg border border-dashed border-border/70 bg-background/55 px-3 py-3 text-xs text-muted-foreground">
        当前预览：主数字持续正计时；每轮 {parsedFocusConfig.primaryMinutes} 分钟，
        每 {parsedFocusConfig.secondaryMinutes} 分钟轻提醒一次，完成后建议休息{' '}
        {suggestedBreakMinutes} 分钟。
      </div>

      {variant === 'full' ? (
        <p className="mt-3 text-xs text-muted-foreground">
          到点用什么声音和动画庆祝，请在{' '}
          <Link to="/profile/feedback" className="text-primary underline-offset-4 hover:underline">
            反馈中心
          </Link>{' '}
          调整。
        </p>
      ) : null}
    </div>
  )
}
