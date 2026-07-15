import type { PalaceListItem } from '@/shared/api/contracts'

function formatNextReview(value?: string | null) {
  if (!value) return '未安排'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未安排'
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function PalaceMemoryProgress({ palace }: { palace: Pick<PalaceListItem, 'mastery_percent' | 'memory_health_percent' | 'memory_node_count' | 'mastered_node_count' | 'mastery_horizon_days' | 'due_node_count' | 'overdue_node_count' | 'memory_next_review_at' | 'severe_weak_node_count'> }) {
  const mastery = Math.max(0, Math.min(100, Math.round(palace.mastery_percent ?? 0)))
  const health = Math.max(0, Math.min(100, Math.round(palace.memory_health_percent ?? 0)))
  const nodeCount = palace.memory_node_count ?? 0
  const masteredCount = palace.mastered_node_count ?? 0
  const dueCount = palace.due_node_count ?? 0
  const overdueCount = palace.overdue_node_count ?? 0
  const horizon = palace.mastery_horizon_days ?? 60
  const title = `掌握度 ${mastery}% · 当前记忆 ${health}%\n${masteredCount}/${nodeCount} 个节点达到 ${horizon} 天稳定性\n到期 ${dueCount} · 逾期 ${overdueCount} · 严重弱点 ${palace.severe_weak_node_count ?? 0}\n下次复习：${formatNextReview(palace.memory_next_review_at)}`

  return (
    <div className="mt-2.5 min-w-0" title={title}>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="shrink-0 font-medium text-foreground">掌握 {mastery}%</span>
        <div
          className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-border/80"
          role="progressbar"
          aria-label={`掌握度 ${mastery}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={mastery}
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${mastery}%` }} />
        </div>
        <span className="shrink-0">记忆 {health}%</span>
        <span className="shrink-0">到期 {dueCount}</span>
        <span className="hidden shrink-0 sm:inline">下次 {formatNextReview(palace.memory_next_review_at)}</span>
      </div>
    </div>
  )
}
