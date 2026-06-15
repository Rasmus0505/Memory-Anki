
import { CompletionDecisionDialog } from '@/features/review/components/CompletionDecisionDialog'
import * as React from 'react'
import { toast } from 'sonner'
import {
  RotateCcw,
  Settings2,
  Sparkles,
  SquareCheckBig,
  Volume2,
  Waves,
} from 'lucide-react'
import {
  BilinkPreviewPopover,
  BilinkSearchPopover,
  useBilinkCounts,
  useBilinkOverlay,
  useBilinks,
} from '@/features/bilink'
import type { MindMapEditorState } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'
import { ReviewFlowMapPanel } from '@/features/review/components/ReviewFlowMapPanel'
import { ReviewMindmapQuizBreakDialog } from '@/features/review/components/ReviewMindmapQuizBreakDialog'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { SessionTimerBar } from '@/shared/components/session/SessionTimerBar'
import {
  useReviewFlowSession,
} from '@/features/review/hooks/useReviewFlowSession'
import type { RevealFlowMode, ReviewFlowSnapshot } from '@/entities/review/model/review-flow-tree'
import type { MindMapSelection } from '@/shared/components/mindmap-host'
import { useMemoryAnkiShortcuts } from '@/features/shortcuts/memoryAnkiShortcuts'
import {
  useVoiceCoachController,
  VoiceCoachSettingsDialog,
} from '@/features/voice-coach'
import {
  MiniPalacePanel,
  useMiniPalaceController,
} from '@/features/mini-palace'
import { appendTimeRecord } from '@/entities/session/model'
import { ComboMilestoneBurst, CompletionCelebration } from '@/shared/components/celebration'
import { getReviewSurpriseCopy, REVIEW_COMBO_MILESTONES } from '@/features/review/model/review-feedback'

export type { ReviewFlowSnapshot } from '@/entities/review/model/review-flow-tree'

const EMPTY_CHECKPOINT_NODE_UIDS: string[] = []

interface CompleteFlowPayload {
  durationSeconds: number
  completionMode: 'manual_complete' | 'auto_complete'
  revealedRemaining: boolean
  redNodeIds: string[]
}

interface MindMapReviewFlowProps {
  title: string
  palaceId: number | null
  sessionKind: 'practice' | 'review'
  revealMode?: RevealFlowMode
  checkpointNodeUids?: string[]
  displayMode?: 'review' | 'edit'
  modeSyncVersion?: number
  viewMemoryScope?: string | null
  persistKey?: string | null
  reviewEditorState: MindMapEditorState
  editEditorState?: MindMapEditorState | null
  onComplete: (payload: CompleteFlowPayload) => void | Promise<void>
  onModeToggle?: () => void | Promise<void>
  onEditEditorStateChange?: (nextState: MindMapEditorState) => void
  onRestart?: () => void
  submitting?: boolean
  editSaving?: boolean
  editError?: string | null
  persistProgress?: boolean
  initialSnapshot?: ReviewFlowSnapshot | null
  focusNodeUids?: string[]
  onSnapshotChange?: (snapshot: ReviewFlowSnapshot) => void
  onFullscreenChange?: (active: boolean) => void
  onToggleFocusNode?: (nodeUid: string) => void | Promise<void>
}

function FeedbackSettingsDialog({
  open,
  onOpenChange,
  mode,
  soundEnabled,
  volume,
  animationEnabled,
  surpriseEnabled,
  globalIntensity,
  onToggleMode,
  onToggleSound,
  onVolumeChange,
  onToggleAnimation,
  onToggleSurprise,
  onCycleGlobalIntensity,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'immersive' | 'quiet'
  soundEnabled: boolean
  volume: number
  animationEnabled: boolean
  surpriseEnabled: boolean
  globalIntensity: 'quiet' | 'balanced' | 'immersive'
  onToggleMode: () => void
  onToggleSound: () => void
  onVolumeChange: (volume: number) => void
  onToggleAnimation: () => void
  onToggleSurprise: () => void
  onCycleGlobalIntensity: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div>
            <DialogTitle>反馈强度</DialogTitle>
            <div className="mt-1 text-sm text-muted-foreground">
              默认是沉浸反馈；觉得太吵时可一键切换到安静模式。
            </div>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>
        <div className="space-y-4 px-6 py-5">
          <button
            type="button"
            onClick={onToggleMode}
            className={cn(
              'flex w-full items-center justify-between rounded-2xl border px-4 py-4 text-left transition-colors',
              mode === 'immersive'
                ? 'border-warning/30 bg-warning/5'
                : 'border-border/70 bg-muted',
            )}
          >
            <div>
              <div className="text-sm font-semibold">
                {mode === 'immersive' ? '沉浸模式已开启' : '安静模式已开启'}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {mode === 'immersive'
                  ? '保留声音、扫光、里程碑惊喜和结算仪式。'
                  : '关闭强刺激，保留核心信息和基础操作流。'}
              </div>
            </div>
            <Badge variant={mode === 'immersive' ? 'default' : 'outline'}>
              {mode === 'immersive' ? '切到安静' : '切到沉浸'}
            </Badge>
          </button>

          <button
            type="button"
            onClick={onCycleGlobalIntensity}
            className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-left"
          >
            <div>
              <div className="text-sm font-medium">全局界面反馈</div>
              <div className="mt-1 text-sm text-muted-foreground">
                普通点击、悬停、打字等通用操作的粒子与声音强度。不影响脑图与复习的反馈。
              </div>
            </div>
            <Badge variant="secondary">
              {globalIntensity === 'immersive' ? '沉浸' : globalIntensity === 'balanced' ? '平衡' : '安静'}
            </Badge>
          </button>

          <div className="grid gap-3">
            <button
              type="button"
              onClick={onToggleSound}
              className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-left"
            >
              <div>
                <div className="text-sm font-medium">声音反馈</div>
                <div className="mt-1 text-sm text-muted-foreground">揭晓、通关和完成会用合成短音提示。</div>
              </div>
              <Badge variant={soundEnabled ? 'secondary' : 'outline'}>
                {soundEnabled ? '开启' : '关闭'}
              </Badge>
            </button>
            <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <Label htmlFor="review-feedback-volume">音量</Label>
                <span className="text-sm font-medium text-muted-foreground">
                  {Math.round(volume * 100)}%
                </span>
              </div>
              <Input
                id="review-feedback-volume"
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={volume}
                onChange={(event) => onVolumeChange(Number(event.currentTarget.value))}
              />
              <div className="mt-2 text-sm text-muted-foreground">
                调高后，揭晓、通关和完成提示会更明显。
              </div>
            </div>
            <button
              type="button"
              onClick={onToggleAnimation}
              className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-left"
            >
              <div>
                <div className="text-sm font-medium">动画反馈</div>
                <div className="mt-1 text-sm text-muted-foreground">包括边框闪光、HUD 弹跳、扫光和结算条幅。</div>
              </div>
              <Badge variant={animationEnabled ? 'secondary' : 'outline'}>
                {animationEnabled ? '开启' : '关闭'}
              </Badge>
            </button>
            <button
              type="button"
              onClick={onToggleSurprise}
              className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-left"
            >
              <div>
                <div className="text-sm font-medium">里程碑惊喜</div>
                <div className="mt-1 text-sm text-muted-foreground">连击到 3、5、8、13 时偶尔给你一句奖励反馈。</div>
              </div>
              <Badge variant={surpriseEnabled ? 'secondary' : 'outline'}>
                {surpriseEnabled ? '开启' : '关闭'}
              </Badge>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function MindMapReviewFlow({
  title,
  palaceId,
  sessionKind,
  revealMode = 'standard',
  checkpointNodeUids = EMPTY_CHECKPOINT_NODE_UIDS,
  displayMode = 'review',
  modeSyncVersion = 0,
  viewMemoryScope = null,
  persistKey = null,
  reviewEditorState,
  editEditorState = null,
  onComplete,
  onModeToggle,
  onEditEditorStateChange,
  onRestart,
  submitting = false,
  editSaving = false,
  editError = null,
  persistProgress = false,
  initialSnapshot = null,
  focusNodeUids: initialFocusNodeUids = [],
  onSnapshotChange,
  onFullscreenChange,
  onToggleFocusNode,
}: MindMapReviewFlowProps) {
  const initialFocusNodeUidsKey = React.useMemo(
    () => JSON.stringify(initialFocusNodeUids.map((uid) => String(uid)).filter(Boolean).sort()),
    [initialFocusNodeUids],
  )
  const [feedbackDialogOpen, setFeedbackDialogOpen] = React.useState(false)
  const [voiceCoachDialogOpen, setVoiceCoachDialogOpen] = React.useState(false)
  const [quizBreakDialogOpen, setQuizBreakDialogOpen] = React.useState(false)
  const [completionDialogOpen, setCompletionDialogOpen] = React.useState(false)
  const [savingIncomplete, setSavingIncomplete] = React.useState(false)
  const [activeNodes, setActiveNodes] = React.useState<MindMapSelection[]>([])
  const [comboBurst, setComboBurst] = React.useState<{
    milestoneStep: number
    comboCount: number
    copy: string
  } | null>(null)
  const prevComboCountRef = React.useRef(0)
  const [focusNodeUids, setFocusNodeUids] = React.useState<string[]>(() =>
    initialFocusNodeUids.map((uid) => String(uid)).filter(Boolean),
  )
  const selectedNode = activeNodes[0] ?? null
  const selectedNodeUid = selectedNode?.uid ? String(selectedNode.uid) : null
  const selectedNodeText = selectedNode?.text ? String(selectedNode.text) : ''
  const flow = useReviewFlowSession({
    title,
    palaceId,
    sessionKind,
    revealMode,
    checkpointNodeUids,
    persistKey,
    editorState: reviewEditorState,
    onComplete,
    onRestart,
    persistProgress,
    initialSnapshot,
    onSnapshotChange,
    onFullscreenChange,
  })
  const inlineEditEnabled =
    typeof onModeToggle === 'function' &&
    typeof onEditEditorStateChange === 'function' &&
    Boolean(editEditorState)
  const miniPalaceSourceEditorState =
    inlineEditEnabled && editEditorState ? editEditorState : reviewEditorState
  const miniPalace = useMiniPalaceController({
    palaceId,
    title,
    editorState: miniPalaceSourceEditorState,
    selectedNodeUid,
    selectedNodeText,
    timer: flow.timer,
  })
  const voiceCoach = useVoiceCoachController({
    scene: sessionKind,
    timer: flow.timer,
    comboCount: flow.feedback.comboCount,
    progressPercent: flow.feedback.progressPercent,
    allClearReady: flow.feedback.allClearReady,
    completed: flow.completed,
  })

  // 连击里程碑视觉庆祝：检测 combo 达到 [3, 5, 8, 13] 时触发爆发动画
  const animationEnabled = flow.feedback.animationEnabled
  React.useEffect(() => {
    if (!animationEnabled) {
      prevComboCountRef.current = flow.feedback.comboCount
      return
    }
    const currentCombo = flow.feedback.comboCount
    const prevCombo = prevComboCountRef.current
    prevComboCountRef.current = currentCombo
    if (currentCombo <= prevCombo) return
    const milestoneIndex = REVIEW_COMBO_MILESTONES.indexOf(currentCombo)
    if (milestoneIndex === -1) return
    setComboBurst({
      milestoneStep: milestoneIndex,
      comboCount: currentCombo,
      copy: getReviewSurpriseCopy(currentCombo),
    })
  }, [flow.feedback.comboCount, animationEnabled])
  const bilinks = useBilinks(palaceId)
  const bilinkCounts = useBilinkCounts(palaceId)
  const bilinkOverlay = useBilinkOverlay({
    currentPalaceId: palaceId,
    allowCreate: false,
  })
  const resolvedDisplayMode =
    inlineEditEnabled && displayMode === 'edit' ? 'edit' : 'review'
  const isInlineEditMode = resolvedDisplayMode === 'edit'
  const isDedicatedMiniMode = revealMode === 'mini-checkpoint'
  const previousDisplayModeRef = React.useRef(resolvedDisplayMode)
  const mapDisplayMode = miniPalace.isActive ? 'review' : resolvedDisplayMode
  const mapEditorState =
    miniPalace.visibleEditorState ??
    (miniPalace.isActive ? miniPalaceSourceEditorState : flow.visibleEditorState)
  const mapVisibleSyncKey = miniPalace.isActive
    ? miniPalace.visibleSyncKey
    : flow.visibleEditorSyncKey

  React.useEffect(() => {
    setFocusNodeUids(JSON.parse(initialFocusNodeUidsKey) as string[])
  }, [initialFocusNodeUidsKey])

  React.useEffect(() => {
    const previousDisplayMode = previousDisplayModeRef.current
    if (previousDisplayMode === resolvedDisplayMode) return
    if (resolvedDisplayMode === 'edit') {
      flow.timer.logEvent('enter_edit_mode', { source: 'review_inline_edit' })
      flow.timer.registerActivity('edit_operation', {
        source: 'review_inline_edit_enter',
      })
    } else {
      flow.timer.logEvent('exit_edit_mode', { source: 'review_inline_edit' })
      flow.timer.registerActivity('practice_interaction', {
        source: 'review_inline_edit_exit',
      })
    }
    previousDisplayModeRef.current = resolvedDisplayMode
  }, [flow.timer, resolvedDisplayMode])

  const handleEditorStateChange = React.useCallback(
    (nextState: MindMapEditorState) => {
      flow.timer.registerActivity('edit_operation', {
        source: 'review_inline_edit',
      })
      onEditEditorStateChange?.(nextState)
    },
    [flow.timer, onEditEditorStateChange],
  )

  const toggleFocusNodeUid = React.useCallback(
    async (nodeUid: string, source: string) => {
      if (!nodeUid) return
      const previousFocusNodeUids = focusNodeUids
      const wasFocused = previousFocusNodeUids.includes(nodeUid)
      const optimisticFocusNodeUids = wasFocused
        ? previousFocusNodeUids.filter((uid) => uid !== nodeUid)
        : [...previousFocusNodeUids, nodeUid]
      setFocusNodeUids(optimisticFocusNodeUids)
      flow.timer.registerActivity('edit_operation', { source })
      try {
        await onToggleFocusNode?.(nodeUid)
      } catch {
        setFocusNodeUids(previousFocusNodeUids)
      }
    },
    [flow.timer, focusNodeUids, onToggleFocusNode],
  )

  const handleEditNodeContextMenu = React.useCallback(
    (nodes: MindMapSelection[]) => {
      if (!isInlineEditMode) return
      const nodeUid = nodes[0]?.uid ? String(nodes[0].uid) : ''
      if (!nodeUid) return
      void toggleFocusNodeUid(nodeUid, 'review_inline_edit_focus_contextmenu')
    },
    [isInlineEditMode, toggleFocusNodeUid],
  )

  const handleShortcutToggleFocusNode = React.useCallback(() => {
    if (!isInlineEditMode) return
    const nodeUid = activeNodes[0]?.uid ? String(activeNodes[0].uid) : ''
    if (!nodeUid) return
    void toggleFocusNodeUid(nodeUid, 'shortcut_toggle_focus_node')
  }, [activeNodes, isInlineEditMode, toggleFocusNodeUid])

  const handleShortcutHideChildCards = React.useCallback(() => {
    if (isInlineEditMode) return
    if (miniPalace.isPracticing) return
    const node = activeNodes[0]
    if (!node?.uid) return
    flow.handleNodeContextMenu([node])
  }, [activeNodes, flow, isInlineEditMode, miniPalace.isPracticing])

  const shortcutHandlers = React.useMemo(
    () => ({
      toggle_focus_node: handleShortcutToggleFocusNode,
      hide_child_cards_review: handleShortcutHideChildCards,
    }),
    [handleShortcutHideChildCards, handleShortcutToggleFocusNode],
  )

  useMemoryAnkiShortcuts(
    isInlineEditMode ? 'edit' : 'review',
    shortcutHandlers,
    true,
  )

  const handleSpacePourRef = React.useRef(miniPalace.handleSpacePour)
  handleSpacePourRef.current = miniPalace.isPracticing
    ? miniPalace.handleSpacePour
    : flow.handleSpacePour

  // Fallback: primary space handling is in mind-map-host.html (iframe) which sends node_click to React.
  // This listener only fires when the top window has focus (rare during practice mode).
  React.useEffect(() => {
    if (!miniPalace.isPracticing && !isDedicatedMiniMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === ' ' || event.code === 'Space') {
        const target = event.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
        event.preventDefault()
        event.stopPropagation()
        handleSpacePourRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [flow.handleSpacePour, isDedicatedMiniMode, miniPalace.isPracticing])

  const handleFullscreenToggle = React.useCallback((active?: boolean) => {
    if (typeof active === 'boolean') {
      flow.setFullscreen(active)
      return
    }
    flow.setFullscreen((current: boolean) => !current)
  }, [flow])

  const handleMarkUncompleted = React.useCallback(async () => {
    if (savingIncomplete) return
    setCompletionDialogOpen(false)
    setSavingIncomplete(true)
    try {
      flow.timer.registerActivity('practice_interaction', { source: 'complete_unfinished' })
      const record = await flow.timer.complete('saved', {
        revealed_remaining: false,
        red_marked_count: flow.redNodeCount,
      })
      if (record && sessionKind === 'review') {
        await appendTimeRecord(record)
      }
      toast.success('已保存进度和本段时长，下次可继续')
    } catch {
      toast.error('进度已保留，但本段时长保存失败，请稍后重试')
    } finally {
      flow.timer.reset()
      setSavingIncomplete(false)
    }
  }, [flow.redNodeCount, flow.timer, savingIncomplete, sessionKind])

  const progressToneClassName =
    flow.feedback.progressTone === 'all-clear'
      ? 'memory-anki-review-progress-all-clear'
      : flow.feedback.progressTone === 'surge'
        ? 'memory-anki-review-progress-surge'
        : flow.feedback.progressTone === 'warmup'
          ? 'memory-anki-review-progress-warmup'
          : 'memory-anki-review-progress-calm'
  const completeButtonClassName = cn(
    flow.feedback.allClearReady &&
      !flow.feedback.completionCeremonyActive &&
      'memory-anki-review-complete-ready border-warning bg-warning text-white hover:bg-warning',
  )
  const cardFlashClassName =
    flow.feedback.animationEnabled && flow.feedback.feedbackFlashState !== 'idle'
      ? `memory-anki-review-card-flash memory-anki-review-card-flash-${flow.feedback.feedbackFlashState}`
      : ''

  return (
    <div className={cn('space-y-5', flow.screenGlowClass)}>
      {/* 连击里程碑视觉庆祝 overlay */}
      {comboBurst ? (
        <ComboMilestoneBurst
          milestoneStep={comboBurst.milestoneStep}
          comboCount={comboBurst.comboCount}
          copy={comboBurst.copy}
          onComplete={() => setComboBurst(null)}
        />
      ) : null}

      {/* 复习完成庆祝 overlay */}
      {flow.feedback.completionCeremonyActive && flow.feedback.animationEnabled ? (
        <CompletionCelebration
          maxCombo={flow.feedback.maxComboCount}
          completedNodes={flow.visibleNonRootCount}
          totalNodes={Math.max(flow.totalNodeCount - 1, 0)}
        />
      ) : null}

      <div
        className={cn(
          'grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]',
          flow.fullscreen && 'grid-cols-1',
        )}
      >
        <div className={cn('space-y-4', flow.fullscreen && 'hidden')}>
          <SessionTimerBar
            effectiveSeconds={flow.timer.effectiveSeconds}
            idleSeconds={flow.timer.idleSeconds}
            automationScene={sessionKind === 'review' ? 'review' : 'practice'}
            pauseCount={flow.timer.pauseCount}
            status={flow.timer.status}
            onStart={() => flow.timer.start({ source: 'manual' })}
            onPause={() => flow.timer.pause({ source: 'manual' })}
            onResume={() => flow.timer.resume({ source: 'manual' })}
            onAdjustDuration={flow.timer.adjustDuration}
            showCompleteAction={false}
            showRestartAction={false}
            className="sticky top-5 z-20"
          />
        </div>

        <div className={cn('space-y-4', flow.fullscreen && 'space-y-0')}>
          <Card
            className={cn(
              'relative min-h-[74vh] overflow-hidden border-border/70 bg-card/92',
              cardFlashClassName,
              flow.fullscreen &&
                'fixed inset-x-5 bottom-5 top-5 z-[90] min-h-0 bg-card/96 shadow-2xl',
            )}
          >
            {flow.feedback.completionCeremonyActive ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[100] flex justify-center px-4 pt-4">
                <div className="memory-anki-review-completion-banner inline-flex items-center gap-2 rounded-full border border-warning/30 bg-warning/10 px-4 py-2 text-sm font-semibold text-warning shadow-lg">
                  <Sparkles className="h-4 w-4" />
                  通关结算中
                </div>
              </div>
            ) : null}
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">
                    {sessionKind === 'practice' ? '练习脑图' : '复习脑图'}
                  </CardTitle>
                  {!inlineEditEnabled && !isInlineEditMode ? (
                    <Badge variant="secondary">翻卡模式</Badge>
                  ) : null}
                  <Badge variant="outline">
                    已出现 {flow.visibleNonRootCount} / {Math.max(flow.totalNodeCount - 1, 0)}
                  </Badge>
                  {flow.redNodeCount > 0 ? (
                    <Badge variant="outline">红标 {flow.redNodeCount}</Badge>
                  ) : null}
                  {flow.completed ? (
                    <Badge className="bg-success text-white hover:bg-success">
                      本次已完成
                    </Badge>
                  ) : null}
                </div>

                {!isInlineEditMode ? (
                  <div className="rounded-3xl border border-border/70 bg-card/90 px-4 py-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <div
                          className={cn(
                            'memory-anki-review-combo-badge inline-flex min-w-[108px] items-center justify-center rounded-2xl border px-3 py-2 text-sm font-semibold',
                            flow.feedback.animationEnabled &&
                              flow.feedback.feedbackFlashState === 'card_reveal' &&
                              'memory-anki-review-combo-badge-pop',
                          )}
                        >
                          连击 {flow.feedback.comboCount}
                        </div>
                        <Badge variant="outline">最高 {flow.feedback.maxComboCount}</Badge>
                        <Badge variant="outline">
                          {flow.feedback.nextMilestone == null
                            ? '已越过全部里程碑'
                            : `下一里程碑 ${flow.feedback.nextMilestone}`}
                        </Badge>
                        {flow.feedback.allClearReady ? (
                          <Badge className="bg-warning text-white hover:bg-warning">
                            可结算
                          </Badge>
                        ) : null}
                        {flow.feedback.surpriseText ? (
                          <Badge className="max-w-full bg-success text-white hover:bg-success">
                            {flow.feedback.surpriseText}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={flow.feedback.settings.mode === 'immersive' ? 'secondary' : 'outline'}>
                          {flow.feedback.settings.mode === 'immersive' ? '沉浸反馈' : '安静模式'}
                        </Badge>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={flow.feedback.toggleMode}
                        >
                          <Waves className="mr-2 h-4 w-4" />
                          {flow.feedback.settings.mode === 'immersive' ? '一键降噪' : '恢复沉浸'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setFeedbackDialogOpen(true)}
                        >
                          <Settings2 className="mr-2 h-4 w-4" />
                          反馈设置
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setVoiceCoachDialogOpen(true)}
                        >
                          <Volume2 className="mr-2 h-4 w-4" />
                          {voiceCoach.enabled ? '语音教练' : '开启语音'}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="h-2.5 overflow-hidden rounded-full bg-border">
                        <div
                          className={cn(
                            'h-full rounded-full transition-[width,background] duration-300',
                            progressToneClassName,
                          )}
                          style={{ width: `${flow.feedback.progressPercent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onRestart && !isInlineEditMode ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={miniPalace.isActive}
                    onClick={flow.handleRestart}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    重新开始
                  </Button>
                ) : null}
                {isInlineEditMode && editSaving ? (
                  <Badge variant="secondary">自动保存中</Badge>
                ) : null}
                {isInlineEditMode && editError ? (
                  <Badge variant="destructive">保存异常</Badge>
                ) : null}
                {!isInlineEditMode ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={submitting || flow.feedback.completionCeremonyActive || miniPalace.isActive}
                    className={completeButtonClassName}
                    onClick={() => setCompletionDialogOpen(true)}
                  >
                    <SquareCheckBig className="mr-2 h-4 w-4" />
                    {flow.feedback.allClearReady ? '完成结算' : '完成'}
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent
              className={cn(
                'min-h-[64vh]',
                flow.fullscreen && 'h-[calc(100vh-108px)] min-h-0',
              )}
            >
              <div className="h-full min-h-0">
                <ReviewFlowMapPanel
                  fullscreen={flow.fullscreen}
                  displayMode={mapDisplayMode}
                  modeSyncVersion={modeSyncVersion}
                  viewMemoryScope={viewMemoryScope}
                  onToggleFullscreen={handleFullscreenToggle}
                  onToggleMode={
                    inlineEditEnabled && onModeToggle && !miniPalace.isActive
                      ? () => {
                          void onModeToggle()
                        }
                      : undefined
                  }
                  visibleEditorState={mapEditorState ?? flow.visibleEditorState}
                  editableEditorState={editEditorState}
                  visibleEditorSyncKey={mapVisibleSyncKey}
                  bilinkCounts={bilinkCounts.counts}
                  bilinkItems={bilinks.items}
                  currentPalaceId={palaceId}
                  focusNodeUids={focusNodeUids}
                  bilinkInsertionText={bilinkOverlay.bilinkInsertionText}
                  bilinkInsertionNonce={bilinkOverlay.bilinkInsertionNonce}
                  reviewFxSignal={flow.feedback.reviewFxSignal}
                  showMiniPalaceButton={Boolean(palaceId)}
                  miniPalaceDraft={miniPalace.hostDraft}
                  miniPalacePracticeActive={miniPalace.isPracticing || isDedicatedMiniMode}
                  onEditorStateChange={handleEditorStateChange}
                  onNodeActive={setActiveNodes}
                  onNodeClick={miniPalace.isActive ? miniPalace.handleNodeClick : flow.handleNodeClick}
                  onNodeContextMenu={
                    miniPalace.isActive ? miniPalace.handleNodeContextMenu : flow.handleNodeContextMenu
                  }
                  onNodeHover={
                    miniPalace.isPracticing
                      ? miniPalace.handleNodeHover
                      : isDedicatedMiniMode
                        ? flow.handleNodeHover
                        : undefined
                  }
                  onEditNodeContextMenu={handleEditNodeContextMenu}
                  onBilinkTrigger={bilinkOverlay.handleBilinkTrigger}
                  onBilinkNodeClick={bilinkOverlay.handleBilinkNodeClick}
                  onBilinkToolbarSearch={() =>
                    bilinkOverlay.openBilinkSearch({
                      mode: 'toolbar',
                      position: null,
                    })
                  }
                  onQuizBreakOpen={() => {
                    flow.timer.registerActivity('practice_interaction', {
                      source: 'quiz_break_open',
                    })
                    setQuizBreakDialogOpen(true)
                  }}
                  onMiniPalaceOpen={miniPalace.openPanel}
                  onMiniPalacePour={miniPalace.isPracticing ? miniPalace.handleSpacePour : flow.handleSpacePour}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <BilinkSearchPopover
        open={bilinkOverlay.bilinkSearchOpen}
        mode={bilinkOverlay.bilinkSearchMode}
        position={bilinkOverlay.bilinkSearchPosition}
        query={bilinkOverlay.bilinkSearchQuery}
        loading={bilinkOverlay.bilinkSearchLoading}
        error={bilinkOverlay.bilinkSearchError}
        results={bilinkOverlay.bilinkSearchResults}
        onQueryChange={bilinkOverlay.setBilinkSearchQuery}
        onClose={bilinkOverlay.closeBilinkSearch}
        onSelect={bilinkOverlay.handleBilinkSearchSelect}
        onPreview={bilinkOverlay.handleBilinkResultPreview}
      />

      <BilinkPreviewPopover
        open={bilinkOverlay.bilinkPreviewOpen}
        loading={bilinkOverlay.bilinkPreviewLoading}
        error={bilinkOverlay.bilinkPreviewError}
        context={bilinkOverlay.bilinkPreviewContext}
        editorState={bilinkOverlay.bilinkPreviewEditorState}
        highlightQuery={bilinkOverlay.bilinkPreviewHighlightQuery}
        onClose={() => bilinkOverlay.setBilinkPreviewOpen(false)}
        onJump={bilinkOverlay.jumpToBilinkContext}
      />

      <FeedbackSettingsDialog
        open={feedbackDialogOpen}
        onOpenChange={setFeedbackDialogOpen}
        mode={flow.feedback.settings.mode}
        soundEnabled={flow.feedback.settings.soundEnabled}
        volume={flow.feedback.settings.volume}
        animationEnabled={flow.feedback.settings.animationEnabled}
        surpriseEnabled={flow.feedback.settings.surpriseEnabled}
        globalIntensity={flow.feedback.settings.globalIntensity}
        onToggleMode={flow.feedback.toggleMode}
        onToggleSound={() =>
          flow.feedback.updateSettings((current) => ({
            ...current,
            soundEnabled: !current.soundEnabled,
          }))
        }
        onVolumeChange={(volume) =>
          flow.feedback.updateSettings((current) => ({
            ...current,
            volume,
          }))
        }
        onToggleAnimation={() =>
          flow.feedback.updateSettings((current) => ({
            ...current,
            animationEnabled: !current.animationEnabled,
          }))
        }
        onToggleSurprise={() =>
          flow.feedback.updateSettings((current) => ({
            ...current,
            surpriseEnabled: !current.surpriseEnabled,
          }))
        }
        onCycleGlobalIntensity={() =>
          flow.feedback.updateSettings((current) => ({
            ...current,
            globalIntensity:
              current.globalIntensity === 'balanced'
                ? 'immersive'
                : current.globalIntensity === 'immersive'
                  ? 'quiet'
                  : 'balanced',
          }))
        }
      />

      <VoiceCoachSettingsDialog
        open={voiceCoachDialogOpen}
        onOpenChange={setVoiceCoachDialogOpen}
        onTest={voiceCoach.playTestEvent}
      />

      <ReviewMindmapQuizBreakDialog
        open={quizBreakDialogOpen}
        onOpenChange={setQuizBreakDialogOpen}
        palaceId={palaceId}
        reviewEditorDoc={reviewEditorState.editor_doc}
      />

      <CompletionDecisionDialog
        open={completionDialogOpen}
        onOpenChange={setCompletionDialogOpen}
        durationSeconds={Math.max(1, flow.timer.effectiveSeconds)}
        onMarkCompleted={() => {
          setCompletionDialogOpen(false)
          void flow.finishFlow('manual_complete')
        }}
        onMarkUncompleted={() => {
          void handleMarkUncompleted()
        }}
        submitting={submitting || savingIncomplete}
      />

      <MiniPalacePanel controller={miniPalace} />
    </div>
  )
}
