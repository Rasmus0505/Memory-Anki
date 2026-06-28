import { useEffect, useMemo, useState } from 'react'
import { AlarmClock, Bell, Clock3, RotateCcw } from 'lucide-react'
import { ProfileLayout } from '@/features/profile/ProfileLayout'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Switch } from '@/shared/components/ui/switch'
import { toast } from '@/shared/feedback/toast'
import {
  DEFAULT_BREAK_GUARD_CONFIG,
  readBreakGuardConfig,
  saveBreakGuardConfig,
  sanitizeBreakGuardConfig,
  type BreakGuardConfig,
} from '@/shared/components/session/break-guard-config'

function listToInputValue(values: number[]) {
  return values.join(', ')
}

function inputValueToList(value: string, fallback: number[]) {
  const parsed = value
    .split(',')
    .map((item) => Math.round(Number(item.trim())))
    .filter((item) => Number.isFinite(item) && item > 0)
  return parsed.length > 0 ? parsed : fallback
}

export default function ProfileTimerPage() {
  const [config, setConfig] = useState<BreakGuardConfig>(() => readBreakGuardConfig())
  const [presetInput, setPresetInput] = useState(() => listToInputValue(config.presetMinutes))
  const [snoozeInput, setSnoozeInput] = useState(() => listToInputValue(config.snoozeMinutes))

  useEffect(() => {
    const nextConfig = readBreakGuardConfig()
    setConfig(nextConfig)
    setPresetInput(listToInputValue(nextConfig.presetMinutes))
    setSnoozeInput(listToInputValue(nextConfig.snoozeMinutes))
  }, [])

  const normalizedPreview = useMemo(
    () =>
      sanitizeBreakGuardConfig({
        ...config,
        presetMinutes: inputValueToList(presetInput, DEFAULT_BREAK_GUARD_CONFIG.presetMinutes),
        snoozeMinutes: inputValueToList(snoozeInput, DEFAULT_BREAK_GUARD_CONFIG.snoozeMinutes),
      }),
    [config, presetInput, snoozeInput],
  )

  const updateConfig = (updater: (current: BreakGuardConfig) => BreakGuardConfig) => {
    setConfig((current) => updater(current))
  }

  const save = () => {
    const saved = saveBreakGuardConfig(normalizedPreview)
    setConfig(saved)
    setPresetInput(listToInputValue(saved.presetMinutes))
    setSnoozeInput(listToInputValue(saved.snoozeMinutes))
    toast.success('计时与休息配置已保存')
  }

  const reset = () => {
    const saved = saveBreakGuardConfig(DEFAULT_BREAK_GUARD_CONFIG)
    setConfig(saved)
    setPresetInput(listToInputValue(saved.presetMinutes))
    setSnoozeInput(listToInputValue(saved.snoozeMinutes))
    toast.success('已恢复默认休息守护配置')
  }

  return (
    <ProfileLayout
      title="计时与休息"
      description="管理离开 Memory Anki 后的休息倒计时、提醒强度和回归入口。"
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlarmClock className="h-4 w-4" />
                休息守护
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <label className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-card/70 px-4 py-3">
                <div>
                  <div className="text-sm font-medium">启用离开页面后的休息询问</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Memory Anki 失焦或隐藏后，悬浮计时器会询问是否开始休息倒计时。
                  </div>
                </div>
                <Switch
                  checked={config.enabled}
                  onCheckedChange={(checked) => updateConfig((current) => ({ ...current, enabled: checked }))}
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <Label htmlFor="break-delay">离开后询问延迟（秒）</Label>
                  <Input
                    id="break-delay"
                    type="number"
                    min="0"
                    max="120"
                    value={config.promptDelaySeconds}
                    onChange={(event) =>
                      updateConfig((current) => ({
                        ...current,
                        promptDelaySeconds: Math.max(0, Math.round(Number(event.target.value) || 0)),
                      }))
                    }
                  />
                </label>
                <label className="space-y-2">
                  <Label htmlFor="break-target">到点后打开页面</Label>
                  <Input
                    id="break-target"
                    value={config.targetPath}
                    onChange={(event) => updateConfig((current) => ({ ...current, targetPath: event.target.value }))}
                    placeholder="/freestyle"
                  />
                </label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock3 className="h-4 w-4" />
                休息时长
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <label className="space-y-2">
                <Label htmlFor="break-presets">默认时长按钮（分钟，用英文逗号分隔）</Label>
                <Input
                  id="break-presets"
                  value={presetInput}
                  onChange={(event) => setPresetInput(event.target.value)}
                  placeholder="5, 10, 20"
                />
              </label>
              <label className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-card/70 px-4 py-3">
                <div>
                  <div className="text-sm font-medium">允许自定义休息分钟数</div>
                  <div className="mt-1 text-xs text-muted-foreground">离开时可输入任意 1-240 分钟。</div>
                </div>
                <Switch
                  checked={config.allowCustomMinutes}
                  onCheckedChange={(checked) =>
                    updateConfig((current) => ({ ...current, allowCustomMinutes: checked }))
                  }
                />
              </label>
              <label className="space-y-2">
                <Label htmlFor="break-snooze">延后按钮（分钟，用英文逗号分隔）</Label>
                <Input
                  id="break-snooze"
                  value={snoozeInput}
                  onChange={(event) => setSnoozeInput(event.target.value)}
                  placeholder="1, 3, 5"
                />
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4" />
                提醒与记录
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2">
                {[
                  { value: 'strong', title: '强提醒', desc: '置顶闪烁、声音、通知，并打开目标页面。' },
                  { value: 'gentle', title: '温和提醒', desc: '显示提醒和通知，不主动跳转页面。' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`rounded-lg border p-4 text-left transition-all ${
                      config.alertStrength === option.value
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border/70 hover:bg-secondary'
                    }`}
                    onClick={() =>
                      updateConfig((current) => ({
                        ...current,
                        alertStrength: option.value as BreakGuardConfig['alertStrength'],
                      }))
                    }
                  >
                    <div className="text-sm font-semibold">{option.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{option.desc}</div>
                  </button>
                ))}
              </div>
              <label className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-card/70 px-4 py-3">
                <div>
                  <div className="text-sm font-medium">记录轻量休息日志</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    只记录开始、结束、是否超时和延后次数，不计入学习时长。
                  </div>
                </div>
                <Switch
                  checked={config.recordBreakLogs}
                  onCheckedChange={(checked) => updateConfig((current) => ({ ...current, recordBreakLogs: checked }))}
                />
              </label>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save}>
              保存配置
            </Button>
            <Button type="button" variant="outline" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              恢复默认
            </Button>
          </div>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">当前预览</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg bg-secondary/70 px-3 py-2">离开 {normalizedPreview.promptDelaySeconds} 秒后询问</div>
            <div className="rounded-lg bg-secondary/70 px-3 py-2">休息按钮：{normalizedPreview.presetMinutes.join(' / ')} 分钟</div>
            <div className="rounded-lg bg-secondary/70 px-3 py-2">延后按钮：{normalizedPreview.snoozeMinutes.join(' / ')} 分钟</div>
            <div className="rounded-lg bg-secondary/70 px-3 py-2">到点打开：{normalizedPreview.targetPath}</div>
            <div className="rounded-lg bg-secondary/70 px-3 py-2">
              提醒强度：{normalizedPreview.alertStrength === 'strong' ? '强提醒' : '温和提醒'}
            </div>
          </CardContent>
        </Card>
      </div>
    </ProfileLayout>
  )
}
