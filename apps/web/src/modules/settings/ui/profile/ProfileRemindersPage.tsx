import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { BellRing, Clock3, Eraser, Gauge, Hourglass, Send, Smartphone, Sparkles } from 'lucide-react'
import { ProfileLayout } from '@/modules/settings/ui/profile/ProfileLayout'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Switch } from '@/shared/components/ui/switch'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'
import {
  getReminderSettingsApi,
  previewReminderApi,
  sendTestReminderApi,
  updateReminderSettingsApi,
  type ReminderContentMode,
  type ReminderKind,
  type ReminderSettings,
  type ReminderStatus,
} from '@/modules/settings/ui/profile/api'

const SLOT_LABELS: Record<'morning' | 'evening', string> = {
  morning: '早上概览',
  evening: '晚上催促',
}

const KIND_LABELS: Record<ReminderKind, string> = {
  morning: '早上概览',
  evening: '晚上催促',
  ready: '到期就绪',
  idle: '闲置拉回',
  hourly: '整点小结',
}

const CONTENT_OPTIONS: Array<{
  value: ReminderContentMode
  title: string
  description: string
}> = [
  {
    value: 'detailed',
    title: '具体数字',
    description: '锁屏直接显示「今天 128 张到期，昨天复习了 210 张」。',
  },
  {
    value: 'vague',
    title: '模糊文案',
    description: '只说「今天的复习到点了」，点开 App 才看到数字。',
  },
]

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function hourOptions() {
  return Array.from({ length: 24 }, (_, hour) => hour)
}

function dayPrefix(target: Date, now: Date) {
  const startOf = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const diffDays = Math.round((startOf(target) - startOf(now)) / 86_400_000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '明天'
  return `${target.getMonth() + 1} 月 ${target.getDate()} 日`
}

export function formatReminderMoment(iso: string | null, now = new Date()) {
  if (!iso) return '未计划'
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return '未计划'
  return `${dayPrefix(at, now)} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** 免打扰之外还有多少小时可以响。开始 > 结束 视为跨零点。 */
export function activeHours(settings: ReminderSettings) {
  const start = settings.quiet_start_hour
  const end = settings.quiet_end_hour
  const quiet = start === end ? 0 : (end - start + 24) % 24
  return 24 - quiet
}

/**
 * 估算"今天最多还会收到几条"。上限不是吓唬人：
 * 闲置每 5 分钟一次，一个上午就能刷出一百条，用户必须提前看到这个数字。
 */
export function estimateDaily(settings: ReminderSettings) {
  const hours = activeHours(settings)
  let total = 0
  if (settings.morning_enabled) total += 1
  if (settings.evening_enabled) total += 1
  if (settings.hourly_enabled) total += hours
  if (settings.ready_enabled) {
    total += Math.floor((hours * 60) / Math.max(1, settings.ready_min_gap_minutes))
  }
  if (settings.idle_enabled) {
    total += Math.floor((hours * 60) / Math.max(1, settings.idle_repeat_minutes))
  }
  return {
    estimate: settings.daily_cap ? Math.min(total, settings.daily_cap) : total,
    cappedBy: settings.daily_cap || 0,
  }
}

function Row({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/55 py-4 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description ? (
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

function PreviewButton({
  kind,
  onPreview,
  busy,
}: {
  kind: ReminderKind
  onPreview: (kind: ReminderKind) => void
  busy: boolean
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={() => onPreview(kind)}
      aria-label={`预览${KIND_LABELS[kind]}`}
    >
      <Sparkles className="size-4" /> 预览
    </Button>
  )
}

export default function ProfileRemindersPage() {
  const [draft, setDraft] = useState<ReminderSettings | null>(null)
  const [status, setStatus] = useState<ReminderStatus | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const payload = await getReminderSettingsApi()
      setDraft(payload.settings)
      setStatus(payload.status)
    } catch {
      toast.error('读取提醒设置失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const persist = useCallback(async (changes: Record<string, unknown>) => {
    try {
      const payload = await updateReminderSettingsApi(changes)
      setDraft(payload.settings)
      setStatus(payload.status)
      return true
    } catch {
      toast.error('保存失败，请稍后重试')
      return false
    }
  }, [])

  const updateLocal = useCallback((patch: Partial<ReminderSettings>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current))
  }, [])

  const runPreview = useCallback(
    async (kind: ReminderKind) => {
      setBusy(true)
      try {
        const result = await previewReminderApi(kind)
        if (result.ok) {
          toast.success(`已发送「${KIND_LABELS[kind]}」样例：${result.title ?? ''}`)
        } else {
          toast.error(`发送失败：${result.error || '未知原因'}`)
        }
      } catch {
        toast.error('发送失败，请检查网络')
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const handleTest = useCallback(async () => {
    setBusy(true)
    try {
      if (keyDraft.trim()) {
        const saved = await persist({ bark_key: keyDraft.trim() })
        if (!saved) return
        setKeyDraft('')
      }
      const result = await sendTestReminderApi()
      if (result.ok) {
        toast.success('测试通知已发出，看看手机')
      } else {
        toast.error(`发送失败：${result.error || '未知原因'}`)
      }
      await load()
    } catch {
      toast.error('发送失败，请检查网络')
    } finally {
      setBusy(false)
    }
  }, [keyDraft, persist, load])

  if (loading) {
    return (
      <ProfileLayout title="复习提醒" description="到点把今天要复习的数量推到手机上。">
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground">正在读取提醒设置…</CardContent>
        </Card>
      </ProfileLayout>
    )
  }

  if (!draft) {
    return (
      <ProfileLayout title="复习提醒" description="到点把今天要复习的数量推到手机上。">
        <Card>
          <CardContent className="py-10 text-sm text-muted-foreground">
            提醒设置暂时读不到，刷新页面再试一次。
          </CardContent>
        </Card>
      </ProfileLayout>
    )
  }

  const failureWarning = (status?.consecutive_failures ?? 0) >= 3
  const budget = estimateDaily(draft)

  return (
    <ProfileLayout
      title="复习提醒"
      description="通过 Bark 把提醒推到 iPhone。时间与频率随时可改，改完立即生效。"
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Smartphone className="size-4" /> 推送通道
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Row title="启用提醒" description="关闭后不会发出任何通知，设置保留。">
              <Switch
                aria-label="启用提醒"
                checked={draft.enabled}
                onCheckedChange={(checked) => {
                  updateLocal({ enabled: checked })
                  void persist({ enabled: checked })
                }}
              />
            </Row>
            <Row
              title="Bark 推送地址"
              description={
                draft.bark_configured
                  ? `已配置：${draft.bark_key_masked}。粘贴新的地址或 Key 可替换。`
                  : '在 iPhone 的 Bark App 首页复制那条 api.day.app 地址，整条粘进来即可。'
              }
            >
              <div className="flex flex-col items-end gap-2">
                <Input
                  aria-label="Bark 推送地址"
                  className="w-64"
                  placeholder={draft.bark_configured ? draft.bark_key_masked : 'https://api.day.app/...'}
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  onBlur={() => {
                    const value = keyDraft.trim()
                    if (!value) return
                    void persist({ bark_key: value }).then((ok) => {
                      if (ok) {
                        setKeyDraft('')
                        toast.success('推送地址已保存')
                      }
                    })
                  }}
                />
                <div className="flex gap-2">
                  {draft.bark_configured ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void persist({ bark_key: '' }).then((ok) => {
                          if (ok) toast.success('已清除 Bark 推送地址')
                        })
                      }}
                    >
                      <Eraser className="size-4" /> 清除
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleTest()}
                  >
                    <Send className="size-4" /> {busy ? '发送中…' : '发送测试通知'}
                  </Button>
                </div>
              </div>
            </Row>
            <Row
              title="通知图标"
              description="通知左侧的小图标。图标是手机自己下载的，所以填本机的 Tailscale 地址就行；Tailscale 关着或电脑关机时会退回 Bark 默认图标。留空则一直用默认图标。"
            >
              <Input
                aria-label="通知图标地址"
                className="w-64"
                placeholder="https://example.com/icon.png"
                value={draft.icon_url}
                onChange={(event) => updateLocal({ icon_url: event.target.value })}
                onBlur={(event) => void persist({ icon_url: event.target.value })}
              />
            </Row>
            {failureWarning ? (
              <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                最近连续 {status?.consecutive_failures} 次发送失败，Bark Key 可能已失效，请重新复制一次地址。
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="size-4" /> 每日两次
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Row
              title="早上概览"
              description="今天到期多少、昨天复习了多少。电脑关机错过后，12:00 前开机仍会补发。"
            >
              <Input
                aria-label="早上概览时间"
                type="time"
                className="w-28"
                value={draft.morning_time}
                disabled={!draft.morning_enabled}
                onChange={(event) => updateLocal({ morning_time: event.target.value })}
                onBlur={(event) => void persist({ morning_time: event.target.value })}
              />
              <Switch
                aria-label="启用早上概览"
                checked={draft.morning_enabled}
                onCheckedChange={(checked) => {
                  updateLocal({ morning_enabled: checked })
                  void persist({ morning_enabled: checked })
                }}
              />
              <PreviewButton kind="morning" onPreview={runPreview} busy={busy} />
            </Row>
            <Row
              title="晚上催促"
              description="只有当今天一张都没复习时才发；学过了就不打扰。23:00 前开机仍会补发。"
            >
              <Input
                aria-label="晚上催促时间"
                type="time"
                className="w-28"
                value={draft.evening_time}
                disabled={!draft.evening_enabled}
                onChange={(event) => updateLocal({ evening_time: event.target.value })}
                onBlur={(event) => void persist({ evening_time: event.target.value })}
              />
              <Switch
                aria-label="启用晚上催促"
                checked={draft.evening_enabled}
                onCheckedChange={(checked) => {
                  updateLocal({ evening_enabled: checked })
                  void persist({ evening_enabled: checked })
                }}
              />
              <PreviewButton kind="evening" onPreview={runPreview} busy={busy} />
            </Row>
            <Row title="到期阈值" description="到期少于这个数的那天不发早上那条。0 表示不限制。">
              <Input
                aria-label="到期阈值"
                type="number"
                min={0}
                max={5000}
                className="w-24"
                value={draft.due_threshold}
                onChange={(event) =>
                  updateLocal({ due_threshold: Number(event.target.value) || 0 })
                }
                onBlur={(event) => void persist({ due_threshold: Number(event.target.value) || 0 })}
              />
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Hourglass className="size-4" /> 闲置拉回
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Row
              title="停下来就叫你"
              description="评分、编辑脑图、或者只是点屏幕都算动作；停下来超过设定时长后才提醒，之后按间隔重复，直到你重新动手。"
            >
              <Switch
                aria-label="启用闲置拉回"
                checked={draft.idle_enabled}
                onCheckedChange={(checked) => {
                  updateLocal({ idle_enabled: checked })
                  void persist({ idle_enabled: checked })
                }}
              />
              <PreviewButton kind="idle" onPreview={runPreview} busy={busy} />
            </Row>
            <Row title="多久算停下" description="最后一次评分 / 保存脑图之后过多久开始提醒。">
              <Input
                aria-label="闲置阈值分钟"
                type="number"
                min={5}
                max={720}
                className="w-24"
                value={draft.idle_after_minutes}
                disabled={!draft.idle_enabled}
                onChange={(event) =>
                  updateLocal({ idle_after_minutes: Number(event.target.value) || 60 })
                }
                onBlur={(event) =>
                  void persist({ idle_after_minutes: Number(event.target.value) || 60 })
                }
              />
              <span className="text-sm text-muted-foreground">分钟</span>
            </Row>
            <Row title="升级间隔" description="没回来就按这个间隔继续提醒。">
              <Input
                aria-label="闲置重复间隔分钟"
                type="number"
                min={1}
                max={240}
                className="w-24"
                value={draft.idle_repeat_minutes}
                disabled={!draft.idle_enabled}
                onChange={(event) =>
                  updateLocal({ idle_repeat_minutes: Number(event.target.value) || 5 })
                }
                onBlur={(event) =>
                  void persist({ idle_repeat_minutes: Number(event.target.value) || 5 })
                }
              />
              <span className="text-sm text-muted-foreground">分钟</span>
            </Row>
            <Row title="最多提醒几次" description="0 表示直到你回来为止，不设上限。">
              <Input
                aria-label="闲置最多提醒次数"
                type="number"
                min={0}
                max={99}
                className="w-24"
                value={draft.idle_max_repeats}
                disabled={!draft.idle_enabled}
                onChange={(event) =>
                  updateLocal({ idle_max_repeats: Number(event.target.value) || 0 })
                }
                onBlur={(event) =>
                  void persist({ idle_max_repeats: Number(event.target.value) || 0 })
                }
              />
              <span className="text-sm text-muted-foreground">次</span>
            </Row>
            <Row
              title="只在今天动过之后盯防"
              description="关掉后，今天一次都没打开也会开始计时（会和早上/晚上概览重复）。"
            >
              <Switch
                aria-label="只在今天动过之后盯防"
                checked={draft.idle_requires_activity_today}
                onCheckedChange={(checked) => {
                  updateLocal({ idle_requires_activity_today: checked })
                  void persist({ idle_requires_activity_today: checked })
                }}
              />
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="size-4" /> 到期就绪
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Row
              title="有新卡片放出来就叫你"
              description="10 分钟台阶到点、跨天复活的单元进入队列时提醒；你自己导入或新建产生的不算。"
            >
              <Switch
                aria-label="启用到期就绪"
                checked={draft.ready_enabled}
                onCheckedChange={(checked) => {
                  updateLocal({ ready_enabled: checked })
                  void persist({ ready_enabled: checked })
                }}
              />
              <PreviewButton kind="ready" onPreview={runPreview} busy={busy} />
            </Row>
            <Row title="攒够多少张才提醒" description="太少就没必要打断你。">
              <Input
                aria-label="到期就绪最少张数"
                type="number"
                min={1}
                max={200}
                className="w-24"
                value={draft.ready_min_units}
                disabled={!draft.ready_enabled}
                onChange={(event) =>
                  updateLocal({ ready_min_units: Number(event.target.value) || 5 })
                }
                onBlur={(event) =>
                  void persist({ ready_min_units: Number(event.target.value) || 5 })
                }
              />
              <span className="text-sm text-muted-foreground">张</span>
            </Row>
            <Row title="两条之间至少隔" description="防止台阶一颗一颗到点时连环推送。">
              <Input
                aria-label="到期就绪最小间隔分钟"
                type="number"
                min={1}
                max={240}
                className="w-24"
                value={draft.ready_min_gap_minutes}
                disabled={!draft.ready_enabled}
                onChange={(event) =>
                  updateLocal({ ready_min_gap_minutes: Number(event.target.value) || 15 })
                }
                onBlur={(event) =>
                  void persist({ ready_min_gap_minutes: Number(event.target.value) || 15 })
                }
              />
              <span className="text-sm text-muted-foreground">分钟</span>
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4" /> 整点小结
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Row
              title="每个整点报一次进度"
              description="先说你已经完成的：今天累计多少张、这一小时多少张、连续第几天。"
            >
              <Switch
                aria-label="启用整点小结"
                checked={draft.hourly_enabled}
                onCheckedChange={(checked) => {
                  updateLocal({ hourly_enabled: checked })
                  void persist({ hourly_enabled: checked })
                }}
              />
              <PreviewButton kind="hourly" onPreview={runPreview} busy={busy} />
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">免打扰与上限</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <Row
              title="免打扰时段"
              description="这段时间内任何通知都不发。0:00–8:00 属于前一天的学习日，默认就安静。"
            >
              <select
                aria-label="免打扰开始小时"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                value={draft.quiet_start_hour}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  updateLocal({ quiet_start_hour: value })
                  void persist({ quiet_start_hour: value })
                }}
              >
                {hourOptions().map((hour) => (
                  <option key={hour} value={hour}>
                    {pad(hour)}:00
                  </option>
                ))}
              </select>
              <span className="text-sm text-muted-foreground">到</span>
              <select
                aria-label="免打扰结束小时"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                value={draft.quiet_end_hour}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  updateLocal({ quiet_end_hour: value })
                  void persist({ quiet_end_hour: value })
                }}
              >
                {hourOptions().map((hour) => (
                  <option key={hour} value={hour}>
                    {pad(hour)}:00
                  </option>
                ))}
              </select>
            </Row>
            <Row
              title="每天最多几条"
              description="到了上限就静默到第二天。0 表示不限制。"
            >
              <Input
                aria-label="每日条数上限"
                type="number"
                min={0}
                max={500}
                className="w-24"
                value={draft.daily_cap}
                onChange={(event) =>
                  updateLocal({ daily_cap: Number(event.target.value) || 0 })
                }
                onBlur={(event) => void persist({ daily_cap: Number(event.target.value) || 0 })}
              />
            </Row>
            <div
              className={cn(
                'mt-3 rounded-lg px-3 py-2 text-sm leading-6',
                budget.estimate > 20
                  ? 'border border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300'
                  : 'bg-muted/40 text-muted-foreground',
              )}
            >
              按当前设置，今天最多还会收到 <strong>{budget.estimate}</strong> 条
              {budget.cappedBy ? `（已被每日上限 ${budget.cappedBy} 条截住）` : ''}。
              上限不是吓唬你：闲置每 5 分钟一次，一个上午就能刷出一百条。
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">通知内容</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-0 sm:grid-cols-2">
            {CONTENT_OPTIONS.map((option) => {
              const active = draft.content_mode === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    updateLocal({ content_mode: option.value })
                    void persist({ content_mode: option.value })
                  }}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-colors',
                    active
                      ? 'border-primary bg-primary/5'
                      : 'border-border/70 hover:bg-accent/60',
                  )}
                >
                  <div className="text-sm font-semibold text-foreground">{option.title}</div>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">
                    {option.description}
                  </p>
                </button>
              )
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">当前状态</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pt-0 text-sm text-muted-foreground">
            <div>
              下次提醒：
              {status?.next_at
                ? `${formatReminderMoment(status.next_at)}（${SLOT_LABELS[status.next_slot ?? 'morning']}）`
                : '未计划'}
            </div>
            <div>
              今天已发：{status?.sent_today ?? 0} 条
              {status?.daily_cap ? ` / 上限 ${status.daily_cap}` : ''}
            </div>
            <div>
              最近一次：
              {status?.last_delivery
                ? `${formatReminderMoment(status.last_delivery.at)}（${status.last_delivery.slot}）· ${
                    status.last_delivery.status === 'sent'
                      ? '已送达'
                      : `失败：${status.last_delivery.error || '未知原因'}`
                  }`
                : '还没有发送过'}
            </div>
            <div className="rounded-lg bg-muted/40 px-3 py-2 leading-6">
              提醒由电脑上的 Memory Anki 服务发出：电脑关机或服务没启动时不会推送，重新开机后只有早上/晚上两条会补发。
              高频提醒错过就错过——补一条「你一小时没操作了」没有意义。
            </div>
          </CardContent>
        </Card>
      </div>
    </ProfileLayout>
  )
}
