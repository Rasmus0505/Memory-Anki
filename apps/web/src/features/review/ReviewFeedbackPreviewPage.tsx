import * as React from 'react'
import { Sparkles, Volume2, WandSparkles } from 'lucide-react'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { MindMapFrame } from '@/shared/components/mindmap-host'
import { useMindMapFeedbackAudioFromSettings } from '@/shared/components/mindmap-host/useMindMapFeedback'
import type { MindMapReviewFxPayload } from '@/shared/components/mindmap-host/hostBridgeUtils'
import {
  DEFAULT_REVIEW_FEEDBACK_SETTINGS,
  readReviewFeedbackSettings,
  writeReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
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
                text: '待回忆知识点 A1',
                uid: 'card-a1',
              },
              children: [],
            },
            {
              data: {
                text: '待回忆知识点 A2',
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
                text: '待回忆知识点 B1',
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

export default function ReviewFeedbackPreviewPage() {
  const audio = useMindMapFeedbackAudioFromSettings()
  const [nonce, setNonce] = React.useState(0)
  const [reviewFxSignal, setReviewFxSignal] = React.useState<MindMapReviewFxPayload | null>(null)
  const [settingsStamp, setSettingsStamp] = React.useState(() =>
    JSON.stringify(readReviewFeedbackSettings()),
  )

  const settings = React.useMemo(
    () => readReviewFeedbackSettings(),
    [settingsStamp],
  )

  const triggerFx = React.useCallback(
    (payload: Omit<MindMapReviewFxPayload, 'nonce'>, audioEvent?: Parameters<typeof audio.playEvent>[0]) => {
      setNonce((current) => {
        const nextSignal = buildFxSignal(current, payload)
        setReviewFxSignal(nextSignal)
        return nextSignal.nonce
      })
      if (audioEvent) {
        audio.playEvent(audioEvent, { audioScope: 'global' })
      }
    },
    [audio],
  )

  const enablePreviewMode = React.useCallback(() => {
    writeReviewFeedbackSettings({
      ...DEFAULT_REVIEW_FEEDBACK_SETTINGS,
      mode: 'immersive',
      soundEnabled: true,
      animationEnabled: true,
      volume: 1.5,
      baseVolumeMultiplier: 1,
    })
    setSettingsStamp(JSON.stringify(readReviewFeedbackSettings()))
  }, [])

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/95">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">反馈预览</Badge>
            <Badge variant={settings.mode === 'immersive' ? 'secondary' : 'outline'}>
              {settings.mode === 'immersive' ? '沉浸模式' : '安静模式'}
            </Badge>
            <Badge variant={settings.soundEnabled ? 'secondary' : 'outline'}>
              {settings.soundEnabled ? '声音开启' : '声音关闭'}
            </Badge>
            <Badge variant={settings.animationEnabled ? 'secondary' : 'outline'}>
              {settings.animationEnabled ? '动画开启' : '动画关闭'}
            </Badge>
          </div>
          <CardTitle className="text-xl">翻卡反馈预览台</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
            这里直接走当前站点正在运行的脑图宿主页反馈链路。先点“一键开启完整预览反馈”，再逐个试听和查看。
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={enablePreviewMode}>
              <WandSparkles className="mr-2 size-4" />
              一键开启完整预览反馈
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => audio.playEvent('card_reveal', { audioScope: 'global' })}
            >
              <Volume2 className="mr-2 size-4" />
              单独试听翻卡音效
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => audio.playComboMilestone(4)}
            >
              <Sparkles className="mr-2 size-4" />
              单独试听里程碑音效
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/95">
        <CardHeader>
          <CardTitle className="text-base">直接触发反馈</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
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
            预览单张翻卡
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
                  milestoneStep: 3,
                  lineMode: 'confirm',
                  depthHint: 2,
                  targetRole: 'placeholder',
                  isBranchCompletion: false,
                },
                'card_reveal',
              )
            }
          >
            预览里程碑翻卡
          </Button>
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
              )
            }
          >
            预览区域攻克
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
              )
            }
          >
            预览全域点亮
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
              )
            }
          >
            预览完成反馈
          </Button>
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
            className="h-[68vh] w-full rounded-lg border border-border/70 bg-background"
          />
        </CardContent>
      </Card>
    </div>
  )
}
