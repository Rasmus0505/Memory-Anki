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
import type { TimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { DEFAULT_TIMER_AUTOMATION_CONFIG } from '@/shared/components/session/timer-automation-config'
import type { TimerFocusConfig } from '@/shared/components/session/timer-focus-config'
import {
  DEFAULT_TIMER_FOCUS_CONFIG,
  resetTimerFocusConfig,
  saveTimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'
import type { BreakGuardConfig } from '@/shared/components/session/break-guard-config'
import {
  DEFAULT_BREAK_GUARD_CONFIG,
  resetBreakGuardConfig,
  saveBreakGuardConfig,
} from '@/shared/components/session/break-guard-config'
import { TimerAutomationSection } from '@/shared/components/session/TimerAutomationSection'
import { TimerBreakGuardSection } from '@/shared/components/session/TimerBreakGuardSection'
import { TimerFocusSection } from '@/shared/components/session/TimerFocusSection'
import { toBreakDraft, toDraft, toFocusDraft } from '@/shared/components/session/timerAutomationDialogModel'
import { useTimerConfigDrafts } from '@/shared/components/session/useTimerConfigDrafts'

interface TimerAutomationDialogProps {
  open: boolean
  config: TimerAutomationConfig
  onOpenChange: (open: boolean) => void
  onSave: (config: TimerAutomationConfig) => void
  onReset: () => void
  focusConfig?: TimerFocusConfig
  onFocusConfigSave?: (config: TimerFocusConfig) => void
  breakConfig?: BreakGuardConfig
  onBreakConfigSave?: (config: BreakGuardConfig) => void
}

export function TimerAutomationDialog({
  open,
  config,
  onOpenChange,
  onSave,
  onReset,
  focusConfig = DEFAULT_TIMER_FOCUS_CONFIG,
  onFocusConfigSave,
  breakConfig = DEFAULT_BREAK_GUARD_CONFIG,
  onBreakConfigSave,
}: TimerAutomationDialogProps) {
  const {
    draft,
    focusDraft,
    breakDraft,
    setDraft,
    setFocusDraft,
    setBreakDraft,
    handleFieldChange,
    handleAutoStartChange,
    handleKeepScreenAwakeChange,
    handleFocusFieldChange,
    handleBreakBooleanChange,
    handleBreakNumberChange,
    handleBreakTextChange,
    handleBreakAlertStrengthChange,
    parsedConfig,
    parsedFocusConfig,
    parsedBreakConfig,
  } = useTimerConfigDrafts({ active: open, config, focusConfig, breakConfig })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-timer-activity="ignore"
        className="flex h-[min(88vh,820px)] w-[min(1100px,calc(100vw-24px))] max-w-[1100px] flex-col overflow-hidden rounded-lg border-border/70 bg-background/98 p-0"
      >
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-secondary text-foreground">
              <Settings2 className="size-5" />
            </div>
            <div>
              <DialogTitle>专注计时设置</DialogTitle>
              <DialogDescription className="mt-1">
                学习中常用的几项。完整设置（后台宽限、休息高级项、反馈细则）在「计时与休息」页。
              </DialogDescription>
            </div>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div
          data-testid="timer-automation-dialog-content"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
        >
          <TimerAutomationSection
            variant="compact"
            draft={draft}
            onFieldChange={handleFieldChange}
            onAutoStartChange={handleAutoStartChange}
            onKeepScreenAwakeChange={handleKeepScreenAwakeChange}
          />
          <TimerFocusSection
            variant="compact"
            focusDraft={focusDraft}
            parsedFocusConfig={parsedFocusConfig}
            parsedBreakConfig={parsedBreakConfig}
            onFocusFieldChange={handleFocusFieldChange}
          />
          <TimerBreakGuardSection
            variant="compact"
            breakDraft={breakDraft}
            parsedBreakConfig={parsedBreakConfig}
            onBreakBooleanChange={handleBreakBooleanChange}
            onBreakNumberChange={handleBreakNumberChange}
            onBreakTextChange={handleBreakTextChange}
            onBreakAlertStrengthChange={handleBreakAlertStrengthChange}
            onNotifyOnBreakExpiredChange={() => {}}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onReset()
              const resetFocusConfig = resetTimerFocusConfig()
              const resetBreakConfig = resetBreakGuardConfig()
              setDraft(toDraft(DEFAULT_TIMER_AUTOMATION_CONFIG))
              setFocusDraft(toFocusDraft(resetFocusConfig))
              setBreakDraft(toBreakDraft(resetBreakConfig))
              onFocusConfigSave?.(resetFocusConfig)
              onBreakConfigSave?.(resetBreakConfig)
            }}
          >
            <RotateCcw className="mr-2 size-4" />
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
                if (onBreakConfigSave) {
                  onBreakConfigSave(parsedBreakConfig)
                } else {
                  saveBreakGuardConfig(parsedBreakConfig)
                }
                onOpenChange(false)
              }}
            >
              <Save className="mr-2 size-4" />
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
