import {
  getClientPreferenceCacheStatus,
  hasLoadedClientPreferences,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'

export type BreakGuardAlertStrength = 'strong' | 'gentle'

export interface BreakGuardConfig {
  enabled: boolean
  promptDelaySeconds: number
  presetMinutes: number[]
  allowCustomMinutes: boolean
  targetPath: string
  alertStrength: BreakGuardAlertStrength
  snoozeMinutes: number[]
  recordBreakLogs: boolean
}

export interface BreakGuardLogEntry {
  id: string
  startedAt: string
  plannedMinutes: number
  endedAt: string | null
  overtime: boolean
  snoozeCount: number
}

export const BREAK_GUARD_STORAGE_KEY = 'memory-anki-break-guard-config'
export const BREAK_GUARD_LOG_STORAGE_KEY = 'memory-anki-break-guard-logs'
export const BREAK_GUARD_UPDATED_EVENT = 'memory-anki-break-guard-config-change'

export const DEFAULT_BREAK_GUARD_CONFIG: BreakGuardConfig = {
  enabled: true,
  promptDelaySeconds: 5,
  presetMinutes: [5, 10, 20],
  allowCustomMinutes: true,
  targetPath: '/freestyle',
  alertStrength: 'strong',
  snoozeMinutes: [1, 3, 5],
  recordBreakLogs: true,
}

function sanitizePositiveInteger(value: unknown, fallback: number, options?: { min?: number; max?: number }) {
  const parsed = Math.round(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  const min = options?.min ?? 1
  const max = options?.max ?? 999
  if (parsed < min || parsed > max) return fallback
  return parsed
}

function sanitizeMinuteList(value: unknown, fallback: number[], options?: { maxItems?: number }) {
  if (!Array.isArray(value)) return fallback
  const seen = new Set<number>()
  for (const item of value) {
    const minutes = sanitizePositiveInteger(item, 0, { min: 0, max: 240 })
    if (minutes > 0) seen.add(minutes)
  }
  const next = Array.from(seen).sort((left, right) => left - right)
  if (next.length === 0) return fallback
  return next.slice(0, options?.maxItems ?? 6)
}

function sanitizeTargetPath(value: unknown) {
  if (typeof value !== 'string') return DEFAULT_BREAK_GUARD_CONFIG.targetPath
  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return DEFAULT_BREAK_GUARD_CONFIG.targetPath
  }
  return trimmed
}

export function sanitizeBreakGuardConfig(value: unknown): BreakGuardConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_BREAK_GUARD_CONFIG.enabled,
    promptDelaySeconds: sanitizePositiveInteger(
      raw.promptDelaySeconds,
      DEFAULT_BREAK_GUARD_CONFIG.promptDelaySeconds,
      { min: 0, max: 120 },
    ),
    presetMinutes: sanitizeMinuteList(raw.presetMinutes, DEFAULT_BREAK_GUARD_CONFIG.presetMinutes, { maxItems: 6 }),
    allowCustomMinutes:
      typeof raw.allowCustomMinutes === 'boolean'
        ? raw.allowCustomMinutes
        : DEFAULT_BREAK_GUARD_CONFIG.allowCustomMinutes,
    targetPath: sanitizeTargetPath(raw.targetPath),
    alertStrength:
      raw.alertStrength === 'gentle' || raw.alertStrength === 'strong'
        ? raw.alertStrength
        : DEFAULT_BREAK_GUARD_CONFIG.alertStrength,
    snoozeMinutes: sanitizeMinuteList(raw.snoozeMinutes, DEFAULT_BREAK_GUARD_CONFIG.snoozeMinutes, { maxItems: 4 }),
    recordBreakLogs:
      typeof raw.recordBreakLogs === 'boolean'
        ? raw.recordBreakLogs
        : DEFAULT_BREAK_GUARD_CONFIG.recordBreakLogs,
  }
}

function dispatchBreakGuardConfigChange(config: BreakGuardConfig) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(BREAK_GUARD_UPDATED_EVENT, { detail: config }))
}

export function readBreakGuardConfig() {
  const cached = getClientPreferenceCacheStatus(
    'break_guard_config',
    (value): value is BreakGuardConfig => Boolean(value && typeof value === 'object'),
  )
  if (cached.value) {
    return sanitizeBreakGuardConfig(cached.value)
  }
  if (cached.hasEntry || hasLoadedClientPreferences()) {
    return DEFAULT_BREAK_GUARD_CONFIG
  }

  try {
    const raw = window.localStorage.getItem(BREAK_GUARD_STORAGE_KEY)
    if (raw) return sanitizeBreakGuardConfig(JSON.parse(raw))
  } catch {
    return DEFAULT_BREAK_GUARD_CONFIG
  }

  return DEFAULT_BREAK_GUARD_CONFIG
}

export function saveBreakGuardConfig(config: BreakGuardConfig) {
  const sanitized = sanitizeBreakGuardConfig(config)
  dispatchBreakGuardConfigChange(sanitized)
  void saveClientPreference('break_guard_config', sanitized).then((saved) => {
    dispatchBreakGuardConfigChange(sanitizeBreakGuardConfig(saved.value))
  })
  return sanitized
}

export function readBreakGuardLogs(): BreakGuardLogEntry[] {
  try {
    const raw = window.localStorage.getItem(BREAK_GUARD_LOG_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is BreakGuardLogEntry => Boolean(item?.id)) : []
  } catch {
    return []
  }
}

export function appendBreakGuardLog(entry: BreakGuardLogEntry) {
  try {
    const next = [entry, ...readBreakGuardLogs()].slice(0, 200)
    window.localStorage.setItem(BREAK_GUARD_LOG_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Ignore local log failures.
  }
}

export function updateBreakGuardLog(id: string, updater: Partial<BreakGuardLogEntry>) {
  try {
    const next = readBreakGuardLogs().map((entry) => (entry.id === id ? { ...entry, ...updater } : entry))
    window.localStorage.setItem(BREAK_GUARD_LOG_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Ignore local log failures.
  }
}
