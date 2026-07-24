/**
 * Card mark-color labels + last-used color.
 * Uses localStorage for sync read, and deferred client-preference writes so
 * mindmap canvas can import this without circular module init through settings.
 */

export const MARK_COLOR_LABELS_STORAGE_KEY = 'memory-anki.mark-color-labels'
export const MARK_COLOR_LABELS_UPDATED_EVENT = 'memory-anki-mark-color-labels-change'
export const MARK_COLOR_LABELS_PREFERENCE_KEY = 'mark_color_labels' as const

export interface MarkColorLabel {
  id: string
  name: string
  color: string
}

export interface MarkColorLabelsSettings {
  labels: MarkColorLabel[]
  lastUsedColor: string | null
}

export const DEFAULT_MARK_COLOR_PRESETS = [
  '#fecaca',
  '#fed7aa',
  '#fef08c',
  '#bbf7d0',
  '#bfdbfe',
  '#ddd6fe',
  '#fbcfe8',
] as const

export const DEFAULT_MARK_COLOR_LABELS_SETTINGS: MarkColorLabelsSettings = {
  labels: [],
  lastUsedColor: null,
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }
  if (/^(rgb|hsl)a?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?(?:\s*,\s*[\d.]+%?\s*)?\)$/i.test(trimmed)) {
    return trimmed.replace(/\s+/g, ' ')
  }
  return null
}

function createLabelId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `mark-color-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function sanitizeMarkColorLabelsSettings(value: unknown): MarkColorLabelsSettings {
  if (!value || typeof value !== 'object') return { labels: [], lastUsedColor: null }
  const raw = value as Partial<MarkColorLabelsSettings>
  const labels: MarkColorLabel[] = []
  const seenIds = new Set<string>()
  if (Array.isArray(raw.labels)) {
    for (const item of raw.labels) {
      if (!item || typeof item !== 'object') continue
      const color = normalizeHexColor((item as MarkColorLabel).color)
      if (!color) continue
      const name =
        typeof (item as MarkColorLabel).name === 'string' && (item as MarkColorLabel).name.trim()
          ? (item as MarkColorLabel).name.trim().slice(0, 32)
          : '未命名'
      let id =
        typeof (item as MarkColorLabel).id === 'string' && (item as MarkColorLabel).id.trim()
          ? (item as MarkColorLabel).id.trim()
          : createLabelId()
      if (seenIds.has(id)) id = createLabelId()
      seenIds.add(id)
      labels.push({ id, name, color })
      if (labels.length >= 40) break
    }
  }
  return {
    labels,
    lastUsedColor: normalizeHexColor(raw.lastUsedColor),
  }
}

export function isMarkColorLabelsSettings(value: unknown): value is MarkColorLabelsSettings {
  if (!value || typeof value !== 'object') return false
  const candidate = value as MarkColorLabelsSettings
  if (!Array.isArray(candidate.labels)) return false
  if (candidate.lastUsedColor != null && typeof candidate.lastUsedColor !== 'string') return false
  return candidate.labels.every(
    (label) =>
      label &&
      typeof label === 'object' &&
      typeof label.id === 'string' &&
      typeof label.name === 'string' &&
      typeof label.color === 'string',
  )
}

function emitUpdated(value: MarkColorLabelsSettings) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(MARK_COLOR_LABELS_UPDATED_EVENT, { detail: value }))
}

function readLocal(): MarkColorLabelsSettings {
  if (typeof window === 'undefined') return { labels: [], lastUsedColor: null }
  try {
    const raw = window.localStorage.getItem(MARK_COLOR_LABELS_STORAGE_KEY)
    if (!raw) return { labels: [], lastUsedColor: null }
    return sanitizeMarkColorLabelsSettings(JSON.parse(raw))
  } catch {
    return { labels: [], lastUsedColor: null }
  }
}

function writeLocal(value: MarkColorLabelsSettings) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MARK_COLOR_LABELS_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Ignore quota / private mode failures.
  }
}

function persistBackend(value: MarkColorLabelsSettings) {
  // Dynamic import avoids circular init: canvas → this module → clientPreferences → settings.
  void import('./clientPreferences')
    .then(({ saveClientPreference }) => saveClientPreference('mark_color_labels', value))
    .catch(() => {
      // Offline / API unavailable — localStorage still holds the value.
    })
}

export function readMarkColorLabelsSettings(): MarkColorLabelsSettings {
  return readLocal()
}

export function writeMarkColorLabelsSettings(value: MarkColorLabelsSettings): MarkColorLabelsSettings {
  const sanitized = sanitizeMarkColorLabelsSettings(value)
  writeLocal(sanitized)
  emitUpdated(sanitized)
  persistBackend(sanitized)
  return sanitized
}

/** Apply backend cache value into localStorage (used by preference bootstrap). */
export function hydrateMarkColorLabelsFromBackend(value: unknown): MarkColorLabelsSettings {
  const sanitized = sanitizeMarkColorLabelsSettings(value)
  writeLocal(sanitized)
  emitUpdated(sanitized)
  return sanitized
}

export function setLastUsedMarkColor(color: string | null): MarkColorLabelsSettings {
  const current = readMarkColorLabelsSettings()
  const nextColor = normalizeHexColor(color)
  if (current.lastUsedColor === nextColor) return current
  return writeMarkColorLabelsSettings({ ...current, lastUsedColor: nextColor })
}

export function addMarkColorLabel(color: string, name?: string): MarkColorLabelsSettings {
  const normalized = normalizeHexColor(color)
  if (!normalized) return readMarkColorLabelsSettings()
  const current = readMarkColorLabelsSettings()
  const existing = current.labels.find((label) => label.color === normalized)
  if (existing) {
    return writeMarkColorLabelsSettings({
      ...current,
      lastUsedColor: normalized,
      labels: current.labels.map((label) =>
        label.id === existing.id
          ? { ...label, name: name?.trim() ? name.trim().slice(0, 32) : label.name }
          : label,
      ),
    })
  }
  const nextName = name?.trim() || `颜色 ${current.labels.length + 1}`
  return writeMarkColorLabelsSettings({
    labels: [
      ...current.labels,
      { id: createLabelId(), name: nextName.slice(0, 32), color: normalized },
    ],
    lastUsedColor: normalized,
  })
}

export function renameMarkColorLabel(id: string, name: string): MarkColorLabelsSettings {
  const current = readMarkColorLabelsSettings()
  const nextName = name.trim().slice(0, 32)
  if (!nextName) return current
  return writeMarkColorLabelsSettings({
    ...current,
    labels: current.labels.map((label) =>
      label.id === id ? { ...label, name: nextName } : label,
    ),
  })
}

export function deleteMarkColorLabel(id: string): MarkColorLabelsSettings {
  const current = readMarkColorLabelsSettings()
  return writeMarkColorLabelsSettings({
    ...current,
    labels: current.labels.filter((label) => label.id !== id),
  })
}
