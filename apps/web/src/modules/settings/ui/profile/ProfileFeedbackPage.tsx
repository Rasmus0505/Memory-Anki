import * as React from 'react'
import { Check, RotateCcw, Save, Sparkles, Volume2 } from 'lucide-react'
import { ProfileLayout } from '@/modules/settings/ui/profile/ProfileLayout'
import { emitReviewConfetti } from '@/shared/components/celebration'
import { useMindMapFeedbackAudio } from '@/shared/feedback/mindmap-audio/useMindMapFeedback'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Switch } from '@/shared/components/ui/switch'
import { InlineFeedback } from '@/shared/feedback/FeedbackStatus'
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT,
  REVIEW_FEEDBACK_VOLUME_MAX,
  applyFeedbackPreset,
  getReviewFeedbackEffectiveVolume,
  readReviewFeedbackSettings,
  resolveFeedbackChannels,
  writeReviewFeedbackSettings,
  type FeedbackChannelOverride,
  type FeedbackPreset,
  type FeedbackSceneKey,
  type ReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import {
  FEEDBACK_SCENE_DESCRIPTORS,
  FeedbackSceneEditor,
} from '@/modules/settings/ui/profile/components/FeedbackSceneEditor'
import { cn } from '@/shared/lib/utils'

const PRESET_OPTIONS: Array<{
  value: FeedbackPreset
  title: string
  description: string
}> = [
  {
    value: 'focus',
    title: '专注',
    description: '普通学习保持安静，只保留计时召回与最终完成。',
  },
  {
    value: 'balanced',
    title: '平衡',
    description: '答题使用短促语义音，里程碑轻量呈现，完成时庆祝。',
  },
  {
    value: 'motivating',
    title: '激励',
    description: '触发规则不变，提高里程碑与最终完成的表现强度。',
  },
]

function cloneSettings(settings: ReviewFeedbackSettings) {
  return JSON.parse(JSON.stringify(settings)) as ReviewFeedbackSettings
}

function SettingRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/55 py-4 last:border-b-0">
      <div>
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={title} />
    </div>
  )
}

const CHANNEL_ROWS = [
  {
    field: 'learningSoundsEnabled',
    resolvedKey: 'learningSounds',
    title: '学习结果声音',
    description: '控制答题和翻卡结果音，不影响计时召回。',
  },
  {
    field: 'milestoneEffectsEnabled',
    resolvedKey: 'milestoneEffects',
    title: '阶段成就效果',
    description: '控制连击与阶段里程碑，不改变进度状态本身。',
  },
  {
    field: 'completionEffectsEnabled',
    resolvedKey: 'completionEffects',
    title: '最终完成效果',
    description: '控制整次训练完成的彩带与总结强调。',
  },
] as const

/** Tri-state row: `null` follows the preset, an explicit boolean overrides it. */
function ChannelRow({
  title,
  description,
  value,
  resolved,
  onChange,
}: {
  title: string
  description: string
  value: FeedbackChannelOverride
  resolved: boolean
  onChange: (next: FeedbackChannelOverride) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/55 py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {value == null ? (
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
              跟随预设
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/20"
            >
              已自定义 · 恢复跟随
            </button>
          )}
        </div>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
      </div>
      <Switch checked={resolved} onCheckedChange={(next) => onChange(next)} aria-label={title} />
    </div>
  )
}

export default function ProfileFeedbackPage() {
  const [savedSettings, setSavedSettings] = React.useState<ReviewFeedbackSettings>(() =>
    readReviewFeedbackSettings(),
  )
  const [draftSettings, setDraftSettings] = React.useState<ReviewFeedbackSettings>(() =>
    cloneSettings(readReviewFeedbackSettings()),
  )
  const [status, setStatus] = React.useState<{
    tone: 'success' | 'warning'
    message: string
  } | null>(null)
  const effectiveVolume = getReviewFeedbackEffectiveVolume(draftSettings)
  const audio = useMindMapFeedbackAudio(
    draftSettings.soundEnabled,
    effectiveVolume,
  )
  const isDirty = React.useMemo(
    () => JSON.stringify(savedSettings) !== JSON.stringify(draftSettings),
    [draftSettings, savedSettings],
  )
  const resolvedChannels = React.useMemo(
    () => resolveFeedbackChannels(draftSettings),
    [draftSettings],
  )
  const isDirtyRef = React.useRef(isDirty)
  React.useEffect(() => {
    isDirtyRef.current = isDirty
  }, [isDirty])

  React.useEffect(() => {
    const sync = () => {
      const next = readReviewFeedbackSettings()
      setSavedSettings(cloneSettings(next))
      if (!isDirtyRef.current) setDraftSettings(cloneSettings(next))
    }
    window.addEventListener(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, sync)
    return () => window.removeEventListener(REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT, sync)
  }, [])

  const updateDraft = React.useCallback(
    (updater: (current: ReviewFeedbackSettings) => ReviewFeedbackSettings) => {
      setStatus(null)
      setDraftSettings((current) => updater(current))
    },
    [],
  )

  const selectPreset = React.useCallback(
    (preset: FeedbackPreset) => {
      updateDraft((current) => applyFeedbackPreset(current, preset))
    },
    [updateDraft],
  )

  const save = React.useCallback(() => {
    const next = writeReviewFeedbackSettings(draftSettings)
    setSavedSettings(cloneSettings(next))
    setDraftSettings(cloneSettings(next))
    setStatus({ tone: 'success', message: '反馈偏好已保存' })
  }, [draftSettings])

  const reset = React.useCallback(() => {
    const next = applyFeedbackPreset(cloneSettings(DEFAULT_REVIEW_FEEDBACK_SETTINGS), 'balanced')
    setDraftSettings(next)
    setStatus(null)
  }, [])

  const previewMilestone = React.useCallback(() => {
    emitReviewConfetti({
      kind: 'milestone',
      confettiAmount: draftSettings.scenes.milestone.confettiAmount,
      confettiPreset: draftSettings.scenes.milestone.confettiPreset,
      milestoneStep: 1,
      reducedMotion: draftSettings.reducedCelebrationMotion,
      soundEnabled: draftSettings.soundEnabled,
      volume: effectiveVolume,
    })
  }, [draftSettings, effectiveVolume])

  const previewCompletion = React.useCallback(() => {
    emitReviewConfetti({
      kind: 'session_complete',
      confettiAmount: draftSettings.scenes.completion.confettiAmount,
      confettiPreset: draftSettings.scenes.completion.confettiPreset,
      reducedMotion: draftSettings.reducedCelebrationMotion,
      soundEnabled: draftSettings.soundEnabled,
      volume: effectiveVolume,
    })
  }, [draftSettings, effectiveVolume])

  return (
    <ProfileLayout
      title="反馈中心"
      description="统一管理学习声音、动态效果与桌面提醒。计时阶段和轮次细节请在“计时与休息”中设置。"
    >
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">反馈模式</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              {PRESET_OPTIONS.map((option) => {
                const active = draftSettings.preset === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectPreset(option.value)}
                    className={cn(
                      'rounded-xl border p-4 text-left',
                      active
                        ? 'border-primary/55 bg-primary/7 ring-1 ring-primary/20'
                        : 'border-border/70 bg-background hover:border-border',
                    )}
                  >
                    <span className="flex items-center justify-between gap-3 text-sm font-semibold">
                      {option.title}
                      {active ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
                    </span>
                    <span className="mt-2 block text-sm leading-5 text-muted-foreground">
                      {option.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Volume2 className="size-4" />
                通道总控
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SettingRow
                title="声音反馈"
                description="只播放答题、里程碑、完成与计时等有明确语义的短音。"
                checked={draftSettings.soundEnabled}
                onCheckedChange={(soundEnabled) =>
                  updateDraft((current) => ({ ...current, soundEnabled }))
                }
              />
              <div className="border-b border-border/55 py-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">基础音量</div>
                    <p className="mt-1 text-sm text-muted-foreground">计时器仍可在自己的设置中微调事件音量。</p>
                  </div>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {Math.round(draftSettings.volume * 100)}%
                  </span>
                </div>
                <Input
                  type="range"
                  min="0"
                  max={String(REVIEW_FEEDBACK_VOLUME_MAX)}
                  step="0.05"
                  value={draftSettings.volume}
                  aria-label="基础音量"
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, volume: Number(event.target.value) }))
                  }
                />
              </div>
              <SettingRow
                title="动态效果"
                description="控制阶段成就与最终完成动画，不影响控件自身状态变化。"
                checked={draftSettings.animationEnabled}
                onCheckedChange={(animationEnabled) =>
                  updateDraft((current) => ({ ...current, animationEnabled }))
                }
              />
              <SettingRow
                title="减少庆祝动态"
                description="保留状态与文字，缩短或移除粒子和大幅移动。"
                checked={draftSettings.reducedCelebrationMotion}
                onCheckedChange={(reducedCelebrationMotion) =>
                  updateDraft((current) => ({ ...current, reducedCelebrationMotion }))
                }
              />
              <SettingRow
                title="惊喜彩蛋"
                description="偶尔在连击时出现的额外鼓励文案。"
                checked={draftSettings.surpriseEnabled}
                onCheckedChange={(surpriseEnabled) =>
                  updateDraft((current) => ({ ...current, surpriseEnabled }))
                }
              />
            </CardContent>
          </Card>

          <Card className="h-fit">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4" />
                语义预览
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border/65 p-4">
                <div className="text-sm font-semibold">答题结果</div>
                <p className="mt-1 text-sm text-muted-foreground">答对清晰鼓励；答错保持克制并引向解析。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => audio.playEvent('quiz_result_correct', { audioScope: 'global' })}>
                    试听答对
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => audio.playEvent('quiz_result_incorrect', { audioScope: 'global' })}>
                    试听答错
                  </Button>
                </div>
              </div>
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/6 p-4">
                <div className="text-sm font-semibold text-amber-950 dark:text-amber-100">阶段成就</div>
                <p className="mt-1 text-sm text-muted-foreground">金色只用于连击里程碑和阶段完成。</p>
                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={previewMilestone}>
                  预览里程碑
                </Button>
              </div>
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/6 p-4">
                <div className="text-sm font-semibold text-emerald-950 dark:text-emerald-100">最终完成</div>
                <p className="mt-1 text-sm text-muted-foreground">完整总结与庆祝只在整次训练完成时出现。</p>
                <Button type="button" size="sm" variant="outline" className="mt-3" onClick={previewCompletion}>
                  预览完成
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">分类通道</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="pb-2 text-xs text-muted-foreground">
              默认跟随上面的反馈模式。一旦你在这里明确开关，预设就不会再改动它。
            </p>
            {CHANNEL_ROWS.map((row) => (
              <ChannelRow
                key={row.field}
                title={row.title}
                description={row.description}
                value={draftSettings[row.field]}
                resolved={resolvedChannels[row.resolvedKey]}
                onChange={(next) =>
                  updateDraft((current) => ({ ...current, [row.field]: next }))
                }
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">按场景微调</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0 xl:grid-cols-2">
            {FEEDBACK_SCENE_DESCRIPTORS.map((descriptor) => (
              <FeedbackSceneEditor
                key={descriptor.key}
                descriptor={descriptor}
                scene={draftSettings.scenes[descriptor.key as FeedbackSceneKey]}
                baseVolume={draftSettings.volume}
                onChange={(patch) =>
                  updateDraft((current) => ({
                    ...current,
                    scenes: {
                      ...current.scenes,
                      [descriptor.key]: {
                        ...current.scenes[descriptor.key as FeedbackSceneKey],
                        ...patch,
                      },
                    },
                  }))
                }
              />
            ))}
          </CardContent>
        </Card>

        <div className="sticky bottom-20 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/95 p-3 shadow-lg backdrop-blur sm:bottom-4">
          <div className="flex min-h-8 items-center gap-2">
            {status ? <InlineFeedback tone={status.tone} message={status.message} /> : null}
            {!status && isDirty ? <span className="text-sm text-muted-foreground">有尚未保存的更改</span> : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={reset}>
              <RotateCcw className="mr-2 size-4" />
              恢复默认
            </Button>
            <Button type="button" onClick={save} disabled={!isDirty}>
              <Save className="mr-2 size-4" />
              保存设置
            </Button>
          </div>
        </div>
      </div>
    </ProfileLayout>
  )
}
