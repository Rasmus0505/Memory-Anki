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
import {
  DEFAULT_TIMER_AUTOMATION_CONFIG,
} from '@/shared/components/session/timer-automation-config'
import { TimerAutomationSection } from '@/shared/components/session/TimerAutomationSection'
import { toDraft, parseAutomationDraft } from '@/shared/components/session/timerAutomationDialogModel'
import { useTimerConfigDrafts } from '@/shared/components/session/useTimerConfigDrafts'

interface TimerAutomationDialogProps {
  open: boolean
  config: TimerAutomationConfig
  onOpenChange: (open: boolean) => void
  onSave: (config: TimerAutomationConfig) => void
  onReset: () => void
}

export function TimerAutomationDialog({
  open,
  config,
  onOpenChange,
  onSave,
  onReset,
}: TimerAutomationDialogProps) {
  const drafts = useTimerConfigDrafts({
    active: open,
    config,
  })
  const draftConfig = parseAutomationDraft(drafts.draft)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-timer-activity="ignore"
        className="flex w-[min(560px,calc(100vw-24px))] max-w-[560px] flex-col overflow-hidden rounded-lg border-border/70 bg-background/98 p-0"
      >
        <DialogHeader>
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-secondary text-foreground">
              <Settings2 className="size-5" />
            </div>
            <div>
              <DialogTitle>计时器设置</DialogTitle>
              <DialogDescription className="mt-1">
                页面可见就计时，即使窗口失焦。切走标签、进后台或息屏会暂停；超过 15 分钟再回来会开一条新记录。
              </DialogDescription>
            </div>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          <TimerAutomationSection
            draft={drafts.draft}
            onAutoStartChange={drafts.handleAutoStartChange}
            onKeepScreenAwakeChange={drafts.handleKeepScreenAwakeChange}
            onShowFloatingTimerChange={drafts.handleShowFloatingTimerChange}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onReset()
              drafts.setDraft(toDraft(DEFAULT_TIMER_AUTOMATION_CONFIG))
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
                onSave(draftConfig)
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
