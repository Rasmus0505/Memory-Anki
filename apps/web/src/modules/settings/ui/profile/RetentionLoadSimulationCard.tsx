import { useEffect, useRef, useState } from 'react'
import type { ReviewLoadSimulation } from '@/shared/api/contracts'
import { simulateReviewLoadApi } from '@/modules/practice/public'
import { cn } from '@/shared/lib/utils'

const SIMULATE_DEBOUNCE_MS = 500

/**
 * 目标保持率 → 未来 30 天负载模拟（当前 vs 模拟 双柱对比）。
 * 滑块联动：desiredRetention 变化后防抖 500ms 调 POST /review/simulate-load。
 */
export function RetentionLoadSimulationCard({ desiredRetention }: { desiredRetention: number }) {
  const [simulation, setSimulation] = useState<ReviewLoadSimulation | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  useEffect(() => {
    if (!Number.isFinite(desiredRetention)) return
    const seq = ++requestSeq.current
    setLoading(true)
    const timer = window.setTimeout(() => {
      simulateReviewLoadApi(desiredRetention, 30)
        .then((response) => {
          if (requestSeq.current !== seq) return
          setSimulation(response.item)
          setError(null)
        })
        .catch((reason) => {
          if (requestSeq.current !== seq) return
          setError(reason instanceof Error ? reason.message : '负载模拟失败')
        })
        .finally(() => {
          if (requestSeq.current === seq) setLoading(false)
        })
    }, SIMULATE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [desiredRetention])

  if (error && !simulation) {
    return <p className="text-xs text-muted-foreground">负载模拟暂不可用：{error}</p>
  }
  if (!simulation) {
    return loading ? <p className="text-xs text-muted-foreground">正在模拟未来 30 天负载…</p> : null
  }

  const maxCount = Math.max(
    1,
    ...simulation.items.map((item) => Math.max(item.current_due, item.simulated_due)),
  )
  const delta = simulation.simulated_total - simulation.current_total
  const deltaText =
    delta === 0
      ? '总量基本不变'
      : delta > 0
        ? `未来 30 天将多复习约 ${delta} 张`
        : `未来 30 天将少复习约 ${Math.abs(delta)} 张`

  return (
    <div data-testid="retention-load-simulation" className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">
          按保持率 {Math.round(simulation.desired_retention * 100)}% 模拟未来 {simulation.days} 天
        </span>
        <span className={cn('text-muted-foreground', loading && 'opacity-60')}>
          当前 {simulation.current_total} 张 → 模拟 {simulation.simulated_total} 张 · {deltaText}
        </span>
      </div>
      <div
        className={cn('flex h-24 items-end gap-[2px]', loading && 'opacity-60')}
        role="img"
        aria-label="当前与模拟负载对比柱状图"
      >
        {simulation.items.map((item) => (
          <div key={item.date} className="flex h-full min-w-0 flex-1 items-end gap-[1px]" title={`${item.date} · 当前 ${item.current_due} / 模拟 ${item.simulated_due}`}>
            <div
              className="w-1/2 rounded-t-[2px] bg-primary/60"
              style={{ height: `${item.current_due > 0 ? Math.max(4, (item.current_due / maxCount) * 100) : 2}%` }}
            />
            <div
              className="w-1/2 rounded-t-[2px] bg-warning/80"
              style={{ height: `${item.simulated_due > 0 ? Math.max(4, (item.simulated_due / maxCount) * 100) : 2}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-primary/60" />当前
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-sm bg-warning/80" />模拟
        </span>
      </div>
    </div>
  )
}
