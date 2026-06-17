import { Badge } from '@/shared/components/ui/badge'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'
import { cn } from '@/shared/lib/utils'
import type { ReviewFeedbackSettings } from '@/shared/feedback/reviewFeedbackSettings'

type FeedbackSettingsUpdater = (
  nextSettings:
    | ReviewFeedbackSettings
    | ((current: ReviewFeedbackSettings) => ReviewFeedbackSettings),
) => void

interface ProfileFeedbackSettingsPanelProps {
  settings: ReviewFeedbackSettings
  milestoneStepsInput: string
  setMilestoneStepsInput: (value: string) => void
  updateSettings: FeedbackSettingsUpdater
}

function SettingSegment<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: Array<{
    value: T
    title: string
    description: string
  }>
  onChange: (value: T) => void
}) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">{label}</div>
      <div className="grid gap-3 md:grid-cols-3">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={cn(
                'rounded-2xl border px-4 py-4 text-left transition-all',
                active
                  ? 'border-primary bg-primary/8 shadow-sm ring-1 ring-primary/30'
                  : 'border-border/70 bg-background/70 hover:bg-secondary/70',
              )}
            >
              <div className="text-sm font-semibold">{option.title}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {option.description}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SettingSwitch({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-1 text-sm text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

function parseMilestoneStepsInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，\s]+/)
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isInteger(item) && item > 0)
        .map((item) => Math.round(item)),
    ),
  ).sort((a, b) => a - b)
}

function EventToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-border/70 bg-background/70 px-4 py-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-1 text-sm text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

export function SectionTitle({
  title,
  description,
}: {
  title: string
  description?: string
}) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-semibold">{title}</div>
      {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
    </div>
  )
}

function EventCelebrationCard({
  title,
  description,
  eventSettings,
  showCooldown = true,
  onEnabledChange,
  onCooldownChange,
  onConfettiAmountChange,
  onSoundEnabledChange,
  onAnimationEnabledChange,
}: {
  title: string
  description: string
  eventSettings: {
    enabled: boolean
    confettiAmount: number
    soundEnabled: boolean
    animationEnabled: boolean
    cooldownMs?: number
  }
  showCooldown?: boolean
  onEnabledChange: (checked: boolean) => void
  onCooldownChange?: (cooldownMs: number) => void
  onConfettiAmountChange: (confettiAmount: number) => void
  onSoundEnabledChange: (checked: boolean) => void
  onAnimationEnabledChange: (checked: boolean) => void
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <SectionTitle title={title} description={description} />
        <Badge variant={eventSettings.enabled ? 'secondary' : 'outline'}>
          {eventSettings.enabled ? '已启用' : '已关闭'}
        </Badge>
      </div>

      <div className="space-y-4">
        <EventToggleRow
          label="启用庆祝"
          description="关闭后，这个场景不再触发独立烟花反馈。"
          checked={eventSettings.enabled}
          onCheckedChange={onEnabledChange}
        />

        <div className={cn('grid gap-4', showCooldown ? 'lg:grid-cols-2' : 'lg:grid-cols-1')}>
          {showCooldown ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <Label className="text-sm font-medium">冷却</Label>
                <span className="text-sm text-muted-foreground">
                  {Math.round((eventSettings.cooldownMs ?? 0) / 1000)} 秒
                </span>
              </div>
              <Input
                type="range"
                min="0"
                max="30000"
                step="500"
                value={eventSettings.cooldownMs ?? 0}
                onChange={(event) => onCooldownChange?.(Number(event.target.value))}
              />
            </div>
          ) : null}

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <Label className="text-sm font-medium">烟花量</Label>
              <span className="text-sm text-muted-foreground">
                {Math.round(eventSettings.confettiAmount * 100)}%
              </span>
            </div>
            <Input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={eventSettings.confettiAmount}
              onChange={(event) => onConfettiAmountChange(Number(event.target.value))}
            />
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <EventToggleRow
            label="音效"
            description="允许这个场景触发庆祝音效。"
            checked={eventSettings.soundEnabled}
            onCheckedChange={onSoundEnabledChange}
          />
          <EventToggleRow
            label="动画"
            description="允许这个场景触发独立演出。"
            checked={eventSettings.animationEnabled}
            onCheckedChange={onAnimationEnabledChange}
          />
        </div>
      </div>
    </div>
  )
}

export function ProfileFeedbackSettingsPanel({
  settings,
  milestoneStepsInput,
  setMilestoneStepsInput,
  updateSettings,
}: ProfileFeedbackSettingsPanelProps) {
  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <SectionTitle
          title="基础体验"
          description="控制整套翻卡反馈的基础强度，适合先从这里定调。"
        />
        <SettingSegment
          label="反馈模式"
          value={settings.mode}
          onChange={(mode) => updateSettings((current) => ({ ...current, mode }))}
          options={[
            { value: 'immersive', title: '沉浸', description: '完整保留演出。' },
            { value: 'quiet', title: '安静', description: '明显降低刺激。' },
          ]}
        />
        <SettingSegment
          label="普通翻卡"
          value={settings.revealFxIntensity}
          onChange={(revealFxIntensity) =>
            updateSettings((current) => ({ ...current, revealFxIntensity }))
          }
          options={[
            { value: 'soft', title: '轻反馈', description: '适合高频连续翻卡。' },
            { value: 'full', title: '强反馈', description: '揭示感更明显。' },
          ]}
        />
        <SettingSegment
          label="关键演出"
          value={settings.criticalFxIntensity}
          onChange={(criticalFxIntensity) =>
            updateSettings((current) => ({ ...current, criticalFxIntensity }))
          }
          options={[
            { value: 'full', title: '标准', description: '明显但不抢节奏。' },
            { value: 'cinematic', title: '电影感', description: '层级和冲击感更强。' },
          ]}
        />
        <SettingSegment
          label="全局界面反馈"
          value={settings.globalIntensity}
          onChange={(globalIntensity) =>
            updateSettings((current) => ({ ...current, globalIntensity }))
          }
          options={[
            { value: 'quiet', title: '安静', description: '界面微反馈很少。' },
            { value: 'balanced', title: '平衡', description: '默认推荐。' },
            { value: 'immersive', title: '沉浸', description: '通用操作也更积极。' },
          ]}
        />
        <div className="grid gap-3 lg:grid-cols-2">
          <SettingSwitch
            label="总声音"
            description="所有翻卡相关音效总开关。"
            checked={settings.soundEnabled}
            onCheckedChange={(soundEnabled) =>
              updateSettings((current) => ({ ...current, soundEnabled }))
            }
          />
          <SettingSwitch
            label="总动画"
            description="所有翻卡相关动效总开关。"
            checked={settings.animationEnabled}
            onCheckedChange={(animationEnabled) =>
              updateSettings((current) => ({ ...current, animationEnabled }))
            }
          />
        </div>
        <div className="grid gap-4 rounded-2xl border border-border/70 bg-background/70 px-4 py-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <Label htmlFor="profile-feedback-volume" className="text-sm font-medium">
                总音量
              </Label>
              <span className="text-sm text-muted-foreground">
                {Math.round(settings.volume * 100)}%
              </span>
            </div>
            <Input
              id="profile-feedback-volume"
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={settings.volume}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  volume: Number(event.target.value),
                }))
              }
            />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <Label htmlFor="profile-feedback-confetti" className="text-sm font-medium">
                默认烟花量
              </Label>
              <span className="text-sm text-muted-foreground">
                {Math.round(settings.confettiAmount * 100)}%
              </span>
            </div>
            <Input
              id="profile-feedback-confetti"
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={settings.confettiAmount}
              onChange={(event) =>
                updateSettings((current) => ({
                  ...current,
                  confettiAmount: Number(event.target.value),
                }))
              }
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <SectionTitle
          title="里程碑"
          description="单独控制推进链节点、里程碑冷却和专属演出。"
        />
        <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
          <div className="space-y-4">
            <EventToggleRow
              label="里程碑庆祝"
              description="控制里程碑弹层、烟花和专属音效。"
              checked={settings.celebration.milestone.enabled}
              onCheckedChange={(enabled) =>
                updateSettings((current) => ({
                  ...current,
                  celebration: {
                    ...current.celebration,
                    milestone: { ...current.celebration.milestone, enabled },
                  },
                }))
              }
            />
            <div>
              <Label htmlFor="profile-feedback-milestone-steps" className="text-sm font-medium">
                触发节点
              </Label>
              <Input
                id="profile-feedback-milestone-steps"
                className="mt-2"
                value={milestoneStepsInput}
                onChange={(event) => setMilestoneStepsInput(event.target.value)}
                onBlur={() => {
                  const steps = parseMilestoneStepsInput(milestoneStepsInput)
                  if (steps.length === 0) {
                    setMilestoneStepsInput(settings.celebration.milestone.steps.join(', '))
                    return
                  }
                  updateSettings((current) => ({
                    ...current,
                    celebration: {
                      ...current.celebration,
                      milestone: { ...current.celebration.milestone, steps },
                    },
                  }))
                }}
                placeholder="4, 8, 12, 20"
              />
              <div className="mt-2 text-sm text-muted-foreground">
                当前：{settings.celebration.milestone.steps.join('、')}
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <Label htmlFor="profile-feedback-milestone-cooldown" className="text-sm font-medium">
                    里程碑冷却
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    {Math.round(settings.celebration.milestone.cooldownMs / 1000)} 秒
                  </span>
                </div>
                <Input
                  id="profile-feedback-milestone-cooldown"
                  type="range"
                  min="0"
                  max="30000"
                  step="500"
                  value={settings.celebration.milestone.cooldownMs}
                  onChange={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      celebration: {
                        ...current.celebration,
                        milestone: {
                          ...current.celebration.milestone,
                          cooldownMs: Number(event.target.value),
                        },
                      },
                    }))
                  }
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <Label htmlFor="profile-feedback-milestone-confetti" className="text-sm font-medium">
                    里程碑烟花量
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    {Math.round(settings.celebration.milestone.confettiAmount * 100)}%
                  </span>
                </div>
                <Input
                  id="profile-feedback-milestone-confetti"
                  type="range"
                  min="0.5"
                  max="3"
                  step="0.1"
                  value={settings.celebration.milestone.confettiAmount}
                  onChange={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      celebration: {
                        ...current.celebration,
                        milestone: {
                          ...current.celebration.milestone,
                          confettiAmount: Number(event.target.value),
                        },
                      },
                    }))
                  }
                />
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <EventToggleRow
                label="里程碑音效"
                description="是否播放升级音。"
                checked={settings.celebration.milestone.soundEnabled}
                onCheckedChange={(soundEnabled) =>
                  updateSettings((current) => ({
                    ...current,
                    celebration: {
                      ...current.celebration,
                      milestone: { ...current.celebration.milestone, soundEnabled },
                    },
                  }))
                }
              />
              <EventToggleRow
                label="里程碑动画"
                description="是否显示弹层与烟花。"
                checked={settings.celebration.milestone.animationEnabled}
                onCheckedChange={(animationEnabled) =>
                  updateSettings((current) => ({
                    ...current,
                    celebration: {
                      ...current.celebration,
                      milestone: { ...current.celebration.milestone, animationEnabled },
                    },
                  }))
                }
              />
            </div>
            <SettingSwitch
              label="里程碑文案"
              description="到达里程碑时显示奖励文案。"
              checked={settings.surpriseEnabled}
              onCheckedChange={(surpriseEnabled) =>
                updateSettings((current) => ({ ...current, surpriseEnabled }))
              }
            />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <SectionTitle
          title="其他庆祝事件"
          description="按场景分别控制攻区、全图点亮和完成结算。"
        />
        <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <Label htmlFor="profile-feedback-global-cooldown" className="text-sm font-medium">
              全局庆祝冷却
            </Label>
            <span className="text-sm text-muted-foreground">
              {Math.round(settings.celebration.globalCooldownMs / 1000)} 秒
            </span>
          </div>
          <Input
            id="profile-feedback-global-cooldown"
            type="range"
            min="0"
            max="20000"
            step="500"
            value={settings.celebration.globalCooldownMs}
            onChange={(event) =>
              updateSettings((current) => ({
                ...current,
                celebration: {
                  ...current.celebration,
                  globalCooldownMs: Number(event.target.value),
                },
              }))
            }
          />
        </div>

        <EventCelebrationCard
          title="区域攻克"
          description="某个分支第一次全部亮起时。"
          eventSettings={settings.celebration.branchClear}
          onEnabledChange={(enabled) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                branchClear: { ...current.celebration.branchClear, enabled },
              },
            }))
          }
          onCooldownChange={(cooldownMs) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                branchClear: { ...current.celebration.branchClear, cooldownMs },
              },
            }))
          }
          onConfettiAmountChange={(confettiAmount) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                branchClear: { ...current.celebration.branchClear, confettiAmount },
              },
            }))
          }
          onSoundEnabledChange={(soundEnabled) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                branchClear: { ...current.celebration.branchClear, soundEnabled },
              },
            }))
          }
          onAnimationEnabledChange={(animationEnabled) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                branchClear: { ...current.celebration.branchClear, animationEnabled },
              },
            }))
          }
        />

        <EventCelebrationCard
          title="全图点亮"
          description="所有非根节点全部揭示后。"
          eventSettings={settings.celebration.allClearReady}
          onEnabledChange={(enabled) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                allClearReady: { ...current.celebration.allClearReady, enabled },
              },
            }))
          }
          onCooldownChange={(cooldownMs) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                allClearReady: { ...current.celebration.allClearReady, cooldownMs },
              },
            }))
          }
          onConfettiAmountChange={(confettiAmount) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                allClearReady: { ...current.celebration.allClearReady, confettiAmount },
              },
            }))
          }
          onSoundEnabledChange={(soundEnabled) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                allClearReady: { ...current.celebration.allClearReady, soundEnabled },
              },
            }))
          }
          onAnimationEnabledChange={(animationEnabled) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                allClearReady: { ...current.celebration.allClearReady, animationEnabled },
              },
            }))
          }
        />

        <EventCelebrationCard
          title="完成结算"
          description="点击完成后的最终结算演出。"
          eventSettings={settings.celebration.sessionComplete}
          showCooldown={false}
          onEnabledChange={(enabled) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                sessionComplete: { ...current.celebration.sessionComplete, enabled },
              },
            }))
          }
          onConfettiAmountChange={(confettiAmount) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                sessionComplete: { ...current.celebration.sessionComplete, confettiAmount },
              },
            }))
          }
          onSoundEnabledChange={(soundEnabled) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                sessionComplete: { ...current.celebration.sessionComplete, soundEnabled },
              },
            }))
          }
          onAnimationEnabledChange={(animationEnabled) =>
            updateSettings((current) => ({
              ...current,
              celebration: {
                ...current.celebration,
                sessionComplete: { ...current.celebration.sessionComplete, animationEnabled },
              },
            }))
          }
        />
      </div>
    </div>
  )
}
