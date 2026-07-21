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

/**
 * Relative elapsed time from a past instant to now ("2小时前" / "3天前").
 * Mirrors formatReviewIntervalFromNow for last-review completion cards.
 */
export function formatReviewElapsedFromNow(value: string | null | undefined): string {
  if (!value) return '—'
  const target = parseApiDateTime(value)
  if (Number.isNaN(target.getTime())) return '—'

  const diffMs = Date.now() - target.getTime()
  if (diffMs < 0) return '刚刚'
  if (diffMs < 60 * 1000) return '刚刚'

  const totalMinutes = Math.floor(diffMs / (1000 * 60))
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)}分钟前`
  }
  if (totalHours < 24) {
    const minutes = totalMinutes % 60
    return minutes > 0 ? `${totalHours}小时${minutes}分钟前` : `${totalHours}小时前`
  }
  if (totalDays < 30) {
    const hours = totalHours % 24
    return hours > 0 ? `${totalDays}天${hours}小时前` : `${totalDays}天前`
  }
  const months = Math.floor(totalDays / 30)
  const days = totalDays % 30
  return days > 0 ? `${months}月${days}天前` : `${months}月前`
}

/** Label line for completion UIs: "间隔 · …" */
export function formatReviewIntervalLabel(value: string | null | undefined): string {
  const interval = formatReviewIntervalFromNow(value)
  if (interval === '—') return '间隔 · —'
  return `间隔 · ${interval}`
}

/** Secondary line under last-review absolute time: "距今 · 2小时前" */
export function formatLastReviewDetailLabel(value: string | null | undefined): string {
  if (!value) return '本宫首次正式复习'
  const elapsed = formatReviewElapsedFromNow(value)
  if (elapsed === '—') return '距今 · —'
  return `距今 · ${elapsed}`
}

/**
 * Next-review secondary line for completion UIs.
 * Shows interval + next-wave node count so the learner can tell node vs full palace.
 */
export function formatNextReviewDetailLabel(options: {
  nextReviewAt?: string | null
  nextReviewNodeCount?: number | null
  nextReviewEntryMode?: 'none' | 'node' | 'palace' | string | null
  nextReviewEntryLabel?: string | null
}): string {
  const bits: string[] = [formatReviewIntervalLabel(options.nextReviewAt)]
  const count = options.nextReviewNodeCount
  if (typeof count === 'number' && count > 0) {
    bits.push(`${count} 个节点`)
  } else if (typeof count === 'number' && count === 0 && !options.nextReviewAt) {
    bits.push('暂无待复习节点')
  }

  const mode = options.nextReviewEntryMode
  if (mode === 'node') {
    bits.push(options.nextReviewEntryLabel?.trim() || '节点复习')
  } else if (mode === 'palace') {
    const label = options.nextReviewEntryLabel?.trim()
    bits.push(label && label !== '开始复习' ? label : '整宫复习')
  }

  return bits.join(' · ')
}
