import { Button } from '@/shared/components/ui/button'
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
  TIMER_FOCUS_SCENE_LABELS,
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
  onFocusModeChange,
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
  const focusScenes = Object.keys(TIMER_FOCUS_SCENE_LABELS) as TimerFocusScene[]
  const focusRuleEditors = focusScenes.map((scene) => (
    <FocusRuleEditor
      key={scene}
      label={TIMER_FOCUS_SCENE_LABELS[scene]}
      value={focusDraft[scene]}
      defaults={DEFAULT_TIMER_FOCUS_CONFIG[scene]}
      onFieldChange={(field, value) => onFocusFieldChange(scene, field, value)}
      compact
    />
  ))

  return (
    <div className="rounded-lg border border-border/70 bg-card/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">专注目标配置</div>
          <p className="mt-1 text-xs text-muted-foreground">
            大数字永远显示二级子间隔倒计时；一级总目标只用作下方进度和总冲刺反馈。
          </p>
        </div>
        <div className="inline-flex rounded-full border border-border/70 bg-background/80 p-1">
          <Button
            type="button"
            size="sm"
            variant={focusDraft.mode === 'global' ? 'default' : 'ghost'}
            className="rounded-full px-4"
            onClick={() => onFocusModeChange('global')}
          >
            全局目标
          </Button>
          <Button
            type="button"
            size="sm"
            variant={focusDraft.mode === 'scene' ? 'default' : 'ghost'}
            className="rounded-full px-4"
            onClick={() => onFocusModeChange('scene')}
          >
            单独目标
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {([
          ['cinematic', '冲顶庆典', '默认给最完整的烟花、闪屏和音效，并随累计次数继续增强。'],
          ['celebration', '强而可控', '保留强反馈，但整体喷发量和音量会略微收敛。'],
          ['balanced', '稳态激励', '保留明显奖励感，但更适合长期专注。'],
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
        {focusDraft.mode === 'global' ? (
          <FocusRuleEditor
            label="全局专注目标"
            value={focusDraft.global}
            defaults={DEFAULT_TIMER_FOCUS_CONFIG.global}
            onFieldChange={(field, value) => onFocusFieldChange('global', field, value)}
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {focusRuleEditors}
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <CelebrationEventEditor
          title="二级小目标反馈"
          description="每次二级倒计时完成时触发，适合短周期奖励。"
          value={focusDraft.celebration.secondaryInterval}
          onBooleanChange={(field, checked) =>
            onCelebrationBooleanChange('secondaryInterval', field, checked)
          }
          onVolumeChange={(value) => onCelebrationVolumeChange('secondaryInterval', value)}
          onPresetChange={(value) => onCelebrationPresetChange('secondaryInterval', value)}
        />
        <CelebrationEventEditor
          title="一级总目标反馈"
          description="整段一级目标完成时触发，适合更强的完成仪式。"
          value={focusDraft.celebration.primaryGoal}
          onBooleanChange={(field, checked) =>
            onCelebrationBooleanChange('primaryGoal', field, checked)
          }
          onVolumeChange={(value) => onCelebrationVolumeChange('primaryGoal', value)}
          onPresetChange={(value) => onCelebrationPresetChange('primaryGoal', value)}
        />
      </div>

      <div className="mt-3 rounded-lg border border-dashed border-border/70 bg-background/55 px-3 py-3 text-xs text-muted-foreground">
        当前全局默认：一级 {getTimerFocusRule('practice', parsedFocusConfig).primaryMinutes} 分钟左右的总冲刺，
        二级 {getTimerFocusRule('practice', parsedFocusConfig).secondaryMinutes} 分钟左右的小目标，更适合持续追小胜利。
      </div>
    </div>
  )
}
