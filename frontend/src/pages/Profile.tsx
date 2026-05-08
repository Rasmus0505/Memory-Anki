import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Download, FileJson, FileText, HardDriveDownload, History, RotateCcw, Settings, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  formatCompletionMethod,
  formatDuration,
  formatSessionKind,
  groupTimeRecordsByDate,
  readTimeRecords,
} from '@/lib/session-records'

function ProfileNav() {
  const location = useLocation()
  const currentPath = location.pathname

  const items = [
    { href: '/profile', label: '复习配置与导入导出', icon: Settings },
    { href: '/profile/time-records', label: '时间记录', icon: History },
    { href: '/profile/backups', label: '备份与恢复', icon: HardDriveDownload },
  ]

  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ href, label, icon: Icon }) => {
        const active = currentPath === href
        return (
          <Link key={href} to={href}>
            <Button variant={active ? 'default' : 'outline'} size="sm">
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </Button>
          </Link>
        )
      })}
    </div>
  )
}

export function ProfileSettingsPage() {
  const [tab, setTab] = useState<'config' | 'io'>('config')
  const [config, setConfig] = useState<any>(null)
  const [algorithm, setAlgorithm] = useState('ebbinghaus')
  const [importResult, setImportResult] = useState<string | null>(null)

  useEffect(() => {
    api.getReviewSettings().then((settings) => {
      setConfig(settings)
      setAlgorithm(settings.default_algorithm)
    })
  }, [])

  const handleSaveConfig = async (event: React.FormEvent) => {
    event.preventDefault()
    const form = event.target as HTMLFormElement
    const formData = new FormData(form)
    const data: Record<string, string> = {}
    formData.forEach((value, key) => {
      data[key] = value as string
    })
    data.default_algorithm = algorithm
    data.auto_smooth_overdue = formData.get('auto_smooth_overdue') ? 'true' : 'false'
    data.early_review_anchor = formData.get('early_review_anchor') ? 'true' : 'false'
    const nextConfig = await api.updateReviewSettings(data)
    setConfig(nextConfig)
    setAlgorithm(nextConfig.default_algorithm)
    toast.success('复习高级配置已保存')
  }

  const handleImport = async (event: React.FormEvent) => {
    event.preventDefault()
    const form = event.target as HTMLFormElement
    const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0]
    const format = (form.elements.namedItem('format') as HTMLSelectElement).value
    if (!file) return
    const result = await api.importFile(file, format)
    if (result.ok) {
      toast.success(`成功导入 ${result.count} 个宫殿`)
      setImportResult(null)
    } else {
      setImportResult(`导入失败: ${result.error}`)
    }
  }

  if (!config) {
    return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">Loading...</div>
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">个人中心</h1>
        </div>
        <ProfileNav />
      </div>

      <div className="flex gap-1 border-b">
        {[
          { key: 'config', label: '复习配置', icon: Settings },
          { key: 'io', label: '导入导出', icon: Download },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key as 'config' | 'io')}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'config' ? (
        <form onSubmit={handleSaveConfig} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">高级排程策略</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {[
                  { key: 'ebbinghaus', title: '按顺序写复习点', desc: '按 1小时、睡前、1天、x天 这样往后排。' },
                  { key: 'custom', title: '只写天数间隔', desc: '完全按你自己填的天数顺序运行。' },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setAlgorithm(item.key)}
                    className={`rounded-lg border p-4 text-left transition-all active:scale-[0.97] ${
                      algorithm === item.key ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-secondary'
                    }`}
                  >
                    <div className="text-sm font-semibold">{item.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.desc}</div>
                  </button>
                ))}
              </div>

              {algorithm === 'custom' ? (
                <div className="space-y-2">
                  <Label htmlFor="custom-intervals">按天数写，例如 1天、2天、7天</Label>
                  <Input id="custom-intervals" name="custom_intervals" defaultValue={config.custom_intervals} placeholder="1,2,4,7,15,30,60" />
                </div>
              ) : null}

              {algorithm === 'ebbinghaus' ? (
                <div className="space-y-2">
                  <Label htmlFor="ebbinghaus-intervals">按这个顺序写：1小时，睡前，1天，x天</Label>
                  <Input
                    id="ebbinghaus-intervals"
                    name="ebbinghaus_intervals"
                    defaultValue={config.ebbinghaus_intervals}
                    placeholder="1h,sleep,1,2,4,7,15,30,60"
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">会话与积压</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="sleep-review-time">睡前复习时间</Label>
                  <Input id="sleep-review-time" name="sleep_review_time" defaultValue={config.sleep_review_time || '22:00'} type="time" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="daily-max">每日正式复习上限</Label>
                  <Input id="daily-max" name="daily_max_reviews" defaultValue={config.daily_max_reviews || '0'} type="number" min="0" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="overdue-days">逾期平滑窗口天数</Label>
                  <Input id="overdue-days" name="overdue_smoothing_days" defaultValue={config.overdue_smoothing_days || '7'} type="number" min="1" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="overdue-threshold">触发自动平滑的逾期阈值</Label>
                <Input id="overdue-threshold" name="overdue_smoothing_threshold" defaultValue={config.overdue_smoothing_threshold || '5'} type="number" min="0" />
              </div>

              <div className="rounded-lg border p-4">
                <label className="flex items-start gap-3">
                  <input type="checkbox" name="auto_smooth_overdue" defaultChecked={config.auto_smooth_overdue === 'true'} className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium">默认自动平滑逾期任务</div>
                    <div className="mt-1 text-xs text-muted-foreground">进入复习总览前先自动分散逾期任务，减少单日压死的情况。</div>
                  </div>
                </label>
              </div>

              <div className="rounded-lg border p-4">
                <label className="flex items-start gap-3">
                  <input type="checkbox" name="early_review_anchor" defaultChecked={config.early_review_anchor === 'true'} className="mt-0.5" />
                  <div>
                    <div className="text-sm font-medium">提前复习锚定策略</div>
                    <div className="mt-1 text-xs text-muted-foreground">启用后，提前复习不会缩短后续间隔，下次仍从原计划日继续计算。</div>
                  </div>
                </label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">算法切换策略</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {[
                  { value: 'future_only', title: '仅影响新宫殿', desc: '已有未完成计划保持不变。' },
                  { value: 'all', title: '重建所有待复习计划', desc: '删除并按新算法重建所有未完成 schedule。' },
                ].map((option) => (
                  <label key={option.value} className="flex items-start gap-3 rounded-lg border p-4">
                    <input
                      type="radio"
                      name="algorithm_change_scope"
                      value={option.value}
                      defaultChecked={config.algorithm_change_scope === option.value}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium">{option.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{option.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="apply_to_pending" value="all" />
                  <span className="text-sm font-medium">保存时立即应用到所有未完成计划</span>
                </label>
                <p className="mt-2 text-xs text-amber-700">勾选后会删除当前待复习 schedule，再按新算法重建。</p>
              </div>
            </CardContent>
          </Card>

          <Button type="submit">保存复习配置</Button>
        </form>
      ) : (
        <div className="space-y-6">
          {importResult ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{importResult}</div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Download className="h-4 w-4" />
                  导出
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <a href={api.exportJson()} className="flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-secondary">
                  <FileJson className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="font-medium">JSON 导出/迁移</div>
                  </div>
                </a>
                <a href={api.exportMarkdown()} className="flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-secondary">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="font-medium">Markdown 导出/迁移</div>
                  </div>
                </a>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Upload className="h-4 w-4" />
                  导入
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleImport} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">文件格式</label>
                    <select name="format" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                      <option value="json">JSON</option>
                      <option value="markdown">Markdown</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">选择文件</label>
                    <input
                      type="file"
                      name="file"
                      required
                      className="w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-secondary/80"
                    />
                  </div>
                  <Button type="submit" className="w-full">
                    <Upload className="h-4 w-4" />
                    开始导入
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

export function ProfileTimeRecordsPage() {
  const records = useMemo(() => readTimeRecords(), [])
  const grouped = useMemo(() => groupTimeRecordsByDate(records), [records])
  const dates = Object.keys(grouped).sort((left, right) => right.localeCompare(left))

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">时间记录</h1>
        </div>
        <ProfileNav />
      </div>

      {dates.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            还没有可展示的时间记录。
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {dates.map((dateKey) => (
            <Card key={dateKey}>
              <CardHeader>
                <CardTitle className="text-base">{dateKey}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {grouped[dateKey].map((record) => (
                  <div key={record.id} className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{record.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatSessionKind(record.kind)} · {new Date(record.startedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground">
                        <div>有效时长：{formatDuration(record.effectiveSeconds)}</div>
                        <div>暂停次数：{record.pauseCount}</div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-border/70 px-2 py-1">{formatCompletionMethod(record.completionMethod)}</span>
                      <span className="rounded-full border border-border/70 px-2 py-1">
                        {record.durationEdited ? '已补录总时长' : '未补录'}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProfileBackupsPage() {
  const [backups, setBackups] = useState<Array<{
    kind: 'full' | 'rescue'
    name: string
    path: string
    created_at: string
    reason: string
    has_database: boolean
    has_attachments: boolean
  }>>([])
  const [loading, setLoading] = useState(true)

  const loadBackups = async () => {
    setLoading(true)
    try {
      const result = await api.getBackups()
      setBackups(result.items)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadBackups()
  }, [])

  const handleCreateBackup = async () => {
    const result = await api.createBackup('manual')
    toast.success(`已创建整库备份：${result.path}`)
    await loadBackups()
  }

  const handleRestoreBackup = async (path: string) => {
    const confirmed = window.confirm('整库恢复会先自动生成事故快照，再把数据库和附件回到目标备份。确定继续吗？')
    if (!confirmed) return
    const result = await api.restoreBackup(path)
    toast.success(`整库恢复完成，事故快照已保存到：${result.rescue_path}`)
    await loadBackups()
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">备份与恢复</h1>
        </div>
        <ProfileNav />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">整库备份</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            主库仍然是 SQLite。这里提供项目内整库快照和事故快照，用于快速回滚数据库与附件。
          </div>
          <Button onClick={() => void handleCreateBackup()}>
            <HardDriveDownload className="mr-2 h-4 w-4" />
            立即备份
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">备份列表</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="py-6 text-sm text-muted-foreground">正在读取备份列表…</div>
          ) : backups.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">当前还没有可用备份。</div>
          ) : (
            backups.map((backup) => (
              <div key={backup.path} className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{backup.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {backup.kind === 'full' ? '整库备份' : '事故快照'} · {backup.created_at}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground break-all">{backup.path}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {backup.kind === 'full' ? (
                      <Button variant="outline" size="sm" onClick={() => void handleRestoreBackup(backup.path)}>
                        <RotateCcw className="mr-2 h-4 w-4" />
                        整库恢复
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function Profile() {
  return <ProfileSettingsPage />
}
