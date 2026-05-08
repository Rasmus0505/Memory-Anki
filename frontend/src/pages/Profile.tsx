import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Download,
  FileJson,
  FileText,
  HardDriveDownload,
  History,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createTimeRecord,
  formatCompletionMethod,
  formatDuration,
  formatSessionKind,
  getTimeRecordingThresholdSeconds,
  getDailyTrend,
  getSessionKindBreakdown,
  getTimeRecordSummary,
  isTimeRecordAboveThreshold,
  listTimeRecords,
  restoreTimeRecord,
  setTimeRecordingThresholdSeconds,
  softDeleteTimeRecord,
  type SessionCompletionMethod,
  type SessionKind,
  type TimeSessionRecord,
  updateTimeRecord,
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

const sessionKindOptions: SessionKind[] = ['review', 'practice', 'palace_edit']
const completionMethodOptions: SessionCompletionMethod[] = ['manual_complete', 'auto_complete', 'restart', 'left_page', 'saved']

interface TimeRecordFormState {
  id?: string
  title: string
  kind: SessionKind
  palaceId: string
  startedAt: string
  endedAt: string
  effectiveSeconds: string
  pauseCount: string
  completionMethod: SessionCompletionMethod
  durationEdited: boolean
}

function toLocalDateTimeInputValue(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16)
}

function formatTableDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function formatTableTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function buildTimeRecordFormState(record?: TimeSessionRecord | null): TimeRecordFormState {
  return {
    id: record?.id,
    title: record?.title ?? '',
    kind: record?.kind ?? 'review',
    palaceId: record?.palaceId == null ? '' : String(record.palaceId),
    startedAt: record ? toLocalDateTimeInputValue(record.startedAt) : '',
    endedAt: record ? toLocalDateTimeInputValue(record.endedAt) : '',
    effectiveSeconds: record ? String(record.effectiveSeconds) : '0',
    pauseCount: record ? String(record.pauseCount) : '0',
    completionMethod: record?.completionMethod ?? 'manual_complete',
    durationEdited: record?.durationEdited ?? false,
  }
}

function parseTimeRecordFormState(form: TimeRecordFormState, sourceRecord?: TimeSessionRecord | null) {
  const title = form.title.trim()
  const startedAt = form.startedAt ? new Date(form.startedAt) : null
  const endedAt = form.endedAt ? new Date(form.endedAt) : null
  const effectiveSeconds = Number(form.effectiveSeconds)
  const pauseCount = Number(form.pauseCount)
  const palaceId = form.palaceId.trim() === '' ? null : Number(form.palaceId)

  if (!title) return { error: '标题不能为空。' as const }
  if (!startedAt || Number.isNaN(startedAt.getTime())) return { error: '开始时间不能为空。' as const }
  if (!endedAt || Number.isNaN(endedAt.getTime())) return { error: '结束时间不能为空。' as const }
  if (endedAt < startedAt) return { error: '结束时间不能早于开始时间。' as const }
  if (Number.isNaN(effectiveSeconds) || effectiveSeconds < 0) return { error: '有效时长必须是大于等于 0 的数字。' as const }
  if (Number.isNaN(pauseCount) || pauseCount < 0) return { error: '暂停次数必须是大于等于 0 的数字。' as const }
  if (palaceId != null && Number.isNaN(palaceId)) return { error: '宫殿 ID 必须是数字。' as const }

  const durationChanged = sourceRecord ? sourceRecord.effectiveSeconds !== effectiveSeconds : effectiveSeconds > 0

  return {
    value: {
      title,
      kind: form.kind,
      palaceId,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      effectiveSeconds,
      pauseCount,
      completionMethod: form.completionMethod,
      durationEdited: form.durationEdited || durationChanged,
    },
  }
}

function TimeRecordDialog({
  open,
  mode,
  form,
  error,
  onOpenChange,
  onChange,
  onSubmit,
}: {
  open: boolean
  mode: 'create' | 'edit'
  form: TimeRecordFormState
  error: string | null
  onOpenChange: (open: boolean) => void
  onChange: (patch: Partial<TimeRecordFormState>) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-[28px] border-border/70 bg-background/98 p-0">
        <DialogHeader>
          <div>
            <DialogTitle>{mode === 'create' ? '手动新增记录' : '编辑时间记录'}</DialogTitle>
            <div className="text-sm text-muted-foreground">
              {mode === 'create' ? '补录一条手动时间记录。' : '修改后会同步更新图表与统计。'}
            </div>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5 p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <Label>标题</Label>
              <Input value={form.title} onChange={(event) => onChange({ title: event.target.value })} />
            </label>

            <label className="space-y-2">
              <Label>类型</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.kind}
                onChange={(event) => onChange({ kind: event.target.value as SessionKind })}
              >
                {sessionKindOptions.map((kind) => (
                  <option key={kind} value={kind}>
                    {formatSessionKind(kind)}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <Label>开始时间</Label>
              <Input type="datetime-local" value={form.startedAt} onChange={(event) => onChange({ startedAt: event.target.value })} />
            </label>

            <label className="space-y-2">
              <Label>结束时间</Label>
              <Input type="datetime-local" value={form.endedAt} onChange={(event) => onChange({ endedAt: event.target.value })} />
            </label>

            <label className="space-y-2">
              <Label>有效时长（秒）</Label>
              <Input type="number" min="0" value={form.effectiveSeconds} onChange={(event) => onChange({ effectiveSeconds: event.target.value })} />
            </label>

            <label className="space-y-2">
              <Label>暂停次数</Label>
              <Input type="number" min="0" value={form.pauseCount} onChange={(event) => onChange({ pauseCount: event.target.value })} />
            </label>

            <label className="space-y-2">
              <Label>完成方式</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.completionMethod}
                onChange={(event) => onChange({ completionMethod: event.target.value as SessionCompletionMethod })}
              >
                {completionMethodOptions.map((method) => (
                  <option key={method} value={method}>
                    {formatCompletionMethod(method)}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <Label>宫殿 ID（可选）</Label>
              <Input value={form.palaceId} onChange={(event) => onChange({ palaceId: event.target.value })} />
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={form.durationEdited}
              onChange={(event) => onChange({ durationEdited: event.target.checked })}
            />
            标记为“已补录总时长”
          </label>

          {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">{mode === 'create' ? '新增记录' : '保存修改'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ProfileTimeRecordsPage() {
  const [records, setRecords] = useState<TimeSessionRecord[]>([])
  const [thresholdSeconds, setThresholdSeconds] = useState(() => getTimeRecordingThresholdSeconds())
  const [thresholdInput, setThresholdInput] = useState(() => String(getTimeRecordingThresholdSeconds()))
  const [showDeleted, setShowDeleted] = useState(false)
  const [kindFilter, setKindFilter] = useState<'all' | SessionKind>('all')
  const [keyword, setKeyword] = useState('')
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([])
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<TimeSessionRecord | null>(null)
  const [formState, setFormState] = useState<TimeRecordFormState>(() => buildTimeRecordFormState())
  const [formError, setFormError] = useState<string | null>(null)

  const refreshRecords = () => {
    setRecords(listTimeRecords({ includeDeleted: true }))
  }

  useEffect(() => {
    refreshRecords()
  }, [])

  const applyThreshold = () => {
    const parsed = Number(thresholdInput)
    const safeThreshold = setTimeRecordingThresholdSeconds(Number.isNaN(parsed) || parsed < 0 ? 0 : parsed)
    setThresholdSeconds(safeThreshold)
    setThresholdInput(String(safeThreshold))
    toast.success(`记录阈值已更新为 ${safeThreshold} 秒`)
    refreshRecords()
  }

  const summary = useMemo(() => getTimeRecordSummary(records), [records])
  const trend = useMemo(() => getDailyTrend(records, 7), [records])
  const breakdown = useMemo(() => getSessionKindBreakdown(records), [records])

  const visibleRecords = useMemo(() => {
    return records.filter((record) => {
      if (!showDeleted && record.deletedAt) return false
      if (kindFilter !== 'all' && record.kind !== kindFilter) return false
      if (keyword.trim() && !record.title.toLowerCase().includes(keyword.trim().toLowerCase())) return false
      return true
    })
  }, [kindFilter, keyword, records, showDeleted])

  const selectableRecords = useMemo(() => visibleRecords.filter((record) => !record.deletedAt), [visibleRecords])
  const selectableRecordIds = useMemo(() => selectableRecords.map((record) => record.id), [selectableRecords])
  const hasSelectableRecords = selectableRecordIds.length > 0
  const selectedVisibleCount = selectableRecordIds.filter((id) => selectedRecordIds.includes(id)).length
  const allSelectableChecked = hasSelectableRecords && selectedVisibleCount === selectableRecordIds.length

  const chartConfig: ChartConfig = {
    seconds: { label: '有效时长', color: '#2563eb' },
    review: { label: '正式复习', color: '#0f172a' },
    practice: { label: '练习', color: '#0f766e' },
    palace_edit: { label: '宫殿编辑', color: '#c2410c' },
  }

  const openCreateDialog = () => {
    setDialogMode('create')
    setEditingRecord(null)
    setFormState(buildTimeRecordFormState())
    setFormError(null)
    setDialogOpen(true)
  }

  const openEditDialog = (record: TimeSessionRecord) => {
    setDialogMode('edit')
    setEditingRecord(record)
    setFormState(buildTimeRecordFormState(record))
    setFormError(null)
    setDialogOpen(true)
  }

  const handleSubmitRecord = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = parseTimeRecordFormState(formState, editingRecord)
    if ('error' in parsed) {
      setFormError(parsed.error ?? '表单校验失败。')
      return
    }
    if (!isTimeRecordAboveThreshold(parsed.value.effectiveSeconds, thresholdSeconds)) {
      setFormError(`有效时长必须大于 ${thresholdSeconds} 秒，才会进入时间记录。`)
      return
    }

    if (dialogMode === 'create') {
      const created = createTimeRecord({
        ...parsed.value,
        deletedAt: null,
        deletedReason: null,
        events: [],
      })
      if (!created) {
        setFormError(`有效时长必须大于 ${thresholdSeconds} 秒，才会进入时间记录。`)
        return
      }
      toast.success('时间记录已新增')
    } else if (editingRecord) {
      updateTimeRecord(editingRecord.id, parsed.value)
      toast.success('时间记录已更新')
    }

    setDialogOpen(false)
    refreshRecords()
  }

  const handleDeleteRecord = (record: TimeSessionRecord) => {
    if (!window.confirm(`确定删除“${record.title}”吗？你之后仍可以在“显示已删除”中恢复。`)) return
    softDeleteTimeRecord(record.id)
    setSelectedRecordIds((current) => current.filter((id) => id !== record.id))
    toast.success('时间记录已移入已删除')
    refreshRecords()
  }

  const handleRestoreRecord = (record: TimeSessionRecord) => {
    restoreTimeRecord(record.id)
    toast.success('时间记录已恢复')
    refreshRecords()
  }

  const toggleRecordSelection = (recordId: string, checked: boolean) => {
    setSelectedRecordIds((current) => {
      if (checked) {
        return current.includes(recordId) ? current : [...current, recordId]
      }
      return current.filter((id) => id !== recordId)
    })
  }

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedRecordIds((current) => {
      if (!checked) {
        return current.filter((id) => !selectableRecordIds.includes(id))
      }
      return Array.from(new Set([...current, ...selectableRecordIds]))
    })
  }

  const handleBulkDelete = () => {
    const targets = records.filter((record) => selectedRecordIds.includes(record.id) && !record.deletedAt)
    if (targets.length === 0) return
    if (!window.confirm(`确定批量删除所选的 ${targets.length} 条记录吗？你之后仍可以在“显示已删除”中恢复。`)) return

    targets.forEach((record) => {
      softDeleteTimeRecord(record.id)
    })
    setSelectedRecordIds([])
    toast.success(`已移入已删除：${targets.length} 条记录`)
    refreshRecords()
  }

  useEffect(() => {
    setSelectedRecordIds((current) => current.filter((id) => records.some((record) => record.id === id && !record.deletedAt)))
  }, [records])

  useEffect(() => {
    setSelectedRecordIds((current) => current.filter((id) => visibleRecords.some((record) => record.id === id && !record.deletedAt)))
  }, [visibleRecords])

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="rounded-[28px] border border-border/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(239,246,255,0.92))] p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">时间记录</h1>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">总记录数</div>
                <div className="mt-2 text-2xl font-semibold text-slate-950">{summary.totalRecords}</div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-3">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">累计有效时长</div>
                <div className="mt-2 text-2xl font-semibold text-slate-950">{formatDuration(summary.totalEffectiveSeconds)}</div>
              </div>
            </div>
          </div>
        </div>
        <ProfileNav />
      </div>

      <div className="space-y-6">
        <Card className="rounded-[28px] border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">最近 7 天趋势</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[320px] rounded-[24px] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.7))] p-4">
              <ChartContainer config={chartConfig} className="h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ left: 8, right: 16, top: 16, bottom: 8 }}>
                    <defs>
                      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-seconds)" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="var(--color-seconds)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
                    <YAxis tickLine={false} axisLine={false} tickMargin={12} width={60} tickFormatter={(value) => formatDuration(Number(value ?? 0))} />
                    <Tooltip cursor={{ stroke: 'rgba(37,99,235,0.18)', strokeWidth: 1 }} content={<ChartTooltipContent formatter={(value) => formatDuration(value)} />} />
                    <Area type="monotone" dataKey="seconds" name="有效时长" stroke="var(--color-seconds)" strokeWidth={2.5} fill="url(#trendFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">会话类型分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="h-[320px] rounded-[24px] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.7))] p-4">
              <ChartContainer config={chartConfig} className="h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={breakdown} margin={{ left: 8, right: 16, top: 16, bottom: 8 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} />
                    <YAxis tickLine={false} axisLine={false} tickMargin={12} width={60} tickFormatter={(value) => formatDuration(Number(value ?? 0))} />
                    <Tooltip cursor={{ fill: 'rgba(148,163,184,0.08)' }} content={<ChartTooltipContent formatter={(value) => formatDuration(value)} />} />
                    <Bar dataKey="seconds" name="有效时长" radius={[12, 12, 6, 6]}>
                      {breakdown.map((entry) => (
                        <Cell key={entry.kind} fill={getChartColor(entry.kind)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {breakdown.map((entry) => (
                <div key={entry.kind} className="rounded-2xl border border-border/70 bg-background/80 px-4 py-4">
                  <div className="text-sm font-medium text-slate-900">{entry.label}</div>
                  <div className="mt-2 text-xl font-semibold text-slate-950">{formatDuration(entry.seconds)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{entry.sessions} 条记录</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[28px] border-border/70">
          <CardHeader className="gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="text-lg">时间记录列表</CardTitle>
                <CardDescription>支持筛选、编辑、软删除与恢复。</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm">
                  <span className="text-muted-foreground">记录阈值</span>
                  <Input
                    aria-label="记录阈值（秒）"
                    className="h-8 w-24 border-0 px-0 shadow-none focus-visible:ring-0"
                    type="number"
                    min="0"
                    value={thresholdInput}
                    onChange={(event) => setThresholdInput(event.target.value)}
                    onBlur={applyThreshold}
                  />
                  <span className="text-muted-foreground">秒</span>
                </label>
                <div className="text-xs text-muted-foreground">仅记录超过该时长的会话</div>
                <Button variant="outline" size="sm" onClick={openCreateDialog}>
                  <Plus className="mr-2 h-4 w-4" />
                  手动新增记录
                </Button>
                <Button variant="outline" size="sm" onClick={handleBulkDelete} disabled={selectedRecordIds.length === 0}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  批量删除所选
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
              <Input placeholder="搜索标题" value={keyword} onChange={(event) => setKeyword(event.target.value)} />
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as 'all' | SessionKind)}
              >
                <option value="all">全部类型</option>
                {sessionKindOptions.map((kind) => (
                  <option key={kind} value={kind}>
                    {formatSessionKind(kind)}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm">
                <input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} />
                显示已删除
              </label>
            </div>
          </CardHeader>

          <CardContent>
            {visibleRecords.length === 0 ? (
              <div className="rounded-[24px] border border-dashed border-border/80 py-10 text-center text-sm text-muted-foreground">
                还没有可展示的时间记录。
              </div>
            ) : (
              <div className="overflow-x-auto rounded-[24px] border border-border/70">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="bg-slate-50/80 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">
                        <input
                          aria-label="全选当前记录"
                          type="checkbox"
                          checked={allSelectableChecked}
                          onChange={(event) => toggleSelectAllVisible(event.target.checked)}
                          disabled={!hasSelectableRecords}
                        />
                      </th>
                      <th className="px-4 py-3">标题</th>
                      <th className="px-4 py-3">类型</th>
                      <th className="px-4 py-3">日期</th>
                      <th className="px-4 py-3">开始时间</th>
                      <th className="px-4 py-3">结束时间</th>
                      <th className="px-4 py-3">有效时长</th>
                      <th className="px-4 py-3">暂停次数</th>
                      <th className="px-4 py-3">完成方式</th>
                      <th className="px-4 py-3">补录状态</th>
                      <th className="px-4 py-3">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/80 bg-white">
                    {visibleRecords.map((record) => (
                      <tr key={record.id} className={record.deletedAt ? 'bg-slate-50/70 text-muted-foreground' : ''}>
                        <td className="px-4 py-4 align-top">
                          {!record.deletedAt ? (
                            <input
                              aria-label={`选择记录 ${record.title}`}
                              type="checkbox"
                              checked={selectedRecordIds.includes(record.id)}
                              onChange={(event) => toggleRecordSelection(record.id, event.target.checked)}
                            />
                          ) : null}
                        </td>
                        <td className="px-4 py-4">
                          <div className="min-w-[220px]">
                            <div className={`font-medium ${record.deletedAt ? 'line-through' : 'text-slate-950'}`}>{record.title}</div>
                            {record.deletedAt ? <div className="mt-1 text-xs">已删除，时间 {formatTableDate(record.deletedAt)}</div> : null}
                          </div>
                        </td>
                        <td className="px-4 py-4">{formatSessionKind(record.kind)}</td>
                        <td className="px-4 py-4">{formatTableDate(record.startedAt)}</td>
                        <td className="px-4 py-4">{formatTableTime(record.startedAt)}</td>
                        <td className="px-4 py-4">{formatTableTime(record.endedAt)}</td>
                        <td className="px-4 py-4 font-medium text-slate-950">{formatDuration(record.effectiveSeconds)}</td>
                        <td className="px-4 py-4">{record.pauseCount}</td>
                        <td className="px-4 py-4">{formatCompletionMethod(record.completionMethod)}</td>
                        <td className="px-4 py-4">
                          <Badge variant="outline" className="rounded-full px-3 py-1">
                            {record.durationEdited ? '已补录总时长' : '未补录'}
                          </Badge>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-2">
                            {!record.deletedAt ? (
                              <>
                                <Button size="sm" variant="outline" onClick={() => openEditDialog(record)}>
                                  <Pencil className="mr-2 h-4 w-4" />
                                  编辑
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => handleDeleteRecord(record)}>
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  删除
                                </Button>
                              </>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => handleRestoreRecord(record)}>
                                <Undo2 className="mr-2 h-4 w-4" />
                                恢复
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <TimeRecordDialog
        open={dialogOpen}
        mode={dialogMode}
        form={formState}
        error={formError}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setFormError(null)
        }}
        onChange={(patch) => setFormState((current) => ({ ...current, ...patch }))}
        onSubmit={handleSubmitRecord}
      />
    </div>
  )
}

function getChartColor(kind: 'review' | 'practice' | 'palace_edit') {
  const colorByKind = {
    review: 'var(--color-review)',
    practice: 'var(--color-practice)',
    palace_edit: 'var(--color-palace_edit)',
  }

  return colorByKind[kind]
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
