import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { getAiQualitySummaryApi } from '@/modules/settings/ui/profile/api'
import type { AiQualitySummary } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

export function AiWorkspaceQualityTab() {
  const [days, setDays] = useState(7)
  const [summary, setSummary] = useState<AiQualitySummary | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSummary(await getAiQualitySummaryApi({ days }))
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  const metrics = summary?.metrics
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <div className="font-medium">AI 质量与稳定性</div>
            <div className="text-sm text-muted-foreground">成功率、结构输出、延迟、用量与提示词评测。</div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value={7}>近 7 天</option>
              <option value={30}>近 30 天</option>
            </select>
            <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['调用成功率', metrics ? percent(metrics.success_rate) : '--'],
          ['结构输出成功率', metrics ? percent(metrics.structured_success_rate) : '--'],
          ['P95 延迟', metrics?.p95_duration_ms != null ? `${metrics.p95_duration_ms} ms` : '--'],
          ['估算成本', metrics?.has_estimated_cost ? `${metrics.estimated_cost.toFixed(4)}` : '未配置单价'],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-5">
              <div className="text-sm text-muted-foreground">{label}</div>
              <div className="mt-2 text-2xl font-semibold">{value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">用量与错误</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">输入 {metrics?.input_tokens ?? 0}</Badge>
              <Badge variant="outline">输出 {metrics?.output_tokens ?? 0}</Badge>
              <Badge variant="outline">缓存输入 {metrics?.cached_input_tokens ?? 0}</Badge>
              <Badge variant="outline">修复率 {metrics ? percent(metrics.repair_rate) : '--'}</Badge>
            </div>
            {summary?.errors.length ? summary.errors.map((item) => (
              <div key={item.kind} className="flex justify-between rounded-lg border px-3 py-2">
                <span>{item.kind}</span><span>{item.count}</span>
              </div>
            )) : <div className="text-muted-foreground">当前时间范围内没有分类错误。</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4" />最近评测</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {summary?.recent_evals.length ? summary.recent_evals.map((run) => (
              <div key={run.id} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{run.prompt_key}</span>
                  <Badge variant={run.gate_passed ? 'secondary' : 'destructive'}>{run.gate_passed ? '通过' : '未通过'}</Badge>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{run.case_count} 个案例 · 断言 {percent(run.assertion_success_rate)}</div>
              </div>
            )) : <div className="text-sm text-muted-foreground">尚未运行提示词评测。</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
