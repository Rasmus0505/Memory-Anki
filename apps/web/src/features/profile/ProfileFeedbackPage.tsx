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
} from '@/shared/feedback/reviewFeedbackSettings'
import {
  getReviewComboMilestones,
  getReviewMilestoneLabel,
  getReviewSurpriseCopy,
} from '@/features/review/model/review-feedback'
import {
  ProfileFeedbackSettingsPanel,
  SectionTitle,
} from '@/features/profile/components/ProfileFeedbackSettingsPanel'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

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
            <CardContent>
              <ProfileFeedbackSettingsPanel
                settings={settings}
                milestoneStepsInput={milestoneStepsInput}
                setMilestoneStepsInput={setMilestoneStepsInput}
                updateSettings={updateSettings}
              />
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
