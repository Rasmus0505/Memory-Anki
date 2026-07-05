import { useEffect, useState, type FormEvent } from 'react'
import { ProfileSkeleton } from './ProfileSkeleton'
import {
  Download,
  FileJson,
  FileText,
  Keyboard,
  Settings,
  Upload,
} from 'lucide-react'
import { toast } from '@/shared/feedback/toast'
import { ProfileLayout } from '@/features/profile/ProfileLayout'
import type { ReviewSettings } from '@/shared/api/contracts'
import {
  getReviewSettingsApi,
  updateReviewSettingsApi,
} from '@/entities/preferences/api'
import { getClientPreferencesApi } from '@/entities/preferences/api'
import {
  exportJsonUrl,
  exportMarkdownUrl,
  importFileApi,
} from '@/features/profile/api'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { MemoryAnkiShortcutsSettings } from '@/features/shortcuts/MemoryAnkiShortcutsSettings'

export default function ProfileSettingsPage() {
  const [tab, setTab] = useState<'config' | 'io' | 'shortcuts'>('config')
  const [config, setConfig] = useState<ReviewSettings | null>(null)
  const [clientPreferencesReady, setClientPreferencesReady] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)

  useEffect(() => {
    const loadSettings = async () => {
      const [settings] = await Promise.all([
        getReviewSettingsApi(),
        getClientPreferencesApi().then(() => setClientPreferencesReady(true)).catch(() => setClientPreferencesReady(false)),
      ])
      setConfig(settings)
    }

    void loadSettings()
  }, [])

  const handleSaveConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const data: Record<string, string> = {}

    formData.forEach((value, key) => {
      data[key] = value as string
    })

    data.auto_smooth_overdue = formData.get('auto_smooth_overdue')
      ? 'true'
      : 'false'
    data.early_review_anchor = formData.get('early_review_anchor')
      ? 'true'
      : 'false'

    const nextConfig = await updateReviewSettingsApi(data)
    setConfig(nextConfig)
    toast.success('复习高级配置已保存')
  }

  const handleImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const fileInput = form.elements.namedItem('file') as HTMLInputElement
    const formatInput = form.elements.namedItem('format') as HTMLSelectElement
    const file = fileInput.files?.[0]
    if (!file) return

    const result = await importFileApi(file, formatInput.value)
    if (result.ok) {
      toast.success(`成功导入 ${result.count} 个宫殿`)
      setImportResult(null)
      return
    }

    setImportResult(`导入失败: ${result.error ?? '未知错误'}`)
  }

  if (!config) {
    return (
      <ProfileSkeleton />
    )
  }

  return (
    <ProfileLayout
      title="个人中心"
      description="这里继续管理复习排程、导入导出，以及新的 AI 知识点拆分接入配置。"
    >
      {clientPreferencesReady ? (
        <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
          快捷键、英语听力设置、复习反馈、计时自动化和部分视图偏好现在已经由后端托管保存。
        </div>
      ) : null}
      <div className="flex gap-1 border-b">
        {[
          { key: 'config', label: '复习配置', icon: Settings },
          { key: 'io', label: '导入导出', icon: Download },
          { key: 'shortcuts', label: '快捷键', icon: Keyboard },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key as 'config' | 'io' | 'shortcuts')}
            className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'shortcuts' ? (
        <MemoryAnkiShortcutsSettings />
      ) : tab === 'config' ? (
        <form onSubmit={handleSaveConfig} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">高级排程策略</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ebbinghaus-intervals">
                  增强艾宾浩斯顺序：1小时，睡前，1天，x天
                </Label>
                <Input
                  id="ebbinghaus-intervals"
                  name="ebbinghaus_intervals"
                  defaultValue={config.ebbinghaus_intervals}
                  placeholder="1h,sleep,1,2,4,7,15,30,60"
                />
              </div>
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
                  <Input
                    id="sleep-review-time"
                    name="sleep_review_time"
                    defaultValue={config.sleep_review_time || '22:00'}
                    type="time"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="daily-max">每日正式复习上限</Label>
                  <Input
                    id="daily-max"
                    name="daily_max_reviews"
                    defaultValue={config.daily_max_reviews || '0'}
                    type="number"
                    min="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="overdue-days">逾期平滑窗口天数</Label>
                  <Input
                    id="overdue-days"
                    name="overdue_smoothing_days"
                    defaultValue={config.overdue_smoothing_days || '7'}
                    type="number"
                    min="1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="overdue-threshold">
                  触发自动平滑的逾期阈值
                </Label>
                <Input
                  id="overdue-threshold"
                  name="overdue_smoothing_threshold"
                  defaultValue={config.overdue_smoothing_threshold || '5'}
                  type="number"
                  min="0"
                />
              </div>

              <div className="rounded-lg border p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="auto_smooth_overdue"
                    defaultChecked={config.auto_smooth_overdue === 'true'}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">
                      默认自动平滑逾期任务
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      进入复习总览前先自动分散逾期任务，减少单日压死的情况。
                    </div>
                  </div>
                </label>
              </div>

              <div className="rounded-lg border p-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="early_review_anchor"
                    defaultChecked={config.early_review_anchor === 'true'}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">提前复习锚定策略</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      启用后，提前复习不会缩短后续间隔，下次仍从原计划日继续计算。
                    </div>
                  </div>
                </label>
              </div>
            </CardContent>
          </Card>

          <Button type="submit">保存复习配置</Button>
        </form>
      ) : (
        <div className="space-y-6">
          {importResult ? (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {importResult}
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Download className="size-4" />
                  导出
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <a
                  href={exportJsonUrl()}
                  className="flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-secondary"
                >
                  <FileJson className="size-5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="font-medium">JSON 导出/迁移</div>
                  </div>
                </a>
                <a
                  href={exportMarkdownUrl()}
                  className="flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-secondary"
                >
                  <FileText className="size-5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="font-medium">Markdown 导出/迁移</div>
                  </div>
                </a>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Upload className="size-4" />
                  导入
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleImport} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">文件格式</label>
                    <select
                      name="format"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
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
                    <Upload className="size-4" />
                    开始导入
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </ProfileLayout>
  )
}
