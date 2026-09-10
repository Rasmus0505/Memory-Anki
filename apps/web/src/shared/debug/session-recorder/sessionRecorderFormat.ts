export function truncateRecorderText(value: string, max = 40) {
  const plain = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (plain.length <= max) return plain
  return `${plain.slice(0, max)}…`
}

export function formatSessionRecorderTimestamp(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatSessionRecorderClock(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${minutes}:${pad(seconds)}`
}

export function relativeSessionRecorderOffset(startedAt: string, at: string) {
  const start = Date.parse(startedAt)
  const current = Date.parse(at)
  if (!Number.isFinite(start) || !Number.isFinite(current)) return '00:00'
  return formatSessionRecorderClock(current - start)
}

export function formatSessionRecorderReport(input: {
  startedAt: string
  endedAt: string
  routes: string[]
  events: Array<{ at: string; kind: string; action: string; detail: string }>
}) {
  const durationMs = Math.max(0, Date.parse(input.endedAt) - Date.parse(input.startedAt))
  const lines = [
    '请根据以下操作记录排查错误。',
    '',
    `开始: ${formatSessionRecorderTimestamp(input.startedAt)}`,
    `结束: ${formatSessionRecorderTimestamp(input.endedAt)}`,
    `时长: ${formatSessionRecorderClock(durationMs)}`,
    `页面轨迹: ${input.routes.filter(Boolean).join(' → ') || '未知'}`,
    '',
    '## 时间线',
  ]
  if (input.events.length === 0) {
    lines.push('（没有捕获到操作）')
  } else {
    for (const event of input.events) {
      const offset = relativeSessionRecorderOffset(input.startedAt, event.at)
      const detail = event.detail ? ` ${event.detail}` : ''
      lines.push(`[${offset}] ${event.action}${detail}`)
    }
  }
  return lines.join('\n')
}

export function buildSessionRecorderCopyText(reportText: string, notes: string) {
  const report = reportText.trim()
  const extra = notes.trim()
  if (!extra) return report
  if (!report) return `## 用户补充\n${extra}`
  return `${report}\n\n## 用户补充\n${extra}`
}
