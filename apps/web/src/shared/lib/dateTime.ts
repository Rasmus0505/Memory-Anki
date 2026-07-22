function hasExplicitTimezone(value: string) {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
}

/**
 * Parse API/server datetimes into a real Date.
 *
 * Contract: absolute timestamps are UTC. Naive values (no offset) are treated as
 * UTC to match backend `utc_now_naive` storage. Prefer responses with `+00:00`.
 */
export function parseApiDateTime(value: string | null | undefined): Date {
  if (!value) return new Date(Number.NaN)
  const raw = String(value).trim()
  if (!raw) return new Date(Number.NaN)
  if (hasExplicitTimezone(raw)) return new Date(raw)

  // API datetimes without an offset are UTC (backend stores utc_now_naive).
  // Treating them as local wall time inflated "距今" by ~+8h in China.
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/,
  )
  if (!match) return new Date(raw)

  const [, year, month, day, hour, minute, second = '0', fraction = '0'] = match
  const milliseconds = Number(fraction.slice(0, 3).padEnd(3, '0'))
  return new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      milliseconds,
    ),
  )
}

/**
 * Format an absolute instant for API write paths (UTC with Z).
 * Use this for started_at / ended_at / nowIso payloads.
 */
export function formatUtcApiDateTime(value: Date): string {
  if (Number.isNaN(value.getTime())) return new Date().toISOString()
  return value.toISOString()
}

/**
 * Local wall-clock string without timezone — only for UI / sessionStorage that
 * never leaves the client as an absolute API timestamp.
 * Prefer formatUtcApiDateTime when sending times to the backend.
 */
export function formatLocalApiDateTime(value: Date) {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  const hour = `${value.getHours()}`.padStart(2, '0')
  const minute = `${value.getMinutes()}`.padStart(2, '0')
  const second = `${value.getSeconds()}`.padStart(2, '0')
  const milliseconds = `${value.getMilliseconds()}`.padStart(3, '0')
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}`
}

export function formatLocalDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Format a Date into local `YYYY-MM-DDTHH:mm:ss` for datetime-local inputs. */
export function formatLocalDateTimeInputFromDate(value: Date): string {
  if (Number.isNaN(value.getTime())) return ''
  const year = value.getFullYear()
  const month = `${value.getMonth() + 1}`.padStart(2, '0')
  const day = `${value.getDate()}`.padStart(2, '0')
  const hour = `${value.getHours()}`.padStart(2, '0')
  const minute = `${value.getMinutes()}`.padStart(2, '0')
  const second = `${value.getSeconds()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}

/**
 * Convert an API datetime string into a local datetime-local input value.
 */
export function formatLocalDateTimeInputValue(value: string) {
  return formatLocalDateTimeInputFromDate(parseApiDateTime(value))
}

/**
 * Parse a datetime-local input (`YYYY-MM-DDTHH:mm` or with seconds) as local wall time.
 */
export function parseLocalDateTimeInputValue(value: string): Date {
  const raw = String(value || '').trim()
  if (!raw) return new Date(Number.NaN)
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/,
  )
  if (!match) return new Date(raw)
  const [, year, month, day, hour, minute, second = '0', fraction = '0'] = match
  const milliseconds = Number(fraction.slice(0, 3).padEnd(3, '0'))
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    milliseconds,
  )
}

export function formatApiDateTime(value: string | null): string {
  if (!value) return '未记录具体时间'
  const date = parseApiDateTime(value)
  if (Number.isNaN(date.getTime())) return '未记录具体时间'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '-')
}

export function formatApiDate(value: string | null): string {
  if (!value) return '未设置'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return formatLocalDateKey(date)
}

export function formatDateTimeLocalValue(date: Date): string {
  const safe = Number.isNaN(date.getTime()) ? new Date() : date
  const year = safe.getFullYear()
  const month = `${safe.getMonth() + 1}`.padStart(2, '0')
  const day = `${safe.getDate()}`.padStart(2, '0')
  const hours = `${safe.getHours()}`.padStart(2, '0')
  const minutes = `${safe.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}
