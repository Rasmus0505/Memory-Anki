import { useEffect, useMemo, useState } from 'react'
import { AlarmClock, Clock3, Settings2, Sparkles } from 'lucide-react'
import { ProfileLayout } from '@/features/profile/ProfileLayout'
import { TimerAutomationDialog } from '@/shared/components/session/TimerAutomationDialog'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { toast } from '@/shared/feedback/toast'
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
      description="管理学习计时、双层目标、自动暂停、休息守护和达标反馈。"
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
                无操作自动暂停：{freestyleAutomation.inactiveAutoPauseSeconds} 秒
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                自动暂停回退：{freestyleAutomation.autoPauseRollbackSeconds} 秒
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
                随心一级目标：{freestyleFocus.primaryMinutes} 分钟
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                随心二级间隔：{freestyleFocus.secondaryMinutes} 分钟
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
                离开后询问：{breakConfig.promptDelaySeconds} 秒
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                休息按钮：{breakConfig.presetMinutes.join(' / ')} 分钟
              </div>
              <div className="rounded-lg bg-secondary/70 px-3 py-2">
                学习即结束休息：{breakConfig.autoFinishOnStudyReturn ? '开启' : '关闭'}
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
                打开完整设置后，可以配置每个场景的自动开始、无操作暂停、后台暂停、回退时间、一级/二级目标、达标反馈和休息日志。
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
              如果你经常只是查资料，适合把休息询问延迟调长。
            </div>
            <div className="rounded-lg bg-secondary/70 px-3 py-2 text-foreground">
              如果你回到学习后不希望倒计时继续压住学习，保持“学习即结束休息”开启。
            </div>
            <div className="rounded-lg bg-secondary/70 px-3 py-2 text-foreground">
              二级目标可以设 1-3 分钟，一级目标可以设 15-45 分钟。
            </div>
          </CardContent>
        </Card>
      </div>

      <TimerAutomationDialog
        open={dialogOpen}
        config={automationConfig}
        focusConfig={focusConfig}
        breakConfig={breakConfig}
        onOpenChange={setDialogOpen}
        onSave={(nextConfig) => {
          setAutomationConfig(saveTimerAutomationConfig(nextConfig))
          toast.success('计时自动化配置已保存')
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
          toast.success('已恢复默认计时器配置')
        }}
      />
    </ProfileLayout>
  )
}
