import { Badge } from '@/shared/components/ui/badge'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'
import { cn } from '@/shared/lib/utils'
import type {
  TimerCelebrationEventConfig,
  TimerCelebrationVisualPreset,
  TimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'
import { SectionTitle } from '@/features/profile/components/ProfileFeedbackSettingsPanel'

type TimerSettingsUpdater = (
  nextConfig: TimerFocusConfig | ((current: TimerFocusConfig) => TimerFocusConfig),
) => void

interface ProfileTimerFeedbackSettingsPanelProps {
  config: TimerFocusConfig
  updateConfig: TimerSettingsUpdater
}

function Segment<T extends string>({
  value,
  onChange,
  options,
}: {
  label?: string
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; title: string }>
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-3">
      {options.map((option) => {
        const active = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-lg border px-3 py-3 text-center text-sm font-medium transition-all',
              active
                ? 'border-primary bg-primary/8 shadow-sm ring-1 ring-primary/30'
                : 'border-border/70 bg-background/70 hover:bg-secondary/70',
            )}
          >
            {option.title}
          </button>
        )
      })}
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-background/70 px-4 py-3">
      <div className="text-sm font-medium">{label}</div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function EventCard({
  title,
  eventConfig,
  onChange,
}: {
  title: string
  description?: string
  eventConfig: TimerCelebrationEventConfig
  onChange: (updater: (current: TimerCelebrationEventConfig) => TimerCelebrationEventConfig) => void
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <SectionTitle title={title} />
        <Badge variant={eventConfig.enabled ? 'secondary' : 'outline'}>
          {eventConfig.enabled ? '已启用' : '已关闭'}
        </Badge>
      </div>

      <div className="space-y-4">
        <ToggleRow
          label="启用反馈"
          checked={eventConfig.enabled}
          onCheckedChange={(enabled) => onChange((current) => ({ ...current, enabled }))}
        />

        <div className="grid gap-3 lg:grid-cols-2">
          <ToggleRow
            label="音效"
            checked={eventConfig.soundEnabled}
            onCheckedChange={(soundEnabled) =>
              onChange((current) => ({ ...current, soundEnabled }))
            }
          />
          <ToggleRow
            label="动画"
            checked={eventConfig.animationEnabled}
            onCheckedChange={(animationEnabled) =>
              onChange((current) => ({ ...current, animationEnabled }))
            }
          />
        </div>

        <Segment<TimerCelebrationVisualPreset>
          value={eventConfig.visualPreset}
          onChange={(visualPreset) => onChange((current) => ({ ...current, visualPreset }))}
          options={[
            { value: 'auto', title: '自动' },
            { value: 'realistic_look', title: '写实' },
            { value: 'fireworks', title: '烟花' },
            { value: 'stars', title: '星爆' },
            { value: 'school_pride', title: '庆典' },
            { value: 'random_direction', title: '轻喷发' },
          ]}
        />

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <Label className="text-sm font-medium">音量增强</Label>
            <span className="text-xs text-muted-foreground">
              x{eventConfig.volumeBoost.toFixed(2).replace(/\.00$/, '')}
            </span>
          </div>
          <Input
            type="range"
            min="0"
            max="3"
            step="0.05"
            value={eventConfig.volumeBoost}
            onChange={(event) =>
              onChange((current) => ({
                ...current,
                volumeBoost: Number(event.target.value),
              }))
            }
          />
        </div>
      </div>
    </div>
  )
}

export function ProfileTimerFeedbackSettingsPanel({
  config,
  updateConfig,
}: ProfileTimerFeedbackSettingsPanelProps) {
  return (
    <div className="space-y-5">
      <SectionTitle title="计时器反馈基调" />
      <Segment
        value={config.feedbackIntensity}
        onChange={(feedbackIntensity) =>
          updateConfig((current) => ({ ...current, feedbackIntensity }))
        }
        options={[
          { value: 'cinematic', title: '冲顶庆典' },
          { value: 'celebration', title: '强而可控' },
          { value: 'balanced', title: '稳态激励' },
        ]}
      />

      <SectionTitle title="二级子间隔到点" />
      <EventCard
        title="二级子间隔反馈"
        eventConfig={config.celebration.secondaryInterval}
        onChange={(updater) =>
          updateConfig((current) => ({
            ...current,
            celebration: {
              ...current.celebration,
              secondaryInterval: updater(current.celebration.secondaryInterval),
            },
          }))
        }
      />

      <SectionTitle title="一级总目标完成" />
      <EventCard
        title="一级总目标反馈"
        eventConfig={config.celebration.primaryGoal}
        onChange={(updater) =>
          updateConfig((current) => ({
            ...current,
            celebration: {
              ...current.celebration,
              primaryGoal: updater(current.celebration.primaryGoal),
            },
          }))
        }
      />
    </div>
  )
}
