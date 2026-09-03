import { useCallback, useEffect, useState } from 'react'
import { ProfileLayout } from '@/modules/settings/ui/profile/ProfileLayout'
import { Button } from '@/shared/components/ui/button'
import { InlineFeedback } from '@/shared/feedback/FeedbackStatus'
import {
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  TIMER_AUTOMATION_UPDATED_EVENT,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import { TimerAutomationSection } from '@/shared/components/session/TimerAutomationSection'
import { useTimerConfigDrafts } from '@/shared/components/session/useTimerConfigDrafts'
import { onAppEvent } from '@/shared/events/appEvents'


export default function ProfileTimerPage() {
  const [automationConfig, setAutomationConfig] = useState<TimerAutomationConfig>(() =>
    readTimerAutomationConfig(),
  )
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const drafts = useTimerConfigDrafts({
    active: true,
    config: automationConfig,
  })
  const { isDirty, resetDrafts, parsedConfig } = drafts

  useEffect(() => {
    setAutomationConfig(readTimerAutomationConfig())
  }, [])

  // The in-session dialog edits the same automation config, so pick up its
  // writes — but never clobber edits in progress here.
  useEffect(() => {
    const unsubscribeAutomation = onAppEvent(TIMER_AUTOMATION_UPDATED_EVENT, (detail) => {
      if (isDirty) return
      setAutomationConfig(detail || readTimerAutomationConfig())
    })
    return () => {
      unsubscribeAutomation()
    }
  }, [isDirty])

  const handleSave = useCallback(() => {
    setAutomationConfig(saveTimerAutomationConfig(parsedConfig))
    setSaveStatus('计时设置已保存')
  }, [parsedConfig])

  const handleReset = useCallback(() => {
    setAutomationConfig(resetTimerAutomationConfig())
    setSaveStatus('已恢复默认计时设置')
  }, [])

  return (
    <ProfileLayout
      title="计时设置"
      description="只统计页面可见且窗口有效的前台时间。后台和失焦立即暂停。"
    >
      <div className="space-y-4 pb-24">
        <TimerAutomationSection
          draft={drafts.draft}
          onAutoStartChange={drafts.handleAutoStartChange}
          onKeepScreenAwakeChange={drafts.handleKeepScreenAwakeChange}
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
