import { cn } from '@/shared/lib/utils'
import type {
  TimerCelebrationVisualPreset,
  TimerFeedbackIntensity,
  TimerFocusConfig,
  TimerFocusScene,
} from '@/shared/components/session/timer-focus-config'
import {
  DEFAULT_TIMER_FOCUS_CONFIG,
  getTimerFocusRule,
} from '@/shared/components/session/timer-focus-config'
import type {
  CelebrationBooleanFieldKey,
  CelebrationEventKey,
  FocusDraft,
  FocusFieldKey,
} from '@/shared/components/session/timerAutomationDialogModel'
import { CelebrationEventEditor } from '@/shared/components/session/TimerCelebrationEventEditor'
import { FocusRuleEditor } from '@/shared/components/session/TimerFocusRuleEditor'

export function TimerFocusSection({
  focusDraft,
  parsedFocusConfig,
  onFocusFieldChange,
  onFeedbackIntensityChange,
  onCelebrationBooleanChange,
  onCelebrationVolumeChange,
  onCelebrationPresetChange,
}: {
  focusDraft: FocusDraft
  parsedFocusConfig: TimerFocusConfig
  onFocusModeChange: (mode: FocusDraft['mode']) => void
  onFocusFieldChange: (scene: 'global' | TimerFocusScene, field: FocusFieldKey, value: string) => void
  onFeedbackIntensityChange: (value: TimerFeedbackIntensity) => void
  onCelebrationBooleanChange: (
    eventKey: CelebrationEventKey,
    field: CelebrationBooleanFieldKey,
    checked: boolean,
  ) => void
  onCelebrationVolumeChange: (eventKey: CelebrationEventKey, value: string) => void
  onCelebrationPresetChange: (eventKey: CelebrationEventKey, value: TimerCelebrationVisualPreset) => void
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">专注目标配置</div>
          <p className="mt-1 text-xs text-muted-foreground">
            主数字显示累计有效学习时长，下方展示当前 25 分钟轮次进度；阶段提醒不会抢占主视觉。
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {([
          ['balanced', '低打扰（推荐）', '阶段节点只播放短提示音，整轮完成时才显示简短动画。'],
          ['celebration', '明显激励', '保留更强的完成反馈，但控制持续时间和打断感。'],
          ['cinematic', '冲顶庆典', '使用完整烟花、闪屏和增强音效，适合偶尔使用。'],
        ] as const).map(([value, title, description]) => (
          <button
            key={value}
            type="button"
            onClick={() => onFeedbackIntensityChange(value)}
            className={cn(
              'rounded-lg border px-4 py-4 text-left transition-all',
              focusDraft.feedbackIntensity === value
                ? 'border-primary bg-primary/8 shadow-sm ring-1 ring-primary/30'
                : 'border-border/70 bg-background/70 hover:bg-secondary/70',
            )}
          >
            <div className="text-sm font-semibold">{title}</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
          </button>
        ))}
      </div>

      <div className="mt-4">
        <FocusRuleEditor
            label="全局专注目标"
            value={focusDraft.global}
            defaults={DEFAULT_TIMER_FOCUS_CONFIG.global}
            onFieldChange={(field, value) => onFocusFieldChange('global', field, value)}
        />
      </div>

      <details className="mt-4 rounded-lg border border-border/70 bg-background/45 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          高级设置：分别调整阶段与整轮反馈
        </summary>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <CelebrationEventEditor
            title="阶段提醒反馈"
            description="每个阶段节点触发；默认只有短提示音，不播放动画。"
            value={focusDraft.celebration.secondaryInterval}
            onBooleanChange={(field, checked) =>
              onCelebrationBooleanChange('secondaryInterval', field, checked)
            }
            onVolumeChange={(value) => onCelebrationVolumeChange('secondaryInterval', value)}
            onPresetChange={(value) => onCelebrationPresetChange('secondaryInterval', value)}
          />
          <CelebrationEventEditor
            title="整轮完成反馈"
            description="完成一轮专注时触发；默认由计时面板显示完成态并播放短音效。"
            value={focusDraft.celebration.primaryGoal}
            onBooleanChange={(field, checked) =>
              onCelebrationBooleanChange('primaryGoal', field, checked)
            }
            onVolumeChange={(value) => onCelebrationVolumeChange('primaryGoal', value)}
            onPresetChange={(value) => onCelebrationPresetChange('primaryGoal', value)}
          />
        </div>
      </details>

      <div className="mt-3 rounded-lg border border-dashed border-border/70 bg-background/55 px-3 py-3 text-xs text-muted-foreground">
        当前预览：主数字持续正计时；每轮 {getTimerFocusRule('practice', parsedFocusConfig).primaryMinutes} 分钟，
        每 {getTimerFocusRule('practice', parsedFocusConfig).secondaryMinutes} 分钟轻提醒一次，完成后建议休息{' '}
        {getTimerFocusRule('practice', parsedFocusConfig).breakMinutes ?? 5} 分钟。
      </div>
    </div>
  )
}
