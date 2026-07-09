import { Input } from '@/shared/components/ui/input'
import type {
  TimerCelebrationEventConfig,
  TimerCelebrationVisualPreset,
} from '@/shared/components/session/timer-focus-config'
import type { CelebrationBooleanFieldKey } from '@/shared/components/session/timerAutomationDialogModel'
import { TIMER_VISUAL_PRESET_LABELS } from '@/shared/components/session/timerAutomationDialogModel'

export function CelebrationEventEditor({
  title,
  description,
  value,
  onBooleanChange,
  onVolumeChange,
  onPresetChange,
}: {
  title: string
  description: string
  value: Omit<TimerCelebrationEventConfig, 'volumeBoost'> & { volumeBoost: string }
  onBooleanChange: (field: CelebrationBooleanFieldKey, checked: boolean) => void
  onVolumeChange: (value: string) => void
  onPresetChange: (value: TimerCelebrationVisualPreset) => void
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/65 p-4">
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {([
          ['enabled', '启用反馈'],
          ['soundEnabled', '播放声音'],
          ['animationEnabled', '播放动画'],
        ] as const).map(([field, label]) => (
          <label key={field} className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={value[field]}
              onChange={(event) => onBooleanChange(field, event.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">音量倍率（0-3）</span>
          <Input
            inputMode="decimal"
            value={value.volumeBoost}
            onChange={(event) => onVolumeChange(event.target.value)}
          />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">视觉预设</span>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={value.visualPreset}
            onChange={(event) => onPresetChange(event.target.value as TimerCelebrationVisualPreset)}
          >
            {Object.entries(TIMER_VISUAL_PRESET_LABELS).map(([preset, label]) => (
              <option key={preset} value={preset}>{label}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
