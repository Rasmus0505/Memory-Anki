import {
  getClientPreferenceCacheStatus,
  hasLoadedClientPreferences,
  saveClientPreference,
} from '@/shared/preferences/clientPreferences'

export type BreakGuardAlertStrength = 'strong' | 'gentle'

export interface BreakGuardConfig {
  schemaVersion?: number
  enabled: boolean
  promptOnWindowLeave: boolean
  promptDelaySeconds: number
  presetMinutes: number[]
  allowCustomMinutes: boolean
  autoFinishOnStudyReturn: boolean
  resumeInterruptedStudyOnReturn: boolean
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
export const BREAK_GUARD_CONFIG_VERSION = 2

const LEGACY_DEFAULT_BREAK_GUARD_CONFIG = {
  enabled: true,
  promptDelaySeconds: 5,
  presetMinutes: [1, 3],
  allowCustomMinutes: true,
  autoFinishOnStudyReturn: true,
  resumeInterruptedStudyOnReturn: true,
  targetPath: '/freestyle',
  alertStrength: 'strong' as const,
  snoozeMinutes: [1, 3, 5],
  recordBreakLogs: true,
}

export const DEFAULT_BREAK_GUARD_CONFIG: BreakGuardConfig = {
  schemaVersion: BREAK_GUARD_CONFIG_VERSION,
  enabled: true,
  promptOnWindowLeave: false,
  promptDelaySeconds: 60,
  presetMinutes: [5],
  allowCustomMinutes: true,
  autoFinishOnStudyReturn: false,
  resumeInterruptedStudyOnReturn: false,
  targetPath: '/freestyle',
  alertStrength: 'gentle',
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

function isSameLegacyValue(value: unknown, legacyDefault: unknown) {
  if (!Array.isArray(value) || !Array.isArray(legacyDefault)) return value === legacyDefault
  return value.length === legacyDefault.length && value.every((item, index) => item === legacyDefault[index])
}

function migrateLegacyField<T>(
  value: unknown,
  legacyDefault: T,
  currentDefault: T,
  isLegacyConfig: boolean,
) {
  if (!isLegacyConfig || !isSameLegacyValue(value, legacyDefault)) return value
  return currentDefault
}

export function sanitizeBreakGuardConfig(value: unknown): BreakGuardConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const parsedSchemaVersion = Number(raw.schemaVersion)
  const schemaVersion = Number.isFinite(parsedSchemaVersion) ? Math.round(parsedSchemaVersion) : 1
  const isLegacyConfig = schemaVersion < BREAK_GUARD_CONFIG_VERSION
  return {
    schemaVersion: BREAK_GUARD_CONFIG_VERSION,
    enabled:
      typeof raw.enabled === 'boolean'
        ? (migrateLegacyField(
            raw.enabled,
            LEGACY_DEFAULT_BREAK_GUARD_CONFIG.enabled,
            DEFAULT_BREAK_GUARD_CONFIG.enabled,
            isLegacyConfig,
          ) as boolean)
        : DEFAULT_BREAK_GUARD_CONFIG.enabled,
    promptOnWindowLeave:
      typeof raw.promptOnWindowLeave === 'boolean'
        ? raw.promptOnWindowLeave
        : DEFAULT_BREAK_GUARD_CONFIG.promptOnWindowLeave,
    promptDelaySeconds: sanitizePositiveInteger(
      migrateLegacyField(
        raw.promptDelaySeconds,
        LEGACY_DEFAULT_BREAK_GUARD_CONFIG.promptDelaySeconds,
        DEFAULT_BREAK_GUARD_CONFIG.promptDelaySeconds,
        isLegacyConfig,
      ),
      DEFAULT_BREAK_GUARD_CONFIG.promptDelaySeconds,
      { min: 0, max: 120 },
    ),
    presetMinutes: sanitizeMinuteList(
      migrateLegacyField(
        raw.presetMinutes,
        LEGACY_DEFAULT_BREAK_GUARD_CONFIG.presetMinutes,
        DEFAULT_BREAK_GUARD_CONFIG.presetMinutes,
        isLegacyConfig,
      ),
      DEFAULT_BREAK_GUARD_CONFIG.presetMinutes,
      { maxItems: 6 },
    ),
    allowCustomMinutes:
      typeof raw.allowCustomMinutes === 'boolean'
        ? (migrateLegacyField(
            raw.allowCustomMinutes,
            LEGACY_DEFAULT_BREAK_GUARD_CONFIG.allowCustomMinutes,
            DEFAULT_BREAK_GUARD_CONFIG.allowCustomMinutes,
            isLegacyConfig,
          ) as boolean)
        : DEFAULT_BREAK_GUARD_CONFIG.allowCustomMinutes,
    autoFinishOnStudyReturn:
      typeof raw.autoFinishOnStudyReturn === 'boolean'
        ? (migrateLegacyField(
            raw.autoFinishOnStudyReturn,
            LEGACY_DEFAULT_BREAK_GUARD_CONFIG.autoFinishOnStudyReturn,
            DEFAULT_BREAK_GUARD_CONFIG.autoFinishOnStudyReturn,
            isLegacyConfig,
          ) as boolean)
        : DEFAULT_BREAK_GUARD_CONFIG.autoFinishOnStudyReturn,
    resumeInterruptedStudyOnReturn:
      typeof raw.resumeInterruptedStudyOnReturn === 'boolean'
        ? (migrateLegacyField(
            raw.resumeInterruptedStudyOnReturn,
            LEGACY_DEFAULT_BREAK_GUARD_CONFIG.resumeInterruptedStudyOnReturn,
            DEFAULT_BREAK_GUARD_CONFIG.resumeInterruptedStudyOnReturn,
            isLegacyConfig,
          ) as boolean)
        : DEFAULT_BREAK_GUARD_CONFIG.resumeInterruptedStudyOnReturn,
    targetPath: sanitizeTargetPath(raw.targetPath),
    alertStrength:
      raw.alertStrength === 'gentle' || raw.alertStrength === 'strong'
        ? (migrateLegacyField(
            raw.alertStrength,
            LEGACY_DEFAULT_BREAK_GUARD_CONFIG.alertStrength,
            DEFAULT_BREAK_GUARD_CONFIG.alertStrength,
            isLegacyConfig,
          ) as BreakGuardAlertStrength)
        : DEFAULT_BREAK_GUARD_CONFIG.alertStrength,
    snoozeMinutes: sanitizeMinuteList(
      migrateLegacyField(
        raw.snoozeMinutes,
        LEGACY_DEFAULT_BREAK_GUARD_CONFIG.snoozeMinutes,
        DEFAULT_BREAK_GUARD_CONFIG.snoozeMinutes,
        isLegacyConfig,
      ),
      DEFAULT_BREAK_GUARD_CONFIG.snoozeMinutes,
      { maxItems: 4 },
    ),
    recordBreakLogs:
      typeof raw.recordBreakLogs === 'boolean'
        ? (migrateLegacyField(
            raw.recordBreakLogs,
            LEGACY_DEFAULT_BREAK_GUARD_CONFIG.recordBreakLogs,
            DEFAULT_BREAK_GUARD_CONFIG.recordBreakLogs,
            isLegacyConfig,
          ) as boolean)
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

export function resetBreakGuardConfig() {
  const nextConfig = DEFAULT_BREAK_GUARD_CONFIG
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(BREAK_GUARD_STORAGE_KEY)
  }
  dispatchBreakGuardConfigChange(nextConfig)
  void saveClientPreference('break_guard_config', nextConfig).then((saved) => {
    dispatchBreakGuardConfigChange(sanitizeBreakGuardConfig(saved.value))
  })
  return nextConfig
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
