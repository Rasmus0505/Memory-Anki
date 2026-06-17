import * as React from 'react'
import { Sparkles, Volume2, WandSparkles } from 'lucide-react'
import { ProfileLayout } from '@/features/profile/ProfileLayout'
import { usePrefersReducedMotion } from '@/features/review/hooks/useReviewFeedback'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { MindMapFrame } from '@/shared/components/mindmap-host'
import { useMindMapFeedbackAudio } from '@/shared/components/mindmap-host/useMindMapFeedback'
import type { MindMapReviewFxPayload } from '@/shared/components/mindmap-host/hostBridgeUtils'
import {
  ComboMilestoneBurst,
  CompletionCelebration,
  emitReviewConfetti,
} from '@/shared/components/celebration'
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT,
  readReviewFeedbackSettings,
  writeReviewFeedbackSettings,
  type ReviewFeedbackSettings,
} from '@/features/review/reviewFeedbackSettings'
import {
  getReviewComboMilestones,
  getReviewMilestoneLabel,
  getReviewSurpriseCopy,
} from '@/features/review/model/review-feedback'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'
import { cn } from '@/shared/lib/utils'

const PREVIEW_EDITOR_STATE: MindMapEditorState = {
  editor_doc: {
    root: {
      data: {
        text: '反馈预览地图',
        uid: 'root',
      },
      children: [
        {
          data: {
            text: '起点分支',
            uid: 'branch-a',
          },
          children: [
            {
              data: {
                text: '待回忆节点 A1',
                uid: 'card-a1',
              },
              children: [],
            },
            {
              data: {
                text: '待回忆节点 A2',
                uid: 'card-a2',
              },
              children: [],
            },
          ],
        },
        {
          data: {
            text: '终点分支',
            uid: 'branch-b',
          },
          children: [
            {
              data: {
                text: '待回忆节点 B1',
                uid: 'card-b1',
              },
              children: [],
            },
          ],
        },
      ],
    },
  },
  editor_config: {},
  editor_local_config: {},
  lang: 'zh',
}

function buildFxSignal(
  currentNonce: number,
  payload: Omit<MindMapReviewFxPayload, 'nonce'>,
): MindMapReviewFxPayload {
  return {
    ...payload,
    nonce: currentNonce + 1,
  }
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

function SectionTitle({
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

export default function ProfileFeedbackPage() {
  const [reviewFxSignal, setReviewFxSignal] = React.useState<MindMapReviewFxPayload | null>(null)
  const [comboPreview, setComboPreview] = React.useState<{
    comboCount: number
    copy: string
    label: string
    milestoneStep: number
  } | null>(null)
  const [completionPreview, setCompletionPreview] = React.useState<{
    completedNodes: number
    maxCombo: number
    nonce: number
    totalNodes: number
  } | null>(null)
  const [settings, setSettings] = React.useState<ReviewFeedbackSettings>(() =>
    readReviewFeedbackSettings(),
  )
  const [milestoneStepsInput, setMilestoneStepsInput] = React.useState(() =>
    readReviewFeedbackSettings().celebration.milestone.steps.join(', '),
  )
  const reducedMotion = usePrefersReducedMotion()
  const audio = useMindMapFeedbackAudio(
    settings.soundEnabled && settings.mode === 'immersive',
    settings.volume,
  )

  React.useEffect(() => {
    const sync = () => setSettings(readReviewFeedbackSettings())
    window.addEventListener(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, sync)
    return () => window.removeEventListener(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, sync)
  }, [])

  React.useEffect(() => {
    setMilestoneStepsInput(settings.celebration.milestone.steps.join(', '))
  }, [settings.celebration.milestone.steps])

  const updateSettings = React.useCallback(
    (
      nextSettings:
        | ReviewFeedbackSettings
        | ((current: ReviewFeedbackSettings) => ReviewFeedbackSettings),
    ) => {
      setSettings((current) => {
        const candidate =
          typeof nextSettings === 'function' ? nextSettings(current) : nextSettings
        return writeReviewFeedbackSettings(candidate)
      })
    },
    [],
  )

  const triggerFx = React.useCallback(
    (
      payload: Omit<MindMapReviewFxPayload, 'nonce'>,
      audioEvent?: Parameters<typeof audio.playEvent>[0],
      milestoneStep?: number | null,
      previewKind?: 'milestone' | 'branch_clear' | 'all_clear_ready' | 'session_complete',
    ) => {
      setReviewFxSignal((current) => buildFxSignal(current?.nonce ?? 0, payload))
      const milestoneSettings = settings.celebration.milestone
      const branchClearSettings = settings.celebration.branchClear
      const allClearSettings = settings.celebration.allClearReady
      const sessionCompleteSettings = settings.celebration.sessionComplete

      if (
        typeof milestoneStep === 'number' &&
        milestoneSettings.enabled &&
        milestoneSettings.soundEnabled &&
        settings.soundEnabled
      ) {
        audio.playComboMilestone(milestoneStep)
      } else if (
        audioEvent &&
        (
          previewKind == null ||
          previewKind === 'branch_clear' && branchClearSettings.soundEnabled ||
          previewKind === 'all_clear_ready' && allClearSettings.soundEnabled ||
          previewKind === 'session_complete' && sessionCompleteSettings.soundEnabled ||
          previewKind !== 'branch_clear' && previewKind !== 'all_clear_ready' && previewKind !== 'session_complete'
        )
      ) {
        audio.playEvent(audioEvent, { audioScope: 'global' })
      }

      if (!settings.animationEnabled || settings.mode !== 'immersive' || reducedMotion) {
        setComboPreview(null)
        setCompletionPreview(null)
        return
      }

      if (previewKind === 'milestone' && typeof milestoneStep === 'number') {
        if (!milestoneSettings.enabled || !milestoneSettings.animationEnabled) {
          setComboPreview(null)
          return
        }
        const comboValues = getReviewComboMilestones(settings.celebration.milestone.steps)
        const comboCount = comboValues[milestoneStep] ?? comboValues[0] ?? 1
        setComboPreview({
          comboCount,
          copy: getReviewSurpriseCopy(comboCount, settings.celebration.milestone.steps),
          label: getReviewMilestoneLabel(settings.celebration.milestone.steps, comboCount) ?? '推进链升级',
          milestoneStep,
        })
        return
      }

      if (previewKind === 'session_complete') {
        if (!sessionCompleteSettings.enabled || !sessionCompleteSettings.animationEnabled) {
          setCompletionPreview(null)
          return
        }
        setCompletionPreview((current) => ({
          completedNodes: 5,
          maxCombo: getReviewComboMilestones(settings.celebration.milestone.steps).at(-1) ?? 5,
          nonce: (current?.nonce ?? 0) + 1,
          totalNodes: 5,
        }))
        return
      }

      if (previewKind === 'branch_clear' || previewKind === 'all_clear_ready') {
        const eventSettings =
          previewKind === 'branch_clear' ? branchClearSettings : allClearSettings
        if (!eventSettings.enabled || !eventSettings.animationEnabled) {
          return
        }
        emitReviewConfetti({
          kind: previewKind,
          reducedMotion,
          criticalFxIntensity: settings.criticalFxIntensity,
          soundEnabled: eventSettings.soundEnabled && settings.soundEnabled,
          volume: settings.volume,
          confettiAmount: eventSettings.confettiAmount,
        })
      }
    },
    [
      audio,
      reducedMotion,
      settings.animationEnabled,
      settings.celebration.allClearReady,
      settings.celebration.branchClear,
      settings.celebration.milestone,
      settings.celebration.sessionComplete,
      settings.criticalFxIntensity,
      settings.mode,
      settings.soundEnabled,
      settings.volume,
    ],
  )

  const applyPreset = React.useCallback(() => {
    updateSettings({
      ...DEFAULT_REVIEW_FEEDBACK_SETTINGS,
      mode: 'immersive',
      soundEnabled: true,
      animationEnabled: true,
      surpriseEnabled: true,
      revealFxIntensity: 'full',
      criticalFxIntensity: 'cinematic',
      globalIntensity: 'balanced',
      volume: 1.5,
      confettiAmount: 2.2,
    })
  }, [updateSettings])

  const restoreDefaults = React.useCallback(() => {
    updateSettings(DEFAULT_REVIEW_FEEDBACK_SETTINGS)
  }, [updateSettings])

  const milestonePreviewIndex = Math.min(
    1,
    Math.max(settings.celebration.milestone.steps.length - 1, 0),
  )

  return (
    <ProfileLayout
      title="反馈中心"
      description="按场景整理翻卡反馈：先调基础体验，再单独控制里程碑、攻区、全图点亮和完成结算。"
    >
      <div className="space-y-6">
        {comboPreview ? (
          <ComboMilestoneBurst
            key={`${comboPreview.milestoneStep}-${comboPreview.comboCount}`}
            milestoneStep={comboPreview.milestoneStep}
            comboCount={comboPreview.comboCount}
            copy={comboPreview.copy}
            label={comboPreview.label}
            reducedMotion={
              reducedMotion ||
              !settings.animationEnabled ||
              settings.mode !== 'immersive' ||
              !settings.celebration.milestone.animationEnabled
            }
            criticalFxIntensity={settings.criticalFxIntensity}
            soundEnabled={settings.celebration.milestone.soundEnabled && settings.soundEnabled}
            volume={settings.volume}
            confettiAmount={settings.celebration.milestone.confettiAmount}
            onComplete={() => setComboPreview(null)}
          />
        ) : null}

        {completionPreview ? (
          <CompletionCelebration
            key={completionPreview.nonce}
            maxCombo={completionPreview.maxCombo}
            completedNodes={completionPreview.completedNodes}
            totalNodes={completionPreview.totalNodes}
            reducedMotion={
              reducedMotion ||
              !settings.animationEnabled ||
              settings.mode !== 'immersive' ||
              !settings.celebration.sessionComplete.animationEnabled
            }
            criticalFxIntensity={settings.criticalFxIntensity}
            soundEnabled={
              settings.celebration.sessionComplete.soundEnabled && settings.soundEnabled
            }
            volume={settings.volume}
            confettiAmount={settings.celebration.sessionComplete.confettiAmount}
            onComplete={() => setCompletionPreview(null)}
          />
        ) : null}

        <Card className="border-border/70 bg-card/95">
          <CardContent className="flex flex-col gap-4 px-6 py-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <CardTitle className="text-xl">翻卡反馈控制台</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={settings.mode === 'immersive' ? 'secondary' : 'outline'}>
                  {settings.mode === 'immersive' ? '沉浸模式' : '安静模式'}
                </Badge>
                <Badge variant={settings.soundEnabled ? 'secondary' : 'outline'}>
                  {settings.soundEnabled ? '声音开' : '声音关'}
                </Badge>
                <Badge variant={settings.animationEnabled ? 'secondary' : 'outline'}>
                  {settings.animationEnabled ? '动画开' : '动画关'}
                </Badge>
                <Badge variant="outline">
                  里程碑 {settings.celebration.milestone.steps.join(' / ')}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">
                你刚才没明显看到改动，主要是事件级配置被放进了折叠区。现在关键项会直接按场景展开显示。
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={applyPreset}>
                <WandSparkles className="mr-2 h-4 w-4" />
                套用推荐方案
              </Button>
              <Button type="button" variant="outline" onClick={restoreDefaults}>
                恢复默认
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => audio.playEvent('card_reveal', { audioScope: 'global' })}
              >
                <Volume2 className="mr-2 h-4 w-4" />
                试听翻卡音
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => audio.playComboMilestone(milestonePreviewIndex)}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                试听里程碑音
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1.2fr)]">
          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle className="text-base">配置面板</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
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
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border-border/70 bg-card/95">
              <CardHeader>
                <CardTitle className="text-base">效果预览</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <SectionTitle title="普通翻卡" />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      onClick={() =>
                        triggerFx(
                          {
                            type: 'card_reveal',
                            nodeUid: 'card-a1',
                            relatedNodeUids: ['card-a1'],
                            intensity: 'full',
                            milestoneStep: null,
                            lineMode: 'confirm',
                            depthHint: 2,
                            targetRole: 'placeholder',
                            isBranchCompletion: false,
                          },
                          'card_reveal',
                        )
                      }
                    >
                      单张翻卡
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        triggerFx(
                          {
                            type: 'card_reveal',
                            nodeUid: 'card-a2',
                            relatedNodeUids: ['card-a2'],
                            intensity: 'full',
                            milestoneStep: milestonePreviewIndex,
                            lineMode: 'confirm',
                            depthHint: 2,
                            targetRole: 'placeholder',
                            isBranchCompletion: false,
                          },
                          undefined,
                          milestonePreviewIndex,
                          'milestone',
                        )
                      }
                    >
                      里程碑
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <SectionTitle title="庆祝场景" />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        triggerFx(
                          {
                            type: 'branch_clear',
                            nodeUid: 'branch-a',
                            relatedNodeUids: ['branch-a', 'card-a1', 'card-a2'],
                            intensity: 'full',
                            milestoneStep: null,
                            lineMode: 'clear',
                            depthHint: 1,
                            targetRole: 'revealed',
                            isBranchCompletion: true,
                          },
                          'branch_clear',
                          undefined,
                          'branch_clear',
                        )
                      }
                    >
                      区域攻克
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        triggerFx(
                          {
                            type: 'all_clear_ready',
                            nodeUid: 'branch-b',
                            relatedNodeUids: ['branch-a', 'card-a1', 'card-a2', 'branch-b', 'card-b1'],
                            intensity: 'full',
                            milestoneStep: null,
                            lineMode: 'trace',
                            depthHint: 1,
                            targetRole: 'revealed',
                            isBranchCompletion: false,
                          },
                          'all_clear_ready',
                          undefined,
                          'all_clear_ready',
                        )
                      }
                    >
                      全图点亮
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        triggerFx(
                          {
                            type: 'session_complete',
                            nodeUid: null,
                            relatedNodeUids: ['branch-a', 'card-a1', 'card-a2', 'branch-b', 'card-b1'],
                            intensity: 'full',
                            milestoneStep: null,
                            anchor: { x: 0.5, y: 0.24 },
                          },
                          'session_complete',
                          undefined,
                          'session_complete',
                        )
                      }
                    >
                      完成结算
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/95">
              <CardHeader>
                <CardTitle className="text-base">脑图宿主页预览窗口</CardTitle>
              </CardHeader>
              <CardContent>
                <MindMapFrame
                  editorState={PREVIEW_EDITOR_STATE}
                  readonly
                  practiceModeActive
                  syncOnPropChange
                  syncIntent="replace"
                  syncReason="review_flip"
                  reviewFxSignal={reviewFxSignal}
                  onEditorStateChange={() => {}}
                  className="h-[68vh] w-full rounded-2xl border border-border/70 bg-background"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ProfileLayout>
  )
}
