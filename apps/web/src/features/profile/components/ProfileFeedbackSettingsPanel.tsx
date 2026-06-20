import * as React from 'react'
import { Badge } from '@/shared/components/ui/badge'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'
import { cn } from '@/shared/lib/utils'
import { launchCelebrationPreset } from '@/shared/components/celebration'
import {
  FEEDBACK_CONFETTI_PRESET_LABELS,
  FEEDBACK_CONFETTI_PRESETS,
  REVIEW_FEEDBACK_VOLUME_MAX,
  getReviewFeedbackEffectiveVolume,
  type CelebrationPreset,
  type FeedbackSceneKey,
  type ReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'

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
  /** 音量拖动实时试听 */
  onVolumePreview?: (scene: FeedbackSceneKey) => void
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

/**
 * 仅保留主标题的 SectionTitle（B1：降低信息密度）。
 */
export function SectionTitle({
  title,
}: {
  title: string
  description?: string
}) {
  return (
    <div className="text-sm font-semibold">{title}</div>
  )
}

/**
 * 烟花效果 5 选 1 选项网格。
 * 点击任一类型：立即选中 + 全屏播放该类型预览（无需跳到右侧预览台）。
 */
function ConfettiSegment({
  value,
  onChange,
  reducedMotion,
}: {
  value?: CelebrationPreset
  onChange: (value: CelebrationPreset) => void
  reducedMotion: boolean
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2">
      {FEEDBACK_CONFETTI_PRESETS.map((preset) => {
        const active = value === preset
        return (
          <button
            key={preset}
            type="button"
            onClick={() => {
              onChange(preset)
              // 点击即预览：在当前页面全屏 canvas 喷发该类型烟花
              launchCelebrationPreset({ preset, reducedMotion })
            }}
            aria-pressed={active}
            className={cn(
              'rounded-xl border px-3 py-2 text-center text-xs font-medium transition-all',
              active
                ? 'border-primary bg-primary/10 shadow-sm ring-1 ring-primary/25'
                : 'border-border/70 bg-background/75 hover:bg-secondary/75',
            )}
          >
            {FEEDBACK_CONFETTI_PRESET_LABELS[preset]}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 场景音量滑块 + 百分比显示（B5）。
 */
function SceneVolumeSlider({
  volumeBoost,
  onChange,
  onPreview,
  label,
}: {
  volumeBoost: number
  onChange: (value: number) => void
  onPreview?: () => void
  label: string
}) {
  const [localValue, setLocalValue] = React.useState(String(volumeBoost))
  const throttledPreviewRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = React.useCallback(
    (nextRaw: string) => {
      setLocalValue(nextRaw)
      const next = Number(nextRaw)
      if (!Number.isFinite(next)) return
      onChange(next)
      if (onPreview) {
        if (throttledPreviewRef.current != null) {
          clearTimeout(throttledPreviewRef.current)
        }
        throttledPreviewRef.current = setTimeout(() => {
          throttledPreviewRef.current = null
          onPreview()
        }, 120)
      }
    },
    [onChange, onPreview],
  )

  React.useEffect(() => {
    return () => {
      if (throttledPreviewRef.current != null) {
        clearTimeout(throttledPreviewRef.current)
      }
    }
  }, [])

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <Label className="text-xs font-medium">{label}</Label>
        <span className="text-xs text-muted-foreground">
          {Math.round(volumeBoost * 100)}%
        </span>
      </div>
      <Input
        type="range"
        min="0"
        max="3"
        step="0.05"
        value={localValue}
        onInput={(event) => handleChange((event.target as HTMLInputElement).value)}
        onChange={(event) => handleChange((event.target as HTMLInputElement).value)}
      />
    </div>
  )
}

/**
 * 场景卡片：开关 + 烟花类型(点击即预览) + 场景音量增益。
 * 视觉强度由烟花类型本身内置，不再有"形容词"强度档位。
 */
function SceneCard({
  title,
  sceneKey,
  enabled,
  confettiPreset,
  volumeBoost,
  reducedMotion,
  onEnabledChange,
  onConfettiPresetChange,
  onVolumeBoostChange,
  onVolumePreview,
}: {
  title: string
  sceneKey: FeedbackSceneKey
  enabled: boolean
  confettiPreset?: CelebrationPreset
  volumeBoost: number
  reducedMotion: boolean
  onEnabledChange: (checked: boolean) => void
  onConfettiPresetChange: (value: CelebrationPreset) => void
  onVolumeBoostChange: (value: number) => void
  onVolumePreview?: (scene: FeedbackSceneKey) => void
}) {
  return (
    <div className="memory-anki-soft-card rounded-[20px] px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">{title}</div>
        <div className="flex items-center gap-2">
          <Badge variant={enabled ? 'secondary' : 'outline'}>
            {confettiPreset ? FEEDBACK_CONFETTI_PRESET_LABELS[confettiPreset] : '默认'}
          </Badge>
          <Switch
            checked={enabled}
            onCheckedChange={onEnabledChange}
          />
        </div>
      </div>
      <div className="space-y-4">
        <div>
          <div className="mb-2 text-xs font-medium text-muted-foreground">烟花类型 · 点击预览</div>
          <ConfettiSegment
            value={confettiPreset}
            reducedMotion={reducedMotion}
            onChange={onConfettiPresetChange}
          />
        </div>
        <SceneVolumeSlider
          volumeBoost={volumeBoost}
          onChange={onVolumeBoostChange}
          onPreview={onVolumePreview ? () => onVolumePreview(sceneKey) : undefined}
          label="音量增益"
        />
      </div>
    </div>
  )
}

export function ProfileFeedbackSettingsPanel({
  settings,
  milestoneStepsInput,
  setMilestoneStepsInput,
  updateSettings,
  onVolumePreview,
}: ProfileFeedbackSettingsPanelProps) {
  const [showAdvanced, setShowAdvanced] = React.useState(false)
  const effectiveVolume = getReviewFeedbackEffectiveVolume(settings)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-base font-semibold">反馈总控</div>
        <div className="flex flex-wrap gap-2">
          <Badge variant={settings.soundEnabled ? 'secondary' : 'outline'}>
            {settings.soundEnabled ? '声音开启' : '声音关闭'}
          </Badge>
          <Badge variant={settings.animationEnabled ? 'secondary' : 'outline'}>
            {settings.animationEnabled ? '动画开启' : '动画关闭'}
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SceneCard
          title="普通复习 / 翻卡"
          sceneKey="review"
          enabled={settings.scenes.review.enabled}
          confettiPreset={settings.scenes.review.confettiPreset}
          volumeBoost={settings.scenes.review.volumeBoost ?? 1}
          reducedMotion={settings.reducedCelebrationMotion}
          onEnabledChange={(enabled) => updateSettings((current) => ({
            ...current,
            scenes: { ...current.scenes, review: { ...current.scenes.review, enabled } },
          }))}
          onConfettiPresetChange={(confettiPreset) => updateSettings((current) => ({
            ...current,
            scenes: { ...current.scenes, review: { ...current.scenes.review, confettiPreset } },
          }))}
          onVolumeBoostChange={(volumeBoost) => updateSettings((current) => ({
            ...current,
            scenes: { ...current.scenes, review: { ...current.scenes.review, volumeBoost } },
          }))}
          onVolumePreview={onVolumePreview}
        />
        <SceneCard
          title="连击 / 里程碑"
          sceneKey="milestone"
          enabled={settings.scenes.milestone.enabled}
          confettiPreset={settings.scenes.milestone.confettiPreset}
          volumeBoost={settings.scenes.milestone.volumeBoost ?? 1.1}
          reducedMotion={settings.reducedCelebrationMotion}
          onEnabledChange={(enabled) => updateSettings((current) => ({
            ...current,
            scenes: { ...current.scenes, milestone: { ...current.scenes.milestone, enabled } },
          }))}
          onConfettiPresetChange={(confettiPreset) => updateSettings((current) => ({
            ...current,
            scenes: { ...current.scenes, milestone: { ...current.scenes.milestone, confettiPreset } },
          }))}
          onVolumeBoostChange={(volumeBoost) => updateSettings((current) => ({
            ...current,
            scenes: { ...current.scenes, milestone: { ...current.scenes.milestone, volumeBoost } },
          }))}
          onVolumePreview={onVolumePreview}
        />
        <SceneCard
          title="完成结算"
          sceneKey="completion"
          enabled={settings.scenes.completion.enabled}
          confettiPreset={settings.scenes.completion.confettiPreset}
          volumeBoost={settings.scenes.completion.volumeBoost ?? 1.25}
          reducedMotion={settings.reducedCelebrationMotion}
          onEnabledChange={(enabled) => updateSettings((current) => ({
            ...current,
            scenes: { ...current.scenes, completion: { ...current.scenes.completion, enabled } },
          }))}
          onConfettiPresetChange={(confettiPreset) => updateSettings((current) => ({
            ...current,
            scenes: { ...current.scenes, completion: { ...current.scenes.completion, confettiPreset } },
          }))}
          onVolumeBoostChange={(volumeBoost) => updateSettings((current) => ({
            ...current,
            scenes: { ...current.scenes, completion: { ...current.scenes.completion, volumeBoost } },
          }))}
          onVolumePreview={onVolumePreview}
        />
        <SceneCard
          title="计时器达标"
          sceneKey="timer"
          enabled={settings.scenes.timer.enabled}
          confettiPreset={settings.scenes.timer.confettiPreset}
          volumeBoost={settings.scenes.timer.volumeBoost ?? 1.35}
          reducedMotion={settings.reducedCelebrationMotion}
          onEnabledChange={(enabled) => updateSettings((current) => ({
            ...current,
            scenes: { ...current.scenes, timer: { ...current.scenes.timer, enabled } },
          }))}
          onConfettiPresetChange={(confettiPreset) => updateSettings((current) => ({
            ...current,
            scenes: { ...current.scenes, timer: { ...current.scenes.timer, confettiPreset } },
          }))}
          onVolumeBoostChange={(volumeBoost) => updateSettings((current) => ({
            ...current,
            scenes: { ...current.scenes, timer: { ...current.scenes.timer, volumeBoost } },
          }))}
          onVolumePreview={onVolumePreview}
        />
      </div>

      <div className="memory-anki-soft-card rounded-[20px] px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionTitle title="基础音量" />
          <Badge variant="secondary">{Math.round(effectiveVolume * 100)}%</Badge>
        </div>
        <Input
          type="range"
          min="0"
          max={String(REVIEW_FEEDBACK_VOLUME_MAX)}
          step="0.05"
          value={settings.volume}
          onChange={(event) => updateSettings((current) => ({ ...current, volume: Number(event.target.value) }))}
        />
      </div>

      <div className="flex items-center justify-between rounded-[20px] border border-dashed border-border/70 bg-background/60 px-4 py-3">
        <div className="text-sm font-medium">进阶设置</div>
        <button
          type="button"
          onClick={() => setShowAdvanced((current) => !current)}
          className="rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-sm"
        >
          {showAdvanced ? '收起' : '展开'}
        </button>
      </div>

      {showAdvanced ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-[20px] border border-border/70 bg-background/75 px-4 py-3">
            <div className="text-sm font-medium">减少庆祝动态</div>
            <Switch
              checked={settings.reducedCelebrationMotion}
              onCheckedChange={(reducedCelebrationMotion) => updateSettings((current) => ({ ...current, reducedCelebrationMotion }))}
            />
          </div>
          <div className="flex items-center justify-between rounded-[20px] border border-border/70 bg-background/75 px-4 py-3">
            <div className="text-sm font-medium">里程碑文案</div>
            <Switch
              checked={settings.surpriseEnabled}
              onCheckedChange={(surpriseEnabled) => updateSettings((current) => ({ ...current, surpriseEnabled }))}
            />
          </div>
          <div className="memory-anki-soft-card rounded-[20px] px-4 py-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <Label htmlFor="profile-feedback-milestones" className="text-sm font-medium">里程碑节点</Label>
              <Badge variant="outline">{settings.scenes.milestone.steps.join(' / ')}</Badge>
            </div>
            <Input
              id="profile-feedback-milestones"
              type="text"
              value={milestoneStepsInput}
              onChange={(event) => setMilestoneStepsInput(event.target.value)}
              onBlur={() => {
                const steps = parseMilestoneStepsInput(milestoneStepsInput)
                if (steps.length > 0) {
                  updateSettings((current) => ({
                    ...current,
                    scenes: {
                      ...current.scenes,
                      milestone: { ...current.scenes.milestone, steps },
                    },
                    celebration: {
                      ...current.celebration,
                      milestone: { ...current.celebration.milestone, steps },
                    },
                  }))
                }
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
