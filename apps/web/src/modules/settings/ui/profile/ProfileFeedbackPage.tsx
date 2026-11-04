import * as React from 'react'
import { Check, RotateCcw, Volume2, VolumeX, Play } from 'lucide-react'
import { ProfileLayout } from '@/modules/settings/ui/profile/ProfileLayout'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Switch } from '@/shared/components/ui/switch'
import { useMindMapFeedbackAudio } from '@/shared/feedback/mindmap-audio/useMindMapFeedback'
import {
  CONCRETE_SOUND_VOICES,
  SOUND_VOICE_OPTIONS,
  type ConcreteSoundVoice,
} from '@/shared/feedback/mindmap-audio/soundVoices'
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  REVIEW_FEEDBACK_SETTINGS_UPDATED_EVENT,
  REVIEW_FEEDBACK_VOLUME_MAX,
  readReviewFeedbackSettings,
  writeReviewFeedbackSettings,
  type ReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import { cn } from '@/shared/lib/utils'
import { useAutosaveDocument } from '@/shared/hooks/useAutosaveDocument'
import { useUnsavedChangesGuard } from '@/shared/hooks/useUnsavedChangesGuard'

function cloneSettings(settings: ReviewFeedbackSettings) {
  return JSON.parse(JSON.stringify(settings)) as ReviewFeedbackSettings
}

function selectionSummary(voices: readonly ConcreteSoundVoice[]) {
  if (voices.length === CONCRETE_SOUND_VOICES.length) return '三种风格等概率混合'
  if (voices.length === 1) return '单一风格'
  return `${voices.length} 种风格等概率混合`
}

export default function ProfileFeedbackPage() {
  const initial = React.useMemo(() => readReviewFeedbackSettings(), [])
  const [savedSettings, setSavedSettings] = React.useState<ReviewFeedbackSettings>(() => cloneSettings(initial))
  const [draftSettings, setDraftSettings] = React.useState<ReviewFeedbackSettings>(() => cloneSettings(initial))
  const audio = useMindMapFeedbackAudio(draftSettings.soundEnabled, draftSettings.volume)
  const isDirty = React.useMemo(
    () => JSON.stringify(savedSettings) !== JSON.stringify(draftSettings),
    [draftSettings, savedSettings],
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
      setDraftSettings((current) => updater(current))
    },
    [],
  )

  const preview = React.useCallback(
    (event: 'quiz_result_correct' | 'quiz_result_incorrect', voice?: ConcreteSoundVoice | readonly ConcreteSoundVoice[]) => {
      audio.playEvent(event, { audioScope: 'global', voice: voice ?? draftSettings.soundVoices })
    },
    [audio, draftSettings.soundVoices],
  )

  const toggleVoice = React.useCallback(
    (voice: ConcreteSoundVoice) => {
      updateDraft((current) => {
        const selected = current.soundVoices.includes(voice)
        if (selected && current.soundVoices.length === 1) return current
        const nextVoices = selected
          ? current.soundVoices.filter((item) => item !== voice)
          : CONCRETE_SOUND_VOICES.filter((item) => current.soundVoices.includes(item) || item === voice)
        return {
          ...current,
          soundVoice: nextVoices.length === CONCRETE_SOUND_VOICES.length ? 'mixed' : nextVoices[0] ?? 'crystal',
          soundVoices: nextVoices,
        }
      })
    },
    [updateDraft],
  )

  const selectAllVoices = React.useCallback(() => {
    updateDraft((current) => ({
      ...current,
      soundVoice: 'mixed',
      soundVoices: [...CONCRETE_SOUND_VOICES],
    }))
  }, [updateDraft])

  const { status: autosaveStatus } = useAutosaveDocument({
    value: draftSettings,
    persist: writeReviewFeedbackSettings,
  })
  useUnsavedChangesGuard(autosaveStatus === 'pending' || autosaveStatus === 'saving')

  const reset = React.useCallback(() => {
    setDraftSettings(cloneSettings(DEFAULT_REVIEW_FEEDBACK_SETTINGS))
  }, [])

  return (
    <ProfileLayout
      title="反馈中心"
    >
      <div className="space-y-6 pb-24">
        <Card className="overflow-hidden border-primary/25 bg-gradient-to-br from-primary/[0.08] via-card to-card">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  {draftSettings.soundEnabled ? <Volume2 className="size-5 text-primary" /> : <VolumeX className="size-5 text-muted-foreground" />}
                  先听一声
                </CardTitle>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                  勾选的风格会随机轮换，同一段连弹不中途换声。
                </p>
              </div>
              <Switch
                checked={draftSettings.soundEnabled}
                onCheckedChange={(soundEnabled) => updateDraft((current) => ({ ...current, soundEnabled }))}
                aria-label="声音反馈"
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Button type="button" size="lg" onClick={() => preview('quiz_result_correct')} disabled={!draftSettings.soundEnabled}>
                <Play className="mr-2 size-4 fill-current" />
                试听答对
              </Button>
              <Button type="button" size="lg" variant="outline" onClick={() => preview('quiz_result_incorrect')} disabled={!draftSettings.soundEnabled}>
                <Play className="mr-2 size-4" />
                试听答错
              </Button>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">当前组合</div>
                  <div className="mt-1 text-sm text-muted-foreground" aria-live="polite">
                    {selectionSummary(draftSettings.soundVoices)}
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={selectAllVoices} disabled={draftSettings.soundVoices.length === CONCRETE_SOUND_VOICES.length}>
                  全部混合
                </Button>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <span className="shrink-0 text-xs text-muted-foreground">全局音量</span>
                <Input
                  type="range"
                  min="0"
                  max={String(REVIEW_FEEDBACK_VOLUME_MAX)}
                  step="0.05"
                  value={draftSettings.volume}
                  aria-label="全局音量"
                  onChange={(event) => updateDraft((current) => ({ ...current, volume: Number(event.target.value) }))}
                />
                <span className="w-12 text-right text-sm tabular-nums text-muted-foreground">
                  {Math.round(draftSettings.volume * 100)}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <section aria-labelledby="sound-style-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="sound-style-heading" className="text-base font-semibold">选择音色风格</h2>
            </div>
            <span className="text-xs text-muted-foreground">已选 {draftSettings.soundVoices.length} / {CONCRETE_SOUND_VOICES.length}</span>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {SOUND_VOICE_OPTIONS.map((option) => {
              const checked = draftSettings.soundVoices.includes(option.id)
              return (
                <div
                  key={option.id}
                  className={cn(
                    'rounded-2xl border p-4 transition-colors',
                    checked ? 'border-primary/55 bg-primary/[0.06] ring-1 ring-primary/20' : 'border-border/70 bg-card hover:border-primary/35',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex min-w-0 cursor-pointer items-start gap-3">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleVoice(option.id)}
                        aria-label={`选择${option.title}`}
                        disabled={checked && draftSettings.soundVoices.length === 1}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{option.title}</span>
                        <span className="mt-1 block text-xs font-medium text-primary">{option.character}</span>
                      </span>
                    </label>
                    {checked ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : null}
                  </div>
                  <p className="mt-4 min-h-10 text-sm leading-5 text-muted-foreground">{option.description}</p>
                  <Button
                    type="button"
                    variant={checked ? 'secondary' : 'outline'}
                    size="sm"
                    className="mt-4 w-full"
                    onClick={() => preview('quiz_result_correct', option.id)}
                    disabled={!draftSettings.soundEnabled}
                  >
                    <Play className="mr-2 size-3.5" />
                    试听这套
                  </Button>
                </div>
              )
            })}
          </div>
        </section>

        <div className="sticky bottom-20 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-background/95 p-3 shadow-lg backdrop-blur sm:bottom-4">
          <span className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {autosaveStatus === 'saving' || autosaveStatus === 'pending'
              ? '正在保存…'
              : autosaveStatus === 'error'
                ? '保存失败，请检查本机服务后重试'
                : autosaveStatus === 'saved'
                  ? '已保存'
                  : null}
          </span>
          <Button type="button" variant="outline" onClick={reset}>
            <RotateCcw className="mr-2 size-4" />
            恢复默认
          </Button>
        </div>
      </div>
    </ProfileLayout>
  )
}
