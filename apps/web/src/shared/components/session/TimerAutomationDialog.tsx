import * as React from 'react'
import { RotateCcw, Save, Settings2 } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'
import type {
  TimerAutomationActivityConfig,
  TimerAutomationConfig,
  TimerAutomationMode,
  TimerAutomationRule,
  TimerAutomationScene,
} from '@/shared/components/session/timer-automation-config'
import {
  DEFAULT_TIMER_AUTOMATION_CONFIG,
  TIMER_AUTOMATION_SCENE_LABELS,
  sanitizeTimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import type {
  TimerFeedbackIntensity,
  TimerFocusConfig,
  TimerFocusMode,
  TimerFocusRule,
  TimerFocusScene,
} from '@/shared/components/session/timer-focus-config'
import {
  DEFAULT_TIMER_FOCUS_CONFIG,
  getTimerFocusRule,
  resetTimerFocusConfig,
  saveTimerFocusConfig,
  sanitizeTimerFocusConfig,
  TIMER_FOCUS_SCENE_LABELS,
} from '@/shared/components/session/timer-focus-config'

interface TimerAutomationDialogProps {
  open: boolean
  config: TimerAutomationConfig
  onOpenChange: (open: boolean) => void
  onSave: (config: TimerAutomationConfig) => void
  onReset: () => void
  focusConfig?: TimerFocusConfig
  onFocusConfigSave?: (config: TimerFocusConfig) => void
}

type FieldKey = keyof TimerAutomationRule
type ActionFieldKey = keyof TimerAutomationActivityConfig
type FocusFieldKey = keyof TimerFocusRule

function toDraft(config: TimerAutomationConfig) {
  return {
    mode: config.mode,
    actions: {
      autoResumeOnWindowReturn: config.actions.autoResumeOnWindowReturn,
      countNodeSwitchAsActivity: config.actions.countNodeSwitchAsActivity,
      countEditOperationsAsActivity: config.actions.countEditOperationsAsActivity,
      countPracticeInteractionsAsActivity: config.actions.countPracticeInteractionsAsActivity,
    },
    shared: {
      autoStartOnPageEnter: config.shared.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.shared.inactiveAutoPauseSeconds),
      hiddenAutoPauseSeconds: String(config.shared.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.shared.autoPauseRollbackSeconds),
    },
    palace_edit: {
      autoStartOnPageEnter: config.palace_edit.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.palace_edit.inactiveAutoPauseSeconds),
      hiddenAutoPauseSeconds: String(config.palace_edit.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.palace_edit.autoPauseRollbackSeconds),
    },
    practice: {
      autoStartOnPageEnter: config.practice.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.practice.inactiveAutoPauseSeconds),
      hiddenAutoPauseSeconds: String(config.practice.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.practice.autoPauseRollbackSeconds),
    },
    quiz: {
      autoStartOnPageEnter: config.quiz.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.quiz.inactiveAutoPauseSeconds),
      hiddenAutoPauseSeconds: String(config.quiz.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.quiz.autoPauseRollbackSeconds),
    },
    review: {
      autoStartOnPageEnter: config.review.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.review.inactiveAutoPauseSeconds),
      hiddenAutoPauseSeconds: String(config.review.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.review.autoPauseRollbackSeconds),
    },
    english: {
      autoStartOnPageEnter: config.english.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.english.inactiveAutoPauseSeconds),
      hiddenAutoPauseSeconds: String(config.english.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.english.autoPauseRollbackSeconds),
    },
    english_reading: {
      autoStartOnPageEnter: config.english_reading.autoStartOnPageEnter,
      inactiveAutoPauseSeconds: String(config.english_reading.inactiveAutoPauseSeconds),
      hiddenAutoPauseSeconds: String(config.english_reading.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.english_reading.autoPauseRollbackSeconds),
    },
  }
}

function toFocusDraft(config: TimerFocusConfig) {
  return {
    mode: config.mode,
    feedbackIntensity: config.feedbackIntensity,
    celebration: {
      secondaryInterval: { ...config.celebration.secondaryInterval },
      primaryGoal: { ...config.celebration.primaryGoal },
    },
    global: {
      primaryMinutes: String(config.global.primaryMinutes),
      secondaryMinutes: String(config.global.secondaryMinutes),
    },
    palace_edit: {
      primaryMinutes: String(config.palace_edit.primaryMinutes),
      secondaryMinutes: String(config.palace_edit.secondaryMinutes),
    },
    practice: {
      primaryMinutes: String(config.practice.primaryMinutes),
      secondaryMinutes: String(config.practice.secondaryMinutes),
    },
    quiz: {
      primaryMinutes: String(config.quiz.primaryMinutes),
      secondaryMinutes: String(config.quiz.secondaryMinutes),
    },
    review: {
      primaryMinutes: String(config.review.primaryMinutes),
      secondaryMinutes: String(config.review.secondaryMinutes),
    },
    english: {
      primaryMinutes: String(config.english.primaryMinutes),
      secondaryMinutes: String(config.english.secondaryMinutes),
    },
    english_reading: {
      primaryMinutes: String(config.english_reading.primaryMinutes),
      secondaryMinutes: String(config.english_reading.secondaryMinutes),
    },
  }
}

function RuleEditor({
  label,
  description,
  value,
  onFieldChange,
  onAutoStartChange,
  defaults,
  compact = false,
}: {
  label: string
  description: string
  value: {
    autoStartOnPageEnter: boolean
    inactiveAutoPauseSeconds: string
    hiddenAutoPauseSeconds: string
    autoPauseRollbackSeconds: string
  }
  onFieldChange: (field: FieldKey, value: string) => void
  onAutoStartChange: (checked: boolean) => void
  defaults: TimerAutomationRule
  compact?: boolean
}) {
  return (
    <div className={cn('rounded-2xl border border-border/70 bg-card/70', compact ? 'p-3.5' : 'p-4')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-foreground">{label}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        </div>
        <label className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-xs">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={value.autoStartOnPageEnter}
            onChange={(event) => onAutoStartChange(event.target.checked)}
          />
          <span>{`${label}进入页面自动开始`}</span>
        </label>
      </div>

      <div className={cn('mt-3 grid gap-3', compact ? 'md:grid-cols-3' : 'lg:grid-cols-3')}>
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">无操作自动暂停（秒）</span>
          <Input
            inputMode="numeric"
            value={value.inactiveAutoPauseSeconds}
            onChange={(event) => onFieldChange('inactiveAutoPauseSeconds', event.target.value)}
          />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">后台/失焦自动暂停（秒）</span>
          <Input
            inputMode="numeric"
            value={value.hiddenAutoPauseSeconds}
            onChange={(event) => onFieldChange('hiddenAutoPauseSeconds', event.target.value)}
          />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">自动暂停回退时长（秒）</span>
          <Input
            inputMode="numeric"
            value={value.autoPauseRollbackSeconds}
            onChange={(event) => onFieldChange('autoPauseRollbackSeconds', event.target.value)}
          />
        </label>
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        默认值：
        {` 自动开始 ${defaults.autoStartOnPageEnter ? '开' : '关'}，无操作 ${defaults.inactiveAutoPauseSeconds}s，后台 ${defaults.hiddenAutoPauseSeconds}s，回退 ${defaults.autoPauseRollbackSeconds}s`}
      </div>
    </div>
  )
}

function FocusRuleEditor({
  label,
  value,
  defaults,
  onFieldChange,
  compact = false,
}: {
  label: string
  value: {
    primaryMinutes: string
    secondaryMinutes: string
  }
  defaults: TimerFocusRule
  onFieldChange: (field: FocusFieldKey, value: string) => void
  compact?: boolean
}) {
  return (
    <div className={cn('rounded-2xl border border-border/70 bg-card/70', compact ? 'p-3.5' : 'p-4')}>
      <div className="text-sm font-semibold text-foreground">{label}</div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        一级总目标决定整段冲刺长度，二级子间隔决定大数字倒计时和爽感反馈节奏。
      </p>
      <div className={cn('mt-3 grid gap-3', compact ? 'md:grid-cols-2' : 'lg:grid-cols-2')}>
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">一级目标（分钟）</span>
          <Input
            inputMode="numeric"
            value={value.primaryMinutes}
            onChange={(event) => onFieldChange('primaryMinutes', event.target.value)}
          />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="text-xs text-muted-foreground">二级子间隔（分钟）</span>
          <Input
            inputMode="numeric"
            value={value.secondaryMinutes}
            onChange={(event) => onFieldChange('secondaryMinutes', event.target.value)}
          />
        </label>
      </div>
      <div className="mt-3 text-xs text-muted-foreground">
        默认值：
        {` 一级 ${defaults.primaryMinutes} 分钟，二级 ${Math.min(defaults.primaryMinutes, defaults.secondaryMinutes)} 分钟`}
      </div>
    </div>
  )
}

export function TimerAutomationDialog({
  open,
  config,
  onOpenChange,
  onSave,
  onReset,
  focusConfig = DEFAULT_TIMER_FOCUS_CONFIG,
  onFocusConfigSave,
}: TimerAutomationDialogProps) {
  const [draft, setDraft] = React.useState(() => toDraft(config))
  const [focusDraft, setFocusDraft] = React.useState(() => toFocusDraft(focusConfig))

  React.useEffect(() => {
    if (!open) return
    setDraft(toDraft(config))
    setFocusDraft(toFocusDraft(focusConfig))
  }, [config, focusConfig, open])

  const handleModeChange = React.useCallback((mode: TimerAutomationMode) => {
    setDraft((current) => ({ ...current, mode }))
  }, [])

  const handleFieldChange = React.useCallback(
    (scene: 'shared' | TimerAutomationScene, field: FieldKey, value: string) => {
      setDraft((current) => ({
        ...current,
        [scene]: {
          ...current[scene],
          [field]: value,
        },
      }))
    },
    [],
  )

  const handleAutoStartChange = React.useCallback(
    (scene: 'shared' | TimerAutomationScene, checked: boolean) => {
      setDraft((current) => ({
        ...current,
        [scene]: {
          ...current[scene],
          autoStartOnPageEnter: checked,
        },
      }))
    },
    [],
  )

  const handleActionChange = React.useCallback((field: ActionFieldKey, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      actions: {
        ...current.actions,
        [field]: checked,
      },
    }))
  }, [])

  const handleFocusModeChange = React.useCallback((mode: TimerFocusMode) => {
    setFocusDraft((current) => ({ ...current, mode }))
  }, [])

  const handleFocusFieldChange = React.useCallback(
    (scene: 'global' | TimerFocusScene, field: FocusFieldKey, value: string) => {
      setFocusDraft((current) => ({
        ...current,
        [scene]: {
          ...current[scene],
          [field]: value,
        },
      }))
    },
    [],
  )

  const handleFeedbackIntensityChange = React.useCallback((value: TimerFeedbackIntensity) => {
    setFocusDraft((current) => ({
      ...current,
      feedbackIntensity: value,
    }))
  }, [])

  const parsedConfig = React.useMemo(
    () =>
      sanitizeTimerAutomationConfig({
        mode: draft.mode,
        actions: {
          autoResumeOnWindowReturn: draft.actions.autoResumeOnWindowReturn,
          countNodeSwitchAsActivity: draft.actions.countNodeSwitchAsActivity,
          countEditOperationsAsActivity: draft.actions.countEditOperationsAsActivity,
          countPracticeInteractionsAsActivity: draft.actions.countPracticeInteractionsAsActivity,
        },
        shared: {
          autoStartOnPageEnter: draft.shared.autoStartOnPageEnter,
          inactiveAutoPauseSeconds: draft.shared.inactiveAutoPauseSeconds,
          hiddenAutoPauseSeconds: draft.shared.hiddenAutoPauseSeconds,
          autoPauseRollbackSeconds: draft.shared.autoPauseRollbackSeconds,
        },
        palace_edit: {
          autoStartOnPageEnter: draft.palace_edit.autoStartOnPageEnter,
          inactiveAutoPauseSeconds: draft.palace_edit.inactiveAutoPauseSeconds,
          hiddenAutoPauseSeconds: draft.palace_edit.hiddenAutoPauseSeconds,
          autoPauseRollbackSeconds: draft.palace_edit.autoPauseRollbackSeconds,
        },
        practice: {
          autoStartOnPageEnter: draft.practice.autoStartOnPageEnter,
          inactiveAutoPauseSeconds: draft.practice.inactiveAutoPauseSeconds,
          hiddenAutoPauseSeconds: draft.practice.hiddenAutoPauseSeconds,
          autoPauseRollbackSeconds: draft.practice.autoPauseRollbackSeconds,
        },
        quiz: {
          autoStartOnPageEnter: draft.quiz.autoStartOnPageEnter,
          inactiveAutoPauseSeconds: draft.quiz.inactiveAutoPauseSeconds,
          hiddenAutoPauseSeconds: draft.quiz.hiddenAutoPauseSeconds,
          autoPauseRollbackSeconds: draft.quiz.autoPauseRollbackSeconds,
        },
        review: {
          autoStartOnPageEnter: draft.review.autoStartOnPageEnter,
          inactiveAutoPauseSeconds: draft.review.inactiveAutoPauseSeconds,
          hiddenAutoPauseSeconds: draft.review.hiddenAutoPauseSeconds,
          autoPauseRollbackSeconds: draft.review.autoPauseRollbackSeconds,
        },
        english: {
          autoStartOnPageEnter: draft.english.autoStartOnPageEnter,
          inactiveAutoPauseSeconds: draft.english.inactiveAutoPauseSeconds,
          hiddenAutoPauseSeconds: draft.english.hiddenAutoPauseSeconds,
          autoPauseRollbackSeconds: draft.english.autoPauseRollbackSeconds,
        },
        english_reading: {
          autoStartOnPageEnter: draft.english_reading.autoStartOnPageEnter,
          inactiveAutoPauseSeconds: draft.english_reading.inactiveAutoPauseSeconds,
          hiddenAutoPauseSeconds: draft.english_reading.hiddenAutoPauseSeconds,
          autoPauseRollbackSeconds: draft.english_reading.autoPauseRollbackSeconds,
        },
      }),
    [draft],
  )

  const parsedFocusConfig = React.useMemo(
    () =>
      sanitizeTimerFocusConfig({
        mode: focusDraft.mode,
        feedbackIntensity: focusDraft.feedbackIntensity,
        celebration: focusDraft.celebration,
        global: {
          primaryMinutes: focusDraft.global.primaryMinutes,
          secondaryMinutes: focusDraft.global.secondaryMinutes,
        },
        palace_edit: {
          primaryMinutes: focusDraft.palace_edit.primaryMinutes,
          secondaryMinutes: focusDraft.palace_edit.secondaryMinutes,
        },
        practice: {
          primaryMinutes: focusDraft.practice.primaryMinutes,
          secondaryMinutes: focusDraft.practice.secondaryMinutes,
        },
        quiz: {
          primaryMinutes: focusDraft.quiz.primaryMinutes,
          secondaryMinutes: focusDraft.quiz.secondaryMinutes,
        },
        review: {
          primaryMinutes: focusDraft.review.primaryMinutes,
          secondaryMinutes: focusDraft.review.secondaryMinutes,
        },
        english: {
          primaryMinutes: focusDraft.english.primaryMinutes,
          secondaryMinutes: focusDraft.english.secondaryMinutes,
        },
        english_reading: {
          primaryMinutes: focusDraft.english_reading.primaryMinutes,
          secondaryMinutes: focusDraft.english_reading.secondaryMinutes,
        },
      }),
    [focusDraft],
  )

  const scenes = Object.keys(TIMER_AUTOMATION_SCENE_LABELS) as TimerAutomationScene[]
  const sceneRuleEditors = scenes.map((scene) =>
    React.createElement(RuleEditor, {
      key: scene,
      label: TIMER_AUTOMATION_SCENE_LABELS[scene],
      description: `${TIMER_AUTOMATION_SCENE_LABELS[scene]}页面的专属自动化规则。`,
      value: draft[scene],
      onFieldChange: (field: FieldKey, value: string) => handleFieldChange(scene, field, value),
      onAutoStartChange: (checked: boolean) => handleAutoStartChange(scene, checked),
      defaults: DEFAULT_TIMER_AUTOMATION_CONFIG[scene],
      compact: true,
    }),
  )
  const focusScenes = Object.keys(TIMER_FOCUS_SCENE_LABELS) as TimerFocusScene[]
  const focusRuleEditors = focusScenes.map((scene) => (
    <FocusRuleEditor
      key={scene}
      label={TIMER_FOCUS_SCENE_LABELS[scene]}
      value={focusDraft[scene]}
      defaults={DEFAULT_TIMER_FOCUS_CONFIG[scene]}
      onFieldChange={(field, value) => handleFocusFieldChange(scene, field, value)}
      compact
    />
  ))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(88vh,820px)] w-[min(1100px,calc(100vw-24px))] max-w-[1100px] flex-col overflow-hidden rounded-[28px] border-border/70 bg-background/98 p-0">
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-secondary text-foreground">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>自动化配置</DialogTitle>
              <DialogDescription className="mt-1">
                配置哪些动作算活动，并决定各场景何时自动暂停、双层目标和反馈强度。
              </DialogDescription>
            </div>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div
          data-testid="timer-automation-dialog-content"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
        >
          <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">配置模式</div>
                <p className="mt-1 text-xs text-muted-foreground">全局模式共用一套阈值，单独模式则为每个场景分别配置。</p>
              </div>
              <div className="inline-flex rounded-full border border-border/70 bg-background/80 p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={draft.mode === 'global' ? 'default' : 'ghost'}
                  className="rounded-full px-4"
                  onClick={() => handleModeChange('global')}
                >
                  全局配置
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={draft.mode === 'scene' ? 'default' : 'ghost'}
                  className="rounded-full px-4"
                  onClick={() => handleModeChange('scene')}
                >
                  单独配置
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={draft.actions.autoResumeOnWindowReturn}
                  onChange={(event) => handleActionChange('autoResumeOnWindowReturn', event.target.checked)}
                />
                <span>
                  <span className="block font-medium text-foreground">切回窗口自动恢复</span>
                  <span className="text-xs text-muted-foreground">页面重新可见或窗口重新聚焦时，是否自动恢复计时。</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={draft.actions.countNodeSwitchAsActivity}
                  onChange={(event) => handleActionChange('countNodeSwitchAsActivity', event.target.checked)}
                />
                <span>
                  <span className="block font-medium text-foreground">节点切换算活动</span>
                  <span className="text-xs text-muted-foreground">把脑图节点激活、焦点切换等弱信号记为活动。</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={draft.actions.countEditOperationsAsActivity}
                  onChange={(event) => handleActionChange('countEditOperationsAsActivity', event.target.checked)}
                />
                <span>
                  <span className="block font-medium text-foreground">实际编辑动作算活动</span>
                  <span className="text-xs text-muted-foreground">包括脑图编辑、标题修改、附件与分块操作等。</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={draft.actions.countPracticeInteractionsAsActivity}
                  onChange={(event) => handleActionChange('countPracticeInteractionsAsActivity', event.target.checked)}
                />
                <span>
                  <span className="block font-medium text-foreground">练习交互算活动</span>
                  <span className="text-xs text-muted-foreground">包括翻卡、重开、页内练习切换和正式练习交互。</span>
                </span>
              </label>
            </div>
          </div>

          {draft.mode === 'global' ? (
            <RuleEditor
              label="全局阈值"
              description="这套设置会统一应用到宫殿编辑、练习、复习、英语听力和英语阅读。"
              value={draft.shared}
              onFieldChange={(field, value) => handleFieldChange('shared', field, value)}
              onAutoStartChange={(checked) => handleAutoStartChange('shared', checked)}
              defaults={DEFAULT_TIMER_AUTOMATION_CONFIG.shared}
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {sceneRuleEditors}
            </div>
          )}

          <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">专注目标配置</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  大数字永远显示二级子间隔倒计时；一级总目标只用作下方进度和总冲刺反馈。
                </p>
              </div>
              <div className="inline-flex rounded-full border border-border/70 bg-background/80 p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={focusDraft.mode === 'global' ? 'default' : 'ghost'}
                  className="rounded-full px-4"
                  onClick={() => handleFocusModeChange('global')}
                >
                  全局目标
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={focusDraft.mode === 'scene' ? 'default' : 'ghost'}
                  className="rounded-full px-4"
                  onClick={() => handleFocusModeChange('scene')}
                >
                  单独目标
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {([
                ['cinematic', '冲顶庆典', '默认给最完整的烟花、闪屏和音效，并随累计次数继续增强。'],['celebration', '强而可控', '保留强反馈，但整体喷发量和音量会略微收敛。'],['balanced', '稳态激励', '保留明显奖励感，但更适合长期专注。'],
              ] as const).map(([value, title, description]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => handleFeedbackIntensityChange(value)}
                  className={cn(
                    'rounded-2xl border px-4 py-4 text-left transition-all',
                    focusDraft.feedbackIntensity === value
                      ? 'border-primary bg-primary/8 shadow-sm ring-1 ring-primary/30'
                      : 'border-border/70 bg-background/70 hover:bg-secondary/70',
                  )}
                >
                  <div className="text-sm font-semibold">{title}</div>
                  <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
                </button>
              ))}
            </div>

            <div className="mt-4">
              {focusDraft.mode === 'global' ? (
                <FocusRuleEditor
                  label="全局专注目标"
                  value={focusDraft.global}
                  defaults={DEFAULT_TIMER_FOCUS_CONFIG.global}
                  onFieldChange={(field, value) => handleFocusFieldChange('global', field, value)}
                />
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {focusRuleEditors}
                </div>
              )}
            </div>

            <div className="mt-3 rounded-2xl border border-dashed border-border/70 bg-background/55 px-3 py-3 text-xs text-muted-foreground">
              当前全局默认：一级 {getTimerFocusRule('practice', parsedFocusConfig).primaryMinutes} 分钟左右的总冲刺，
              二级 {getTimerFocusRule('practice', parsedFocusConfig).secondaryMinutes} 分钟左右的小目标，更适合持续追小胜利。
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onReset()
              const resetFocusConfig = resetTimerFocusConfig()
              setFocusDraft(toFocusDraft(resetFocusConfig))
            }}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            恢复默认
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onSave(parsedConfig)
                if (onFocusConfigSave) {
                  onFocusConfigSave(parsedFocusConfig)
                } else {
                  saveTimerFocusConfig(parsedFocusConfig)
                }
                onOpenChange(false)
              }}
            >
              <Save className="mr-2 h-4 w-4" />
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}


