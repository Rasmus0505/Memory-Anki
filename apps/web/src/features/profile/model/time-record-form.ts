import type {
  SessionCompletionMethod,
  SessionKind,
  TimeSessionRecord,
} from '@/entities/session/model'

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
  effectiveSeconds: string
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
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000)
    .toISOString()
    .slice(0, 16)
}

export function formatTableDate(dateString: string) {
  return new Date(dateString).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function formatTableTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
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
    effectiveSeconds: record ? String(record.effectiveSeconds) : '0',
    pauseCount: record ? String(record.pauseCount) : '0',
    completionMethod: record?.completionMethod ?? 'manual_complete',
    durationEdited: record?.durationEdited ?? false,
  }
}

export function parseTimeRecordFormState(
  form: TimeRecordFormState,
  sourceRecord?: TimeSessionRecord | null,
): { error: string } | { value: TimeRecordMutationPayload } {
  const title = form.title.trim()
  const startedAt = form.startedAt ? new Date(form.startedAt) : null
  const endedAt = form.endedAt ? new Date(form.endedAt) : null
  const effectiveSeconds = Number(form.effectiveSeconds)
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
  if (Number.isNaN(effectiveSeconds) || effectiveSeconds < 0) {
    return { error: '有效时长必须是大于等于 0 的数字。' }
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
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      effectiveSeconds,
      pauseCount,
      completionMethod: form.completionMethod,
      durationEdited: form.durationEdited || durationChanged,
    },
  }
}
