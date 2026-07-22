import type {
  SessionCompletionMethod,
  SessionKind,
  TimeSessionRecord,
} from '@/modules/session/public'
import {
  formatLocalDateTimeInputFromDate,
  formatLocalDateTimeInputValue,
  formatUtcApiDateTime,
  parseApiDateTime,
  parseLocalDateTimeInputValue,
} from '@/shared/lib/dateTime'
import {
  formatDefaultQuickAddTitle,
  isBuiltinTimeRecordTagId,
  resolveTagName,
  tagIdToSessionKind,
  type CustomTimeRecordTag,
} from '@/modules/settings/ui/profile/model/time-record-tags'

export const sessionKindOptions: SessionKind[] = [
  'review',
  'practice',
  'quiz',
  'palace_edit',
  'custom',
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
  tagId: string
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
  activityTag: string | null
  activityTagLabel: string | null
}

export interface TimeRecordQuickAddFormState {
  tagId: string
  minutes: string
  date: string
  title: string
  titleEdited: boolean
  showAdvanced: boolean
  startedAt: string
  endedAt: string
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

function formatDefaultTimeRecordTitle(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  const second = `${date.getSeconds()}`.padStart(2, '0')
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`
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
  const defaultDate = new Date()
  const defaultInput = formatLocalDateTimeInputFromDate(defaultDate)
  const tagId =
    record?.activityTag?.trim() ||
    (record?.kind && record.kind !== 'custom' ? record.kind : 'review')

  return {
    id: record?.id,
    title: record?.title ?? formatDefaultTimeRecordTitle(defaultDate),
    kind: record?.kind ?? 'review',
    tagId,
    palaceId: record?.palaceId == null ? '' : String(record.palaceId),
    startedAt: record
      ? toLocalDateTimeInputValue(record.startedAt)
      : defaultInput,
    endedAt: record
      ? toLocalDateTimeInputValue(record.endedAt)
      : defaultInput,
    effectiveMinutes: record
      ? formatEffectiveSecondsAsMinutes(record.effectiveSeconds)
      : '0',
    pauseCount: record ? String(record.pauseCount) : '0',
    completionMethod: record?.completionMethod ?? 'manual_complete',
    durationEdited: record?.durationEdited ?? false,
  }
}

function formatLocalDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildTimeRecordQuickAddFormState(
  now = new Date(),
): TimeRecordQuickAddFormState {
  const dateTime = formatLocalDateTimeInputFromDate(now)
  return {
    tagId: 'review',
    minutes: '30',
    date: formatLocalDateInputValue(now),
    title: '',
    titleEdited: false,
    showAdvanced: false,
    startedAt: dateTime,
    endedAt: dateTime,
  }
}

export function applyTimeRecordQuickAddPatch(
  current: TimeRecordQuickAddFormState,
  patch: Partial<TimeRecordQuickAddFormState>,
  customTags: CustomTimeRecordTag[] = [],
  now = new Date(),
): TimeRecordQuickAddFormState {
  const next = { ...current, ...patch }
  const tagChanged = patch.tagId !== undefined
  const minutesChanged = patch.minutes !== undefined
  const dateChanged = patch.date !== undefined
  const titleChanged = patch.title !== undefined

  if (titleChanged && patch.title !== undefined) {
    next.titleEdited = true
  }

  if (tagChanged || minutesChanged || dateChanged || !next.titleEdited) {
    const bounds = calculateQuickAddBounds(next.date, next.minutes, now)
    if (bounds) {
      next.startedAt = bounds.startedAt
      next.endedAt = bounds.endedAt
    }
    if (!next.titleEdited) {
      const tagName = resolveTagName(next.tagId, customTags)
      const endDate = bounds ? new Date(bounds.endedAt) : now
      next.title = formatDefaultQuickAddTitle(tagName, endDate)
    }
  }

  return next
}

export function calculateQuickAddBounds(
  dateValue: string,
  minutesValue: string,
  now = new Date(),
): { startedAt: string; endedAt: string; effectiveSeconds: number } | null {
  const minutes = Number(minutesValue)
  if (!Number.isFinite(minutes) || minutes < 1 || !Number.isInteger(minutes)) {
    return null
  }
  const effectiveSeconds = minutes * 60
  const todayKey = formatLocalDateInputValue(now)
  let endedAtDate: Date
  if (!dateValue) {
    endedAtDate = now
  } else if (dateValue === todayKey) {
    endedAtDate = now
  } else {
    const [year, month, day] = dateValue.split('-').map(Number)
    if (!year || !month || !day) return null
    endedAtDate = new Date(year, month - 1, day, 12, 0, 0, 0)
  }
  if (Number.isNaN(endedAtDate.getTime())) return null
  const startedAtDate = new Date(endedAtDate.getTime() - effectiveSeconds * 1000)
  return {
    startedAt: formatLocalDateTimeInputFromDate(startedAtDate),
    endedAt: formatLocalDateTimeInputFromDate(endedAtDate),
    effectiveSeconds,
  }
}

export function parseTimeRecordQuickAddFormState(
  form: TimeRecordQuickAddFormState,
  customTags: CustomTimeRecordTag[] = [],
  now = new Date(),
): { error: string } | { value: TimeRecordMutationPayload } {
  if (!form.tagId.trim()) return { error: '请选择标签。' }

  const minutes = Number(form.minutes)
  if (!Number.isFinite(minutes) || minutes < 1 || !Number.isInteger(minutes)) {
    return { error: '时长必须是大于等于 1 的整数分钟。' }
  }

  let startedAt: Date
  let endedAt: Date
  let effectiveSeconds: number

  if (form.showAdvanced && form.startedAt && form.endedAt) {
    startedAt = parseLocalDateTimeInputValue(form.startedAt)
    endedAt = parseLocalDateTimeInputValue(form.endedAt)
    if (Number.isNaN(startedAt.getTime())) return { error: '开始时间不能为空。' }
    if (Number.isNaN(endedAt.getTime())) return { error: '结束时间不能为空。' }
    if (endedAt < startedAt) return { error: '结束时间不能早于开始时间。' }
    effectiveSeconds = minutes * 60
  } else {
    const bounds = calculateQuickAddBounds(form.date, form.minutes, now)
    if (!bounds) return { error: '时长必须是大于等于 1 的整数分钟。' }
    startedAt = parseLocalDateTimeInputValue(bounds.startedAt)
    endedAt = parseLocalDateTimeInputValue(bounds.endedAt)
    effectiveSeconds = bounds.effectiveSeconds
  }

  const tagName = resolveTagName(form.tagId, customTags)
  const title =
    form.title.trim() || formatDefaultQuickAddTitle(tagName, endedAt)
  const kind = tagIdToSessionKind(form.tagId)

  return {
    value: {
      title,
      kind,
      palaceId: null,
      startedAt: formatUtcApiDateTime(startedAt),
      endedAt: formatUtcApiDateTime(endedAt),
      effectiveSeconds,
      pauseCount: 0,
      completionMethod: 'manual_complete',
      durationEdited: true,
      activityTag: form.tagId,
      activityTagLabel: tagName,
    },
  }
}

export function calculateTimeRangeSeconds(
  startedAtValue: string,
  endedAtValue: string,
) {
  const startedAt = startedAtValue ? parseLocalDateTimeInputValue(startedAtValue) : null
  const endedAt = endedAtValue ? parseLocalDateTimeInputValue(endedAtValue) : null
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
  const startedAt = startedAtValue ? parseLocalDateTimeInputValue(startedAtValue) : null
  const effectiveSeconds = parseEffectiveMinutesToSeconds(
    effectiveMinutesValue,
  )
  if (!startedAt || Number.isNaN(startedAt.getTime())) return null
  if (effectiveSeconds === null) return null

  const endedAt = new Date(startedAt.getTime() + effectiveSeconds * 1000)
  return formatLocalDateTimeInputFromDate(endedAt)
}

export function applyTimeRecordFormPatch(
  current: TimeRecordFormState,
  patch: Partial<TimeRecordFormState>,
): TimeRecordFormState {
  const next = { ...current, ...patch }
  const durationChanged = patch.effectiveMinutes !== undefined
  const startedAtChanged = patch.startedAt !== undefined
  const endedAtChanged = patch.endedAt !== undefined

  if (patch.tagId !== undefined) {
    next.kind = tagIdToSessionKind(patch.tagId)
  } else if (patch.kind !== undefined && isBuiltinTimeRecordTagId(patch.kind)) {
    next.tagId = patch.kind
  }

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
  customTags: CustomTimeRecordTag[] = [],
): { error: string } | { value: TimeRecordMutationPayload } {
  const title = form.title.trim()
  const startedAt = form.startedAt ? parseLocalDateTimeInputValue(form.startedAt) : null
  const endedAt = form.endedAt ? parseLocalDateTimeInputValue(form.endedAt) : null
  const effectiveSeconds = parseEffectiveMinutesToSeconds(
    form.effectiveMinutes,
  )
  const pauseCount = Number(form.pauseCount)
  const palaceId = form.palaceId.trim() === '' ? null : Number(form.palaceId)
  const tagId = form.tagId.trim() || form.kind
  const kind = tagIdToSessionKind(tagId)
  const activityTag = tagId || null
  const activityTagLabel = activityTag
    ? resolveTagName(activityTag, customTags)
    : null

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
      kind,
      palaceId,
      startedAt: formatUtcApiDateTime(startedAt),
      endedAt: formatUtcApiDateTime(endedAt),
      effectiveSeconds,
      pauseCount,
      completionMethod: form.completionMethod,
      durationEdited: form.durationEdited || durationChanged,
      activityTag,
      activityTagLabel,
    },
  }
}
