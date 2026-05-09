export function formatDateTimeInputValue(value: string | null): string {
  if (!value) return ''
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  if (match) {
    return `${match[1]}T${match[2]}`
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export function toLocalDateTimePayload(value: string): string {
  return `${value}:00`
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

export function normalizePreviewEditorDoc(
  value: Record<string, unknown> | string | null,
): Record<string, unknown> | string {
  if (!value) return ''
  return value
}

export function normalizePreviewConfig(
  value: Record<string, unknown> | string | null,
): Record<string, unknown> {
  if (!value) {
    return {
      theme: { template: 'avocado', config: {} },
      layout: 'logicalStructure',
      config: {},
    }
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      return {
        theme: {
          template: 'avocado',
          config: {},
          ...((parsed.theme as Record<string, unknown> | undefined) ?? {}),
        },
        layout: parsed.layout ?? 'logicalStructure',
        config: (parsed.config as Record<string, unknown> | undefined) ?? {},
        ...parsed,
      }
    } catch {
      return {
        theme: { template: 'avocado', config: {} },
        layout: 'logicalStructure',
        config: {},
      }
    }
  }
  return {
    theme: {
      template: 'avocado',
      config: {},
      ...((value.theme as Record<string, unknown> | undefined) ?? {}),
    },
    layout: value.layout ?? 'logicalStructure',
    config: (value.config as Record<string, unknown> | undefined) ?? {},
    ...value,
  }
}
