import * as React from 'react'
import { RotateCcw, Save, Volume2, WandSparkles } from 'lucide-react'
import { ProfileLayout } from '@/features/profile/ProfileLayout'
import { useRevealSession } from '@/entities/review/model/useRevealSession'
import { PREVIEW_EDITOR_STATE, PREVIEW_EDITOR_TITLE } from '@/features/profile/previewEditorState'
import { useReviewFeedback } from '@/features/review/hooks/useReviewFeedback'
import { useMindMapFeedbackAudio } from '@/shared/components/mindmap-host/useMindMapFeedback'
import { MindMapFrame } from '@/shared/components/mindmap-host'
import {
  ComboMilestoneBurst,
  CompletionCelebration,
  emitReviewConfetti,
} from '@/shared/components/celebration'
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  getReviewFeedbackEffectiveVolume,
  getSceneEffectiveVolume,
  writeReviewFeedbackSettings,
  type FeedbackSceneKey,
  type ReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import {
  DEFAULT_TIMER_FOCUS_CONFIG,
  saveTimerFocusConfig,
  type TimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'
import { emitTimerCelebration } from '@/shared/components/session/timer-celebration'
import {
  ProfileFeedbackSettingsPanel,
  SectionTitle,
} from '@/features/profile/components/ProfileFeedbackSettingsPanel'
import { ProfileTimerFeedbackSettingsPanel } from '@/features/profile/components/ProfileTimerFeedbackSettingsPanel'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

function cloneSettings(settings: ReviewFeedbackSettings) {
  return JSON.parse(JSON.stringify(settings)) as ReviewFeedbackSettings
}

function cloneTimerConfig(config: TimerFocusConfig) {
  return JSON.parse(JSON.stringify(config)) as TimerFocusConfig
}

export default function ProfileFeedbackPage() {
  const [savedSettings, setSavedSettings] = React.useState<ReviewFeedbackSettings>(() =>
    cloneSettings(DEFAULT_REVIEW_FEEDBACK_SETTINGS),
  )
  const [draftSettings, setDraftSettings] = React.useState<ReviewFeedbackSettings>(() =>
    cloneSettings(DEFAULT_REVIEW_FEEDBACK_SETTINGS),
  )
  const [savedTimerConfig, setSavedTimerConfig] = React.useState<TimerFocusConfig>(() =>
    cloneTimerConfig(DEFAULT_TIMER_FOCUS_CONFIG),
  )
  const [draftTimerConfig, setDraftTimerConfig] = React.useState<TimerFocusConfig>(() =>
    cloneTimerConfig(DEFAULT_TIMER_FOCUS_CONFIG),
  )
  const [milestoneStepsInput, setMilestoneStepsInput] = React.useState(
    DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.milestone.steps.join(', '),
  )
  const [previewSummary, setPreviewSummary] = React.useState('选择一个预览动作后，脑图会真实翻转并触发反馈。')
  const [showTimerSettings, setShowTimerSettings] = React.useState(false)
  const effectiveVolume = getReviewFeedbackEffectiveVolume(draftSettings)
  const audio = useMindMapFeedbackAudio(
    draftSettings.soundEnabled && draftSettings.mode === 'immersive',
    effectiveVolume,
  )

  // ── 翻卡状态机 ──
  const reveal = useRevealSession({
    title: PREVIEW_EDITOR_TITLE,
    editorState: PREVIEW_EDITOR_STATE,
    mode: 'standard',
  })

  // ── 反馈链（自动从 revealMap 派生 reviewFxSignal / 音效 / combo） ──
  const feedback = useReviewFeedback({
    root: reveal.root,
    revealMap: reveal.revealMap,
    revealedNonRootCount: reveal.revealedNonRootCount,
    totalNodeCount: reveal.totalNodeCount,
    revealMode: 'standard',
  })

  // ── 完成预览（彩带 + 庆祝文字） ──
  const [completionPreview, setCompletionPreview] = React.useState<{
    completedNodes: number
    maxCombo: number
    nonce: number
    totalNodes: number
  } | null>(null)

  // ── 脏检测 ──
  const isDirty = React.useMemo(
    () =>
      JSON.stringify(savedSettings) !== JSON.stringify(draftSettings) ||
      JSON.stringify(savedTimerConfig) !== JSON.stringify(draftTimerConfig),
    [draftSettings, draftTimerConfig, savedSettings, savedTimerConfig],
  )

  // ── 手动触发完成彩带（从 draftSettings 读取场景配置） ──
  const triggerCompletionConfetti = React.useCallback(() => {
    emitReviewConfetti({
      kind: 'session_complete',
      confettiAmount: draftSettings.scenes.completion.confettiAmount,
      reducedMotion: false,
      soundEnabled: draftSettings.soundEnabled,
      volume: getSceneEffectiveVolume(draftSettings, 'completion'),
      confettiPreset: draftSettings.scenes.completion.confettiPreset,
    })
    setCompletionPreview({
      completedNodes: reveal.revealedNonRootCount,
      maxCombo: feedback.maxComboCount,
      nonce: Date.now(),
      totalNodes: reveal.totalNodeCount,
    })
  }, [draftSettings, reveal.revealedNonRootCount, reveal.totalNodeCount, feedback.maxComboCount])

  const triggerQuizCorrectPreview = React.useCallback(() => {
    emitReviewConfetti({
      kind: 'quiz_correct',
      confettiAmount: draftSettings.scenes.quiz.confettiAmount,
      reducedMotion: draftSettings.reducedCelebrationMotion,
      soundEnabled: draftSettings.soundEnabled && draftSettings.scenes.quiz.soundEnabled,
      volume: getSceneEffectiveVolume(draftSettings, 'quiz'),
      confettiPreset: draftSettings.scenes.quiz.confettiPreset,
    })
    setPreviewSummary('已触发答题正确反馈。')
  }, [draftSettings])

  // ── 计时器预览 ──
  const previewTimerSecondary = React.useCallback(() => {
    emitTimerCelebration({
      completionCount: 4,
      kind: 'secondary',
      reducedMotion: false,
      soundEnabled: draftSettings.soundEnabled,
      volume: getSceneEffectiveVolume(draftSettings, 'timer'),
      feedbackIntensity: draftTimerConfig.feedbackIntensity,
      eventConfig: draftTimerConfig.celebration.secondaryInterval,
    })
    setPreviewSummary('已触发二级子间隔到点反馈。')
  }, [draftSettings, draftTimerConfig])

  const previewTimerPrimary = React.useCallback(() => {
    emitTimerCelebration({
      completionCount: 6,
      kind: 'primary',
      reducedMotion: false,
      soundEnabled: draftSettings.soundEnabled,
      volume: getSceneEffectiveVolume(draftSettings, 'timer'),
      feedbackIntensity: draftTimerConfig.feedbackIntensity,
      eventConfig: draftTimerConfig.celebration.primaryGoal,
    })
    setPreviewSummary('已触发一级总目标完成反馈。')
  }, [draftSettings, draftTimerConfig])

  // ── 音量拖动时立即试听 ──
  const handleVolumePreview = React.useCallback(
    (scene: FeedbackSceneKey) => {
      if (scene === 'timer') {
        previewTimerSecondary()
        return
      }
      const event =
        scene === 'review'
          ? 'card_reveal'
          : scene === 'milestone'
            ? 'card_reveal'
            : scene === 'quiz'
              ? 'quiz_result_correct'
              : 'session_complete'
      audio.playEvent(event as Parameters<typeof audio.playEvent>[0], { audioScope: 'global' })
    },
    [audio, previewTimerSecondary],
  )

  const updateSettings = React.useCallback(
    (
      nextSettings:
        | ReviewFeedbackSettings
        | ((current: ReviewFeedbackSettings) => ReviewFeedbackSettings),
    ) => {
      setDraftSettings((current) => {
        const candidate = typeof nextSettings === 'function' ? nextSettings(current) : nextSettings
        return candidate
      })
    },
    [],
  )

  const updateTimerConfig = React.useCallback(
    (
      nextConfig: TimerFocusConfig | ((current: TimerFocusConfig) => TimerFocusConfig),
    ) => {
      setDraftTimerConfig((current) =>
        typeof nextConfig === 'function' ? nextConfig(current) : nextConfig,
      )
    },
    [],
  )

  const saveAll = React.useCallback(() => {
    const nextSettings = writeReviewFeedbackSettings(draftSettings)
    const nextTimerConfig = saveTimerFocusConfig(draftTimerConfig)
    setSavedSettings(cloneSettings(nextSettings))
    setDraftSettings(cloneSettings(nextSettings))
    setSavedTimerConfig(cloneTimerConfig(nextTimerConfig))
    setDraftTimerConfig(cloneTimerConfig(nextTimerConfig))
    setPreviewSummary('已保存当前草稿配置，真实业务页将读取同一份配置。')
  }, [draftSettings, draftTimerConfig])

  const resetToSaved = React.useCallback(() => {
    setDraftSettings(cloneSettings(savedSettings))
    setDraftTimerConfig(cloneTimerConfig(savedTimerConfig))
    setMilestoneStepsInput(savedSettings.scenes.milestone.steps.join(', '))
    setPreviewSummary('已撤销到最近一次保存的配置。')
  }, [savedSettings, savedTimerConfig])

  const restoreDefaults = React.useCallback(() => {
    setDraftSettings(cloneSettings(DEFAULT_REVIEW_FEEDBACK_SETTINGS))
    setDraftTimerConfig(cloneTimerConfig(DEFAULT_TIMER_FOCUS_CONFIG))
    setMilestoneStepsInput(DEFAULT_REVIEW_FEEDBACK_SETTINGS.scenes.milestone.steps.join(', '))
    setPreviewSummary('已恢复默认值，预览已切换到默认配置。')
  }, [])

  return (
    <ProfileLayout title="反馈中心">
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(380px,420px)]">
        <div className="order-2 space-y-4 min-w-0 2xl:order-1">
          <Card className="memory-anki-warm-panel border-border/60 bg-card/95">
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-xl">反馈配置</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={isDirty ? 'outline' : 'secondary'}>
                    {isDirty ? '有未保存更改' : '已同步'}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button type="button" onClick={saveAll} disabled={!isDirty}>
                <Save className="mr-2 size-4" />
                保存
              </Button>
              <Button type="button" variant="outline" onClick={resetToSaved} disabled={!isDirty}>
                <RotateCcw className="mr-2 size-4" />
                撤销
              </Button>
              <Button type="button" variant="ghost" onClick={restoreDefaults}>
                恢复默认
              </Button>
            </CardContent>
          </Card>

          <Card className="memory-anki-warm-panel border-border/60 bg-card/95">
            <CardHeader>
              <CardTitle className="text-base">翻卡反馈设置</CardTitle>
            </CardHeader>
            <CardContent>
              <ProfileFeedbackSettingsPanel
                settings={draftSettings}
                milestoneStepsInput={milestoneStepsInput}
                setMilestoneStepsInput={setMilestoneStepsInput}
                updateSettings={updateSettings}
                onVolumePreview={handleVolumePreview}
              />
            </CardContent>
          </Card>

          <Card className="memory-anki-warm-panel border-border/60 bg-card/95">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">计时器反馈设置</CardTitle>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowTimerSettings((current) => !current)}
              >
                {showTimerSettings ? '收起' : '展开'}
              </Button>
            </CardHeader>
            {showTimerSettings ? (
              <CardContent>
                <ProfileTimerFeedbackSettingsPanel
                  config={draftTimerConfig}
                  updateConfig={updateTimerConfig}
                />
              </CardContent>
            ) : null}
          </Card>
        </div>

        <div className="order-1 space-y-4 min-w-0 self-start 2xl:sticky 2xl:top-5 2xl:order-2">
          <Card className="memory-anki-warm-panel border-border/60 bg-card/95">
            <CardHeader className="gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-xl">实时预览台</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={draftSettings.soundEnabled ? 'secondary' : 'outline'}>
                    {draftSettings.soundEnabled ? '声音开启' : '声音关闭'}
                  </Badge>
                  <Badge variant={draftSettings.animationEnabled ? 'secondary' : 'outline'}>
                    {draftSettings.animationEnabled ? '动画开启' : '动画关闭'}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-[20px] border border-border/70 bg-background/75 px-4 py-3 text-sm text-muted-foreground">
                {previewSummary}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="memory-anki-soft-card rounded-[20px] px-4 py-4">
                  <SectionTitle title="普通翻卡" />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" onClick={() => {
                      // 翻一张 hidden → placeholder
                      const hiddenId = Object.entries(reveal.revealMap).find(
                        ([id, state]) => state === 'hidden' && id !== reveal.root.id,
                      )?.[0]
                      if (hiddenId) {
                        reveal.setRevealMap((current) => ({ ...current, [hiddenId]: 'placeholder' }))
                        setPreviewSummary('已翻转一个知识点，请查看脑图反馈。')
                      } else {
                        // 所有知识点都非 hidden，重置
                        reveal.reset()
                        setPreviewSummary('已重置脑图，所有知识点回到初始状态。')
                      }
                    }}>
                      <WandSparkles className="mr-2 size-4" />
                      翻一个知识点
                    </Button>
                    <Button type="button" variant="outline" onClick={() => audio.playEvent('card_reveal', { audioScope: 'global' })}>
                      <Volume2 className="mr-2 size-4" />
                      试听音效
                    </Button>
                  </div>
                </div>

                <div className="memory-anki-soft-card rounded-[20px] px-4 py-4">
                  <SectionTitle title="完成结算" />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" onClick={() => {
                      // 重置后全部揭示
                      reveal.reset()
                      setPreviewSummary('已完成结算预览。')
                      setTimeout(() => triggerCompletionConfetti(), 100)
                    }}>
                      触发完成
                    </Button>
                    <Button type="button" variant="outline" onClick={() => reveal.reset()}>
                      <RotateCcw className="mr-2 size-4" />
                      重置脑图
                    </Button>
                  </div>
                </div>

                <div className="memory-anki-soft-card rounded-[20px] px-4 py-4">
                  <SectionTitle title="答题结果" />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" onClick={triggerQuizCorrectPreview}>
                      答对反馈
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        audio.playEvent('quiz_result_incorrect', { audioScope: 'global' })
                        setPreviewSummary('已触发答题错误音效。')
                      }}
                    >
                      答错音效
                    </Button>
                  </div>
                </div>

                <div className="memory-anki-soft-card rounded-[20px] px-4 py-4 md:col-span-2">
                  <SectionTitle title="计时器达标" />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" onClick={previewTimerSecondary}>
                      二级子间隔
                    </Button>
                    <Button type="button" variant="outline" onClick={previewTimerPrimary}>
                      一级总目标
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="memory-anki-warm-panel border-border/60 bg-card/95">
            <CardHeader>
              <CardTitle className="text-base">脑图宿主页预览窗口</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <MindMapFrame
                editorState={reveal.visibleEditorState ?? PREVIEW_EDITOR_STATE}
                readonly
                practiceModeActive
                syncOnPropChange
                syncIntent="replace"
                syncReason="review_flip"
                reviewFxSignal={feedback.reviewFxSignal}
                onNodeClick={reveal.handleNodeClick}
                onNodeContextMenu={reveal.handleNodeContextMenu}
                onEditorStateChange={() => {}}
                className="h-[68vh] w-full rounded-lg border border-border/70 bg-background"
              />
              {feedback.milestoneCelebration ? (
                <ComboMilestoneBurst
                  comboCount={feedback.milestoneCelebration.comboCount}
                  copy={feedback.milestoneLabel ?? ''}
                  confettiAmount={draftSettings.scenes.milestone.confettiAmount}
                  milestoneStep={feedback.milestoneCelebration.milestoneStep}
                  label={feedback.milestoneLabel ?? ''}
                />
              ) : null}
              {completionPreview ? (
                <CompletionCelebration
                  completedNodes={completionPreview.completedNodes}
                  confettiAmount={draftSettings.scenes.completion.confettiAmount}
                  maxCombo={completionPreview.maxCombo}
                  totalNodes={completionPreview.totalNodes}
                />
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </ProfileLayout>
  )
}
