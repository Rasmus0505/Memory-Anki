import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Settings, Download, Upload, FileJson, FileText } from 'lucide-react'
import { toast } from 'sonner'

export default function Profile() {
  const [tab, setTab] = useState<'config' | 'io'>('config')
  const [config, setConfig] = useState<any>(null)
  const [algorithm, setAlgorithm] = useState('ebbinghaus')
  const [importResult, setImportResult] = useState<string | null>(null)

  useEffect(() => {
    api.getSettings().then(c => { setConfig(c); setAlgorithm(c.default_algorithm) })
  }, [])

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const fd = new FormData(form)
    const data: Record<string, string> = {}
    fd.forEach((v, k) => { data[k] = v as string })
    data.default_algorithm = algorithm
    await api.updateSettings(data)
    toast.success('配置已保存')
  }

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const file = (form.elements.namedItem('file') as HTMLInputElement).files?.[0]
    const format = (form.elements.namedItem('format') as HTMLSelectElement).value
    if (!file) return
    const res = await api.importFile(file, format)
    if (res.ok) {
      toast.success(`成功导入 ${res.count} 个宫殿`)
      setImportResult(null)
    } else {
      setImportResult(`导入失败: ${res.error}`)
    }
  }

  if (!config) return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">加载中...</div>

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">个人中心</h1>
        <p className="text-sm text-muted-foreground mt-1">管理复习配置与数据导入导出。</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[
          { k: 'config', label: '复习配置', icon: Settings },
          { k: 'io', label: '导入导出', icon: Download },
        ].map(({ k, label, icon: Icon }) => (
          <button key={k} onClick={() => setTab(k as any)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px
              ${tab === k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'config' ? (
        <form onSubmit={handleSaveConfig} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">复习算法</CardTitle>
              <CardDescription>选择默认的复习调度算法。切换后新宫殿将使用新算法。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { k: 'ebbinghaus', t: '艾宾浩斯', d: '1h→睡前→1→2→4→7→15→30→60 天' },
                  { k: 'sm2', t: 'SM-2', d: '根据评分动态调整间隔' },
                  { k: 'custom', t: '自定义', d: '完全自定义复习间隔' },
                ].map(a => (
                  <button key={a.k} type="button" onClick={() => setAlgorithm(a.k)}
                    className={`flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-all active:scale-[0.97]
                      ${algorithm === a.k ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-secondary'}`}>
                    <span className="text-sm font-semibold">{a.t}</span>
                    <span className="text-xs text-muted-foreground">{a.d}</span>
                  </button>
                ))}
              </div>

              {algorithm === 'custom' && (
                <div className="space-y-2">
                  <Label>自定义间隔天数</Label>
                  <Input name="custom_intervals" defaultValue={config.custom_intervals} placeholder="1,2,4,7,15,30,60" />
                  <p className="text-xs text-muted-foreground">逗号分隔，每个数字代表距学习日的天数。</p>
                </div>
              )}

              {algorithm === 'sm2' && (
                <div className="grid grid-cols-3 gap-4 rounded-lg border p-4">
                  <div className="space-y-2">
                    <Label>初始 ease factor</Label>
                    <Input name="sm2_initial_ease" defaultValue={config.sm2_initial_ease} type="number" step="0.1" />
                  </div>
                  <div className="space-y-2">
                    <Label>最小 ease</Label>
                    <Input name="sm2_min_ease" defaultValue={config.sm2_min_ease} type="number" step="0.1" />
                  </div>
                  <div className="space-y-2">
                    <Label>初始间隔 (天)</Label>
                    <Input name="sm2_initial_interval" defaultValue={config.sm2_initial_interval} type="number" />
                  </div>
                </div>
              )}

              {algorithm === 'ebbinghaus' && (
                <div className="space-y-2">
                  <Label>艾宾浩斯间隔序列</Label>
                  <Input name="ebbinghaus_intervals" defaultValue="1h,sleep,1,2,4,7,15,30,60" placeholder="1h,sleep,1,2,4,7,15,30,60" />
                  <p className="text-xs text-muted-foreground">逗号分隔。1h=学后1小时，sleep=当天睡前，数字=距学习日的天数。</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">复习行为</CardTitle>
              <CardDescription>微调复习的时间与策略。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label>睡前复习时间</Label>
                  <Input name="sleep_review_time" defaultValue={config.sleep_review_time || '22:00'} type="time" />
                  <p className="text-xs text-muted-foreground">每天此时汇入当天待复习内容。</p>
                </div>
                <div className="space-y-2">
                  <Label>默认复习模式</Label>
                  <div className="flex gap-2">
                    {['flashcard', 'browse'].map(m => (
                      <label key={m} className="flex-1 flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer hover:bg-secondary transition-colors has-checked:bg-primary/5 has-checked:border-primary">
                        <input type="radio" name="default_review_mode" value={m} defaultChecked={config.default_review_mode === m} className="sr-only" />
                        <span className="text-sm">{m === 'flashcard' ? '闪卡' : '浏览'}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>每日复习上限</Label>
                  <Input name="daily_max_reviews" defaultValue={config.daily_max_reviews || '0'} type="number" min="0" />
                  <p className="text-xs text-muted-foreground">0=无限制，超过上限的推迟到明天。</p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border p-4">
                <input type="checkbox" name="early_review_anchor" value="true" defaultChecked={config.early_review_anchor === 'true'} className="mt-0.5" />
                <div>
                  <div className="text-sm font-medium">提前复习锚定策略</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    启用后，提前复习不会缩短后续间隔——下次复习仍从原始计划日计算。避免"越勤奋复习越密"的惩罚效应。
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">算法切换策略</CardTitle>
              <CardDescription>切换算法时如何影响已有计划。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {[
                  { v: 'future_only', t: '仅对新宫殿生效', d: '已有宫殿的复习计划保持不变' },
                  { v: 'all', t: '更新所有未完成计划', d: '删除并重新生成所有待复习项' },
                ].map(o => (
                  <label key={o.v} className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer hover:bg-secondary transition-colors has-checked:bg-primary/5 has-checked:border-primary">
                    <input type="radio" name="algorithm_change_scope" value={o.v} defaultChecked={config.algorithm_change_scope === o.v} className="mt-0.5" />
                    <div>
                      <div className="text-sm font-medium">{o.t}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{o.d}</div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" name="apply_to_pending" value="all" />
                  <span className="text-sm font-medium">保存时立即应用到所有未完成计划</span>
                </label>
                <p className="text-xs text-amber-700 mt-1.5 ml-6">将删除所有待复习的计划并按新算法重建。</p>
              </div>
            </CardContent>
          </Card>

          <Button type="submit">保存配置</Button>
        </form>
      ) : (
        <div className="space-y-6">
          {importResult && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{importResult}</div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Download className="h-4 w-4" />导出</CardTitle>
                <CardDescription>导出所有宫殿为文件。</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <a href={api.exportJson()} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-secondary transition-colors text-sm">
                  <FileJson className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="font-medium">JSON 格式</div>
                    <div className="text-xs text-muted-foreground">完整数据备份，适合迁移恢复</div>
                  </div>
                </a>
                <a href={api.exportMarkdown()} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-secondary transition-colors text-sm">
                  <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div>
                    <div className="font-medium">Markdown 格式</div>
                    <div className="text-xs text-muted-foreground">人类可读，适合分享和快速录入</div>
                  </div>
                </a>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" />导入</CardTitle>
                <CardDescription>从文件导入宫殿。</CardDescription>
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
                    <input type="file" name="file" required className="w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-secondary file:text-foreground hover:file:bg-secondary/80" />
                  </div>
                  <Button type="submit" className="w-full"><Upload className="h-4 w-4" />开始导入</Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
