function hasExplicitTimezone(value: string) {
  return /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
}

export function parseApiDateTime(value: string | null | undefined): Date {
  if (!value) return new Date(Number.NaN)
  const raw = String(value).trim()
  if (!raw) return new Date(Number.NaN)
  if (hasExplicitTimezone(raw)) return new Date(raw)

  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/,
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

export function formatLocalDateTimeInputValue(value: string) {
  const date = parseApiDateTime(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  const second = `${date.getSeconds()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
}
