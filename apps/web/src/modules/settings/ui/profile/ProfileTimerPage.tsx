import { useCallback, useEffect, useState } from 'react'
import { ProfileLayout } from '@/modules/settings/ui/profile/ProfileLayout'
import { Button } from '@/shared/components/ui/button'
import { InlineFeedback } from '@/shared/feedback/FeedbackStatus'
import { toast } from '@/shared/feedback/toast'
import {
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  TIMER_AUTOMATION_UPDATED_EVENT,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import {
  readTimerFocusConfig,
  resetTimerFocusConfig,
  saveTimerFocusConfig,
  TIMER_FOCUS_UPDATED_EVENT,
  type TimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'
import {
  BREAK_GUARD_UPDATED_EVENT,
  readBreakGuardConfig,
  resetBreakGuardConfig,
  saveBreakGuardConfig,
  type BreakGuardConfig,
} from '@/shared/components/session/break-guard-config'
import { TimerAutomationSection } from '@/shared/components/session/TimerAutomationSection'
import { TimerFocusSection } from '@/shared/components/session/TimerFocusSection'
import { TimerBreakGuardSection } from '@/shared/components/session/TimerBreakGuardSection'
import { useTimerConfigDrafts } from '@/shared/components/session/useTimerConfigDrafts'
import { onAppEvent } from '@/shared/events/appEvents'

export default function ProfileTimerPage() {
  const [automationConfig, setAutomationConfig] = useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )
  const [focusConfig, setFocusConfig] = useState<TimerFocusConfig>(() => readTimerFocusConfig())
  const [breakConfig, setBreakConfig] = useState<BreakGuardConfig>(() => readBreakGuardConfig())
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const drafts = useTimerConfigDrafts({
    active: true,
    config: automationConfig,
    focusConfig,
    breakConfig,
  })
  const { isDirty, resetDrafts, parsedConfig, parsedFocusConfig, parsedBreakConfig } = drafts

  useEffect(() => {
    setAutomationConfig(readTimerAutomationConfig())
    setFocusConfig(readTimerFocusConfig())
    setBreakConfig(readBreakGuardConfig())
  }, [])

  // The in-session dialog edits the same three configs, so pick up its writes —
  // but never clobber edits in progress here.
  useEffect(() => {
    const unsubscribeAutomation = onAppEvent(TIMER_AUTOMATION_UPDATED_EVENT, (detail) => {
      if (isDirty) return
      setAutomationConfig(detail || readTimerAutomationConfig())
    })
    const syncFocus = () => {
      if (isDirty) return
      setFocusConfig(readTimerFocusConfig())
    }
    const syncBreak = () => {
      if (isDirty) return
      setBreakConfig(readBreakGuardConfig())
    }
    window.addEventListener(TIMER_FOCUS_UPDATED_EVENT, syncFocus)
    window.addEventListener(BREAK_GUARD_UPDATED_EVENT, syncBreak)
    return () => {
      unsubscribeAutomation()
      window.removeEventListener(TIMER_FOCUS_UPDATED_EVENT, syncFocus)
      window.removeEventListener(BREAK_GUARD_UPDATED_EVENT, syncBreak)
    }
  }, [isDirty])

  const handleSave = useCallback(() => {
    setAutomationConfig(saveTimerAutomationConfig(parsedConfig))
    setFocusConfig(saveTimerFocusConfig(parsedFocusConfig))
    setBreakConfig(saveBreakGuardConfig(parsedBreakConfig))
    setSaveStatus('计时与休息设置已保存')
  }, [parsedBreakConfig, parsedConfig, parsedFocusConfig])

  const handleReset = useCallback(() => {
    setAutomationConfig(resetTimerAutomationConfig())
    setFocusConfig(resetTimerFocusConfig())
    setBreakConfig(resetBreakGuardConfig())
    setSaveStatus('已恢复默认计时与休息设置')
  }, [])

  // Enabling notifications needs the browser permission, so the switch cannot
  // just flip the draft: without permission the setting would silently do nothing.
  const handleNotifyChange = useCallback(
    async (checked: boolean) => {
      if (!checked) {
        drafts.setBreakDraft((current) => ({ ...current, notifyOnBreakExpired: false }))
        return
      }
      if (!('Notification' in window)) {
        toast.warning('当前环境不支持桌面通知')
        return
      }
      const permission =
        Notification.permission === 'default'
          ? await Notification.requestPermission()
          : Notification.permission
      if (permission !== 'granted') {
        toast.warning('通知权限未开启，休息到点仍会在应用内提醒')
        return
      }
      drafts.setBreakDraft((current) => ({ ...current, notifyOnBreakExpired: true }))
    },
    [drafts],
  )

  return (
    <ProfileLayout
      title="计时与休息"
      description="决定什么时候算学习时间、什么时候该休息。声音与动画反馈在「反馈中心」设置。"
    >
      <div className="space-y-4 pb-24">
        <TimerAutomationSection
          draft={drafts.draft}
          onFieldChange={drafts.handleFieldChange}
          onAutoStartChange={drafts.handleAutoStartChange}
          onKeepScreenAwakeChange={drafts.handleKeepScreenAwakeChange}
        />
        <TimerFocusSection
          focusDraft={drafts.focusDraft}
          parsedFocusConfig={parsedFocusConfig}
          parsedBreakConfig={parsedBreakConfig}
          onFocusFieldChange={drafts.handleFocusFieldChange}
        />
        <TimerBreakGuardSection
          breakDraft={drafts.breakDraft}
          parsedBreakConfig={parsedBreakConfig}
          onBreakBooleanChange={drafts.handleBreakBooleanChange}
          onBreakNumberChange={drafts.handleBreakNumberChange}
          onBreakTextChange={drafts.handleBreakTextChange}
          onBreakAlertStrengthChange={drafts.handleBreakAlertStrengthChange}
          onNotifyOnBreakExpiredChange={handleNotifyChange}
        />

        {saveStatus ? <InlineFeedback tone="success" message={saveStatus} /> : null}
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-1 py-3 backdrop-blur">
        <span className="text-xs text-muted-foreground">
          {isDirty ? '有未保存的修改' : '所有修改已保存'}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={resetDrafts} disabled={!isDirty}>
            放弃修改
          </Button>
          <Button type="button" variant="outline" onClick={handleReset}>
            恢复默认
          </Button>
          <Button type="button" onClick={handleSave} disabled={!isDirty}>
            保存
          </Button>
        </div>
      </div>
    </ProfileLayout>
  )
}
