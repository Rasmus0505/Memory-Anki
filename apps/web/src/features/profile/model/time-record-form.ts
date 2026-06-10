import type {
  SessionCompletionMethod,
  SessionKind,
  TimeSessionRecord,
} from '@/entities/session/model'
import {
  formatLocalApiDateTime,
  formatLocalDateTimeInputValue,
  parseApiDateTime,
} from '@/shared/lib/dateTime'

export const sessionKindOptions: SessionKind[] = [
  'review',
  'practice',
  'palace_edit',
]

export const completionMethodOptions: SessionCompletionMethod[] = [
  'manual_complete',
  'auto_complete',
  'restart',
  'left_page',
  'saved',
]

export interface TimeRecordFormState {
  id?: string
  title: string
  kind: SessionKind
  palaceId: string
  startedAt: string
  endedAt: string
  effectiveMinutes: string
  pauseCount: string
  completionMethod: SessionCompletionMethod
  durationEdited: boolean
}

export interface TimeRecordMutationPayload {
  title: string
  kind: SessionKind
  palaceId: number | null
  startedAt: string
  endedAt: string
  effectiveSeconds: number
  pauseCount: number
  completionMethod: SessionCompletionMethod
  durationEdited: boolean
}

export function isTimeRecordAboveThreshold(
  seconds: number,
  thresholdSeconds: number,
) {
  return seconds > thresholdSeconds
}

export function toLocalDateTimeInputValue(value: string) {
  return formatLocalDateTimeInputValue(value)
}

export function formatEffectiveSecondsAsMinutes(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0'
  const minutes = seconds / 60
  if (Number.isInteger(minutes)) return String(minutes)
  return String(Number(minutes.toFixed(2)))
}

export function parseEffectiveMinutesToSeconds(value: string) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes < 0) return null
  return Math.round(minutes * 60)
}

export function formatTableDate(dateString: string) {
  return parseApiDateTime(dateString).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function formatTableTime(dateString: string) {
  return parseApiDateTime(dateString).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatTableDateTime(dateString: string) {
  const date = parseApiDateTime(dateString)
  return `${date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })} ${date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })}`
}

export function buildTimeRecordFormState(
  record?: TimeSessionRecord | null,
): TimeRecordFormState {
  return {
    id: record?.id,
    title: record?.title ?? '',
    kind: record?.kind ?? 'review',
    palaceId: record?.palaceId == null ? '' : String(record.palaceId),
    startedAt: record ? toLocalDateTimeInputValue(record.startedAt) : '',
    endedAt: record ? toLocalDateTimeInputValue(record.endedAt) : '',
    effectiveMinutes: record
      ? formatEffectiveSecondsAsMinutes(record.effectiveSeconds)
      : '0',
    pauseCount: record ? String(record.pauseCount) : '0',
    completionMethod: record?.completionMethod ?? 'manual_complete',
    durationEdited: record?.durationEdited ?? false,
  }
}

export function calculateTimeRangeSeconds(
  startedAtValue: string,
  endedAtValue: string,
) {
  const startedAt = startedAtValue ? new Date(startedAtValue) : null
  const endedAt = endedAtValue ? new Date(endedAtValue) : null
  if (!startedAt || !endedAt) return null
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    return null
  }
  if (endedAt < startedAt) return null
  return Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
}

export function calculateEndedAtFromEffectiveMinutes(
  startedAtValue: string,
  effectiveMinutesValue: string,
) {
  const startedAt = startedAtValue ? new Date(startedAtValue) : null
  const effectiveSeconds = parseEffectiveMinutesToSeconds(
    effectiveMinutesValue,
  )
  if (!startedAt || Number.isNaN(startedAt.getTime())) return null
  if (effectiveSeconds === null) return null

  const endedAt = new Date(startedAt.getTime() + effectiveSeconds * 1000)
  return formatLocalDateTimeInputValue(formatLocalApiDateTime(endedAt))
}

export function applyTimeRecordFormPatch(
  current: TimeRecordFormState,
  patch: Partial<TimeRecordFormState>,
): TimeRecordFormState {
  const next = { ...current, ...patch }
  const durationChanged = patch.effectiveMinutes !== undefined
  const startedAtChanged = patch.startedAt !== undefined
  const endedAtChanged = patch.endedAt !== undefined

  if (durationChanged) {
    next.durationEdited = true
    const endedAt = calculateEndedAtFromEffectiveMinutes(
      next.startedAt,
      next.effectiveMinutes,
    )
    if (endedAt !== null) next.endedAt = endedAt
    return next
  }

  if (patch.durationEdited !== undefined) {
    next.durationEdited = patch.durationEdited
    if (patch.durationEdited) {
      const endedAt = calculateEndedAtFromEffectiveMinutes(
        next.startedAt,
        next.effectiveMinutes,
      )
      if (endedAt !== null) next.endedAt = endedAt
      return next
    }

    const seconds = calculateTimeRangeSeconds(next.startedAt, next.endedAt)
    if (seconds !== null) {
      next.effectiveMinutes = formatEffectiveSecondsAsMinutes(seconds)
    }
    return next
  }

  if (startedAtChanged) {
    const effectiveSeconds = parseEffectiveMinutesToSeconds(
      next.effectiveMinutes,
    )
    if (effectiveSeconds !== null && effectiveSeconds > 0) {
      const endedAt = calculateEndedAtFromEffectiveMinutes(
        next.startedAt,
        next.effectiveMinutes,
      )
      if (endedAt !== null) next.endedAt = endedAt
      return next
    }
  }

  if (endedAtChanged && !next.durationEdited) {
    const seconds = calculateTimeRangeSeconds(next.startedAt, next.endedAt)
    if (seconds !== null) {
      next.effectiveMinutes = formatEffectiveSecondsAsMinutes(seconds)
    }
  }

  return next
}

export function parseTimeRecordFormState(
  form: TimeRecordFormState,
  sourceRecord?: TimeSessionRecord | null,
): { error: string } | { value: TimeRecordMutationPayload } {
  const title = form.title.trim()
  const startedAt = form.startedAt ? new Date(form.startedAt) : null
  const endedAt = form.endedAt ? new Date(form.endedAt) : null
  const effectiveSeconds = parseEffectiveMinutesToSeconds(
    form.effectiveMinutes,
  )
  const pauseCount = Number(form.pauseCount)
  const palaceId = form.palaceId.trim() === '' ? null : Number(form.palaceId)

  if (!title) return { error: '标题不能为空。' }
  if (!startedAt || Number.isNaN(startedAt.getTime())) {
    return { error: '开始时间不能为空。' }
  }
  if (!endedAt || Number.isNaN(endedAt.getTime())) {
    return { error: '结束时间不能为空。' }
  }
  if (endedAt < startedAt) return { error: '结束时间不能早于开始时间。' }
  if (effectiveSeconds === null) {
    return { error: '有效时长必须是大于等于 0 的分钟数。' }
  }
  if (Number.isNaN(pauseCount) || pauseCount < 0) {
    return { error: '暂停次数必须是大于等于 0 的数字。' }
  }
  if (palaceId != null && Number.isNaN(palaceId)) {
    return { error: '宫殿 ID 必须是数字。' }
  }

  const durationChanged = sourceRecord
    ? sourceRecord.effectiveSeconds !== effectiveSeconds
    : effectiveSeconds > 0

  return {
    value: {
      title,
      kind: form.kind,
      palaceId,
      startedAt: formatLocalApiDateTime(startedAt),
      endedAt: formatLocalApiDateTime(endedAt),
      effectiveSeconds,
      pauseCount,
      completionMethod: form.completionMethod,
      durationEdited: form.durationEdited || durationChanged,
    },
  }
}
