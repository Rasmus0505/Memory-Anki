import { parseApiDateTime } from '@/shared/lib/dateTime'

/** Absolute local datetime for "next review" primary line. */
export function formatReviewAbsolute(value: string | null | undefined): string {
  if (!value) return '暂无后续安排'
  const date = parseApiDateTime(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN')
}

/**
 * Relative interval from now to a due/next review instant.
 * Used under absolute next-review time ("间隔 · 1天后").
 */
export function formatReviewIntervalFromNow(value: string | null | undefined): string {
  if (!value) return '—'
  const target = parseApiDateTime(value)
  if (Number.isNaN(target.getTime())) return '—'

  const diffMs = target.getTime() - Date.now()
  if (diffMs <= 0) return '已到期，可立即复习'

  const totalMinutes = Math.floor(diffMs / (1000 * 60))
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)}分钟后`
  }
  if (totalHours < 24) {
    const minutes = totalMinutes % 60
    return minutes > 0 ? `${totalHours}小时${minutes}分钟后` : `${totalHours}小时后`
  }
  if (totalDays < 30) {
    const hours = totalHours % 24
    return hours > 0 ? `${totalDays}天${hours}小时后` : `${totalDays}天后`
  }
  const months = Math.floor(totalDays / 30)
  const days = totalDays % 30
  return days > 0 ? `${months}月${days}天后` : `${months}天后`
}

/** Label line for completion UIs: "间隔 · …" */
export function formatReviewIntervalLabel(value: string | null | undefined): string {
  const interval = formatReviewIntervalFromNow(value)
  if (interval === '—') return '间隔 · —'
  return `间隔 · ${interval}`
}
