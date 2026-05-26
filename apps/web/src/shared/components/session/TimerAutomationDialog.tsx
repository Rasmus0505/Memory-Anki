import * as React from 'react'
import { RotateCcw, Save, Settings2 } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import type {
  TimerAutomationActivityConfig,
  TimerAutomationConfig,
  TimerAutomationRule,
  TimerAutomationScene,
} from '@/shared/components/session/timer-automation-config'
import {
  DEFAULT_TIMER_AUTOMATION_CONFIG,
  TIMER_AUTOMATION_SCENE_LABELS,
  sanitizeTimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'

interface TimerAutomationDialogProps {
  open: boolean
  config: TimerAutomationConfig
  onOpenChange: (open: boolean) => void
  onSave: (config: TimerAutomationConfig) => void
  onReset: () => void
}

type FieldKey = keyof TimerAutomationRule
type ActionFieldKey = keyof TimerAutomationActivityConfig

function toDraft(config: TimerAutomationConfig) {
  return {
    actions: {
      autoStartOnPageEnter: config.actions.autoStartOnPageEnter,
      autoResumeOnWindowReturn: config.actions.autoResumeOnWindowReturn,
      countNodeSwitchAsActivity: config.actions.countNodeSwitchAsActivity,
      countEditOperationsAsActivity: config.actions.countEditOperationsAsActivity,
      countPracticeInteractionsAsActivity: config.actions.countPracticeInteractionsAsActivity,
    },
    palace_edit: {
      inactiveAutoPauseSeconds: String(config.palace_edit.inactiveAutoPauseSeconds),
      hiddenAutoPauseSeconds: String(config.palace_edit.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.palace_edit.autoPauseRollbackSeconds),
    },
    practice: {
      inactiveAutoPauseSeconds: String(config.practice.inactiveAutoPauseSeconds),
      hiddenAutoPauseSeconds: String(config.practice.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.practice.autoPauseRollbackSeconds),
    },
    review: {
      inactiveAutoPauseSeconds: String(config.review.inactiveAutoPauseSeconds),
      hiddenAutoPauseSeconds: String(config.review.hiddenAutoPauseSeconds),
      autoPauseRollbackSeconds: String(config.review.autoPauseRollbackSeconds),
    },
  }
}

export function TimerAutomationDialog({
  open,
  config,
  onOpenChange,
  onSave,
  onReset,
}: TimerAutomationDialogProps) {
  const [draft, setDraft] = React.useState(() => toDraft(config))

  React.useEffect(() => {
    if (!open) return
    setDraft(toDraft(config))
  }, [config, open])

  const handleFieldChange = React.useCallback(
    (scene: TimerAutomationScene, field: FieldKey, value: string) => {
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

  const handleActionChange = React.useCallback((field: ActionFieldKey, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      actions: {
        ...current.actions,
        [field]: checked,
      },
    }))
  }, [])

  const parsedConfig = React.useMemo(
    () =>
      sanitizeTimerAutomationConfig({
        actions: {
          autoStartOnPageEnter: draft.actions.autoStartOnPageEnter,
          autoResumeOnWindowReturn: draft.actions.autoResumeOnWindowReturn,
          countNodeSwitchAsActivity: draft.actions.countNodeSwitchAsActivity,
          countEditOperationsAsActivity: draft.actions.countEditOperationsAsActivity,
          countPracticeInteractionsAsActivity: draft.actions.countPracticeInteractionsAsActivity,
        },
        palace_edit: {
          inactiveAutoPauseSeconds: draft.palace_edit.inactiveAutoPauseSeconds,
          hiddenAutoPauseSeconds: draft.palace_edit.hiddenAutoPauseSeconds,
          autoPauseRollbackSeconds: draft.palace_edit.autoPauseRollbackSeconds,
        },
        practice: {
          inactiveAutoPauseSeconds: draft.practice.inactiveAutoPauseSeconds,
          hiddenAutoPauseSeconds: draft.practice.hiddenAutoPauseSeconds,
          autoPauseRollbackSeconds: draft.practice.autoPauseRollbackSeconds,
        },
        review: {
          inactiveAutoPauseSeconds: draft.review.inactiveAutoPauseSeconds,
          hiddenAutoPauseSeconds: draft.review.hiddenAutoPauseSeconds,
          autoPauseRollbackSeconds: draft.review.autoPauseRollbackSeconds,
        },
      }),
    [draft],
  )

  const scenes = Object.keys(TIMER_AUTOMATION_SCENE_LABELS) as TimerAutomationScene[]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[min(92vh,840px)] w-[min(1120px,calc(100vw-32px))] max-w-[1120px] overflow-hidden rounded-[28px] border-border/70 bg-background/98 p-0"
      >
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-secondary text-foreground">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>自动化配置</DialogTitle>
              <p className="text-sm text-muted-foreground">配置哪些动作算活动，以及各场景的自动暂停与回退秒数。</p>
            </div>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div
          data-testid="timer-automation-dialog-content"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 xl:overflow-visible"
        >
          <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
            <div className="mb-1 text-sm font-semibold text-foreground">全局动作规则</div>
            <p className="mb-3 text-xs text-muted-foreground">
              控制哪些动作会自动开始、自动恢复或在运行中延续计时。
            </p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="flex min-h-[112px] items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={draft.actions.autoStartOnPageEnter}
                  onChange={(event) => handleActionChange('autoStartOnPageEnter', event.target.checked)}
                />
                <span>
                  <span className="block font-medium text-foreground">进入编辑页自动开始</span>
                  <span className="text-xs text-muted-foreground">仅影响宫殿编辑页的自动开表。</span>
                </span>
              </label>
              <label className="flex min-h-[112px] items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={draft.actions.autoResumeOnWindowReturn}
                  onChange={(event) => handleActionChange('autoResumeOnWindowReturn', event.target.checked)}
                />
                <span>
                  <span className="block font-medium text-foreground">切回窗口自动恢复</span>
                  <span className="text-xs text-muted-foreground">影响页面重新可见和窗口重新聚焦时是否自动恢复。</span>
                </span>
              </label>
              <label className="flex min-h-[112px] items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={draft.actions.countNodeSwitchAsActivity}
                  onChange={(event) => handleActionChange('countNodeSwitchAsActivity', event.target.checked)}
                />
                <span>
                  <span className="block font-medium text-foreground">节点切换算活动</span>
                  <span className="text-xs text-muted-foreground">影响脑图节点激活、焦点切换这类弱信号。</span>
                </span>
              </label>
              <label className="flex min-h-[112px] items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={draft.actions.countEditOperationsAsActivity}
                  onChange={(event) => handleActionChange('countEditOperationsAsActivity', event.target.checked)}
                />
                <span>
                  <span className="block font-medium text-foreground">实际编辑动作算活动</span>
                  <span className="text-xs text-muted-foreground">包括改脑图、标题、附件、章节、分块、全屏切换。</span>
                </span>
              </label>
              <label className="flex min-h-[112px] items-start gap-3 rounded-xl border border-border/60 bg-background/50 px-3 py-3 text-sm md:col-span-2 xl:col-span-1">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={draft.actions.countPracticeInteractionsAsActivity}
                  onChange={(event) => handleActionChange('countPracticeInteractionsAsActivity', event.target.checked)}
                />
                <span>
                  <span className="block font-medium text-foreground">练习交互算活动</span>
                  <span className="text-xs text-muted-foreground">包括左右键翻卡、重开、页内练习切换、正式练习交互。</span>
                </span>
              </label>
            </div>
            <div className="mt-3 text-xs text-muted-foreground">
              默认值：
              {` 页面进入自动开始 关，切回窗口自动恢复 关，节点切换 关，实际编辑 开，练习交互 开`}
            </div>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            {scenes.map((scene) => (
              <div key={scene} className="rounded-2xl border border-border/70 bg-card/70 p-4">
                <div className="mb-3 text-sm font-semibold text-foreground">
                  {TIMER_AUTOMATION_SCENE_LABELS[scene]}
                </div>
                <div className="grid gap-3">
                  <label className="space-y-2 text-sm">
                    <span className="text-muted-foreground">无操作自动暂停（秒）</span>
                    <Input
                      inputMode="numeric"
                      value={draft[scene].inactiveAutoPauseSeconds}
                      onChange={(event) =>
                        handleFieldChange(scene, 'inactiveAutoPauseSeconds', event.target.value)
                      }
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="text-muted-foreground">后台/失焦自动暂停（秒）</span>
                    <Input
                      inputMode="numeric"
                      value={draft[scene].hiddenAutoPauseSeconds}
                      onChange={(event) =>
                        handleFieldChange(scene, 'hiddenAutoPauseSeconds', event.target.value)
                      }
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="text-muted-foreground">自动暂停回退时长（秒）</span>
                    <Input
                      inputMode="numeric"
                      value={draft[scene].autoPauseRollbackSeconds}
                      onChange={(event) =>
                        handleFieldChange(scene, 'autoPauseRollbackSeconds', event.target.value)
                      }
                    />
                  </label>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  默认值：
                  {` 无操作 ${DEFAULT_TIMER_AUTOMATION_CONFIG[scene].inactiveAutoPauseSeconds}s，后台 ${DEFAULT_TIMER_AUTOMATION_CONFIG[scene].hiddenAutoPauseSeconds}s，回退 ${DEFAULT_TIMER_AUTOMATION_CONFIG[scene].autoPauseRollbackSeconds}s`}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
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
