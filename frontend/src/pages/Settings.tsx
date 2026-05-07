import { useEffect, useState } from 'react'
import { api } from '@/api/client'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

export default function Settings() {
  const [config, setConfig] = useState<any>(null)
  const [algorithm, setAlgorithm] = useState('ebbinghaus')

  useEffect(() => {
    api.getSettings().then(c => { setConfig(c); setAlgorithm(c.default_algorithm) })
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const form = e.target as HTMLFormElement
    const fd = new FormData(form)
    const data: Record<string, string> = {}
    fd.forEach((v, k) => { data[k] = v as string })
    data.default_algorithm = algorithm
    await api.updateSettings(data)
    toast.success('配置已保存')
  }

  if (!config) return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">加载中...</div>

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">配置中心</h1>
        <p className="text-sm text-muted-foreground mt-1">个性化定制你的复习体验。</p>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">复习算法</CardTitle>
            <CardDescription>选择默认的复习调度算法。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                { k: 'ebbinghaus', t: '艾宾浩斯', d: '1, 2, 4, 7, 15, 30, 60 天' },
                { k: 'sm2', t: 'SM-2', d: '根据评分动态调整间隔' },
                { k: 'custom', t: '自定义', d: '完全自定义复习间隔' },
              ].map(a => (
                <button key={a.k} type="button" onClick={() => setAlgorithm(a.k)}
                  className={`flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors ${algorithm === a.k ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-secondary'}`}>
                  <span className="text-sm font-semibold">{a.t}</span>
                  <span className="text-xs text-muted-foreground">{a.d}</span>
                </button>
              ))}
            </div>

            {algorithm === 'custom' && (
              <div className="space-y-2 pt-2">
                <Label>自定义间隔天数</Label>
                <Input name="custom_intervals" defaultValue={config.custom_intervals} placeholder="1,2,4,7,15,30,60" />
                <p className="text-xs text-muted-foreground">逗号分隔，每个数值代表一次复习的间隔天数。</p>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">默认复习模式</CardTitle>
            <CardDescription>新建宫殿时使用的默认模式。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              {['flashcard', 'browse'].map(m => (
                <label key={m} className="flex items-center gap-2 rounded-md border px-4 py-2.5 cursor-pointer hover:bg-secondary transition-colors has-checked:bg-primary/5 has-checked:border-primary has-checked:ring-1 has-checked:ring-primary">
                  <input type="radio" name="default_review_mode" value={m} defaultChecked={config.default_review_mode === m} className="sr-only" />
                  <span className="text-sm font-medium">{m === 'flashcard' ? '闪卡模式' : '浏览模式'}</span>
                  <span className="text-xs text-muted-foreground">{m === 'flashcard' ? '先看提示再翻答案' : '直接浏览全部内容'}</span>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">算法切换策略</CardTitle>
            <CardDescription>切换算法时如何影响已有的复习计划。</CardDescription>
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
                <input type="checkbox" name="apply_to_pending" value="all" className="rounded" />
                <span className="text-sm font-medium">保存时立即应用到所有未完成计划</span>
              </label>
              <p className="text-xs text-amber-700 mt-1.5 ml-6">这将删除所有待复习的计划并按新算法重建。</p>
            </div>
          </CardContent>
        </Card>

        <Button type="submit">保存配置</Button>
      </form>
    </div>
  )
}
