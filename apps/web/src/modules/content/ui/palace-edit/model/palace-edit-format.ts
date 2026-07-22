import {
  formatDateTimeLocalValue,
  formatUtcApiDateTime,
  parseApiDateTime,
  parseLocalDateTimeInputValue,
} from '@/shared/lib/dateTime'

export function formatDateTimeInputValue(value: string | null): string {
  if (!value) return ''
  const date = parseApiDateTime(value)
  if (Number.isNaN(date.getTime())) return ''
  return formatDateTimeLocalValue(date)
}

/** Convert datetime-local input to UTC ISO for API writes. */
export function toLocalDateTimePayload(value: string): string {
  const date = parseLocalDateTimeInputValue(value.includes(':') && value.length === 16 ? `${value}:00` : value)
  if (Number.isNaN(date.getTime())) {
    // Fallback: keep previous behavior for unexpected shapes.
    return value.includes('T') && value.length === 16 ? `${value}:00` : value
  }
  return formatUtcApiDateTime(date)
}

export function formatVersionSavedAt(value: string | null): string {
  if (!value) return '未知时间'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(/\//g, '/')
}
