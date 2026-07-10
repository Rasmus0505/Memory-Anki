import { useEffect, useMemo, useState } from 'react'
import { AlarmClock, Clock3, Settings2, Sparkles } from 'lucide-react'
import { ProfileLayout } from '@/features/profile/ProfileLayout'
import { TimerAutomationDialog } from '@/shared/components/session/TimerAutomationDialog'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { InlineFeedback } from '@/shared/feedback/FeedbackStatus'
import {
  getTimerAutomationRule,
  readTimerAutomationConfig,
  resetTimerAutomationConfig,
  saveTimerAutomationConfig,
  type TimerAutomationConfig,
} from '@/shared/components/session/timer-automation-config'
import {
  getTimerFocusRule,
  readTimerFocusConfig,
  resetTimerFocusConfig,
  saveTimerFocusConfig,
  type TimerFocusConfig,
} from '@/shared/components/session/timer-focus-config'
import {
  readBreakGuardConfig,
  resetBreakGuardConfig,
  saveBreakGuardConfig,
  type BreakGuardConfig,
} from '@/shared/components/session/break-guard-config'

export default function ProfileTimerPage() {
  const [automationConfig, setAutomationConfig] = useState<TimerAutomationConfig>(() => readTimerAutomationConfig())
  const [focusConfig, setFocusConfig] = useState<TimerFocusConfig>(() => readTimerFocusConfig())
  const [breakConfig, setBreakConfig] = useState<BreakGuardConfig>(() => readBreakGuardConfig())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  useEffect(() => {
    setAutomationConfig(readTimerAutomationConfig())
    setFocusConfig(readTimerFocusConfig())
    setBreakConfig(readBreakGuardConfig())
  }, [])

  const freestyleAutomation = useMemo(
    () => getTimerAutomationRule('freestyle', automationConfig),
    [automationConfig],
  )
  const freestyleFocus = useMemo(
    () => getTimerFocusRule('freestyle', focusConfig),
    [focusConfig],
  )

  return (
    <ProfileLayout
      title="计时与休息"
      description="管理有效学习时长、专注轮次、闲置预警、阶段反馈和手动休息。"
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock3 className="size-4" />
                学习自动化
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                模式：{automationConfig.mode === 'global' ? '全局配置' : '按场景配置'}
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                随心进入自动开始：{freestyleAutomation.autoStartOnPageEnter ? '开启' : '关闭'}
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                闲置预警：{freestyleAutomation.inactiveAutoPauseSeconds} 秒
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                预警宽限：{freestyleAutomation.inactivePauseGraceSeconds ?? 30} 秒
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="size-4" />
                专注目标
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                目标模式：{focusConfig.mode === 'global' ? '全局目标' : '按场景目标'}
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                主数字：本次有效学习时长
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                随心轮次：{freestyleFocus.primaryMinutes} 分钟
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                阶段提醒：每 {freestyleFocus.secondaryMinutes} 分钟
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                反馈强度：{focusConfig.feedbackIntensity}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlarmClock className="size-4" />
                休息守护
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                状态：{breakConfig.enabled ? '已启用' : '已关闭'}
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                离开窗口询问：{breakConfig.promptOnWindowLeave ? '开启' : '关闭'}
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                休息按钮：{breakConfig.presetMinutes.join(' / ')} 分钟
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                休息后自动恢复：{breakConfig.resumeInterruptedStudyOnReturn ? '开启' : '关闭'}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2 className="size-4" />
                配置入口
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="leading-6 text-muted-foreground">
                常用设置包含自动开始、轮次目标、闲置预警和休息时长；活动识别、后台暂停、回退和反馈细节位于高级设置。
              </p>
              <Button type="button" onClick={() => setDialogOpen(true)}>
                <Settings2 className="mr-2 size-4" />
                打开完整计时器配置
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">建议检查</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="rounded-lg bg-secondary/70 px-3 py-2 text-foreground">
              主数字会持续显示有效学习时长，25 分钟轮次只在进度区域重置。
            </div>
            <div className="rounded-lg bg-secondary/70 px-3 py-2 text-foreground">
              离开窗口询问默认关闭，查资料或查看 PDF 不会触发休息弹窗。
            </div>
            <div className="rounded-lg bg-secondary/70 px-3 py-2 text-foreground">
              推荐每 5 分钟轻提醒、每 25 分钟完成一轮、休息 5 分钟后手动开始。
            </div>
          </CardContent>
        </Card>
      </div>

      {saveStatus ? (
        <div className="mt-4">
          <InlineFeedback tone="success" message={saveStatus} />
        </div>
      ) : null}

      <TimerAutomationDialog
        open={dialogOpen}
        config={automationConfig}
        focusConfig={focusConfig}
        breakConfig={breakConfig}
        onOpenChange={setDialogOpen}
        onSave={(nextConfig) => {
          setAutomationConfig(saveTimerAutomationConfig(nextConfig))
          setSaveStatus('计时器配置已保存')
        }}
        onFocusConfigSave={(nextConfig) => {
          setFocusConfig(saveTimerFocusConfig(nextConfig))
        }}
        onBreakConfigSave={(nextConfig) => {
          setBreakConfig(saveBreakGuardConfig(nextConfig))
        }}
        onReset={() => {
          setAutomationConfig(resetTimerAutomationConfig())
          setFocusConfig(resetTimerFocusConfig())
          setBreakConfig(resetBreakGuardConfig())
          setSaveStatus('已恢复默认计时器配置')
        }}
      />
    </ProfileLayout>
  )
}
