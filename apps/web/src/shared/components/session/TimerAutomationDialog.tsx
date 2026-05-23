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

function toDraft(config: TimerAutomationConfig) {
  return {
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

  const parsedConfig = React.useMemo(
    () =>
      sanitizeTimerAutomationConfig({
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
      <DialogContent className="max-w-3xl rounded-[28px] border-border/70 bg-background/98 p-0">
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-secondary text-foreground">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>自动化配置</DialogTitle>
              <p className="text-sm text-muted-foreground">按场景配置自动暂停、后台暂停和自动回退时长。</p>
            </div>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="space-y-4 px-6 py-5">
          {scenes.map((scene) => (
            <div key={scene} className="rounded-2xl border border-border/70 bg-card/70 p-4">
              <div className="mb-3 text-sm font-semibold text-foreground">
                {TIMER_AUTOMATION_SCENE_LABELS[scene]}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
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
