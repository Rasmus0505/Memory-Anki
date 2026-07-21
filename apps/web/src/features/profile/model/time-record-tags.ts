import type { SessionKind } from '@/entities/session/model'
import { formatSessionKind } from '@/entities/session/model'

export const BUILTIN_TIME_RECORD_TAGS = [
  { id: 'review', name: '正式复习', builtin: true as const },
  { id: 'practice', name: '练习', builtin: true as const },
  { id: 'quiz', name: '做题', builtin: true as const },
  { id: 'palace_edit', name: '宫殿编辑', builtin: true as const },
] as const

export type BuiltinTimeRecordTagId = (typeof BUILTIN_TIME_RECORD_TAGS)[number]['id']

export interface CustomTimeRecordTag {
  id: string
  name: string
  createdAt: string
}

export interface TimeRecordTagOption {
  id: string
  name: string
  builtin: boolean
}

export const QUICK_ADD_MINUTE_PRESETS = [15, 25, 30, 45, 60, 90] as const

export function isBuiltinTimeRecordTagId(value: string): value is BuiltinTimeRecordTagId {
  return BUILTIN_TIME_RECORD_TAGS.some((tag) => tag.id === value)
}

export function normalizeCustomTimeRecordTags(value: unknown): CustomTimeRecordTag[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: CustomTimeRecordTag[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const id = String(raw.id || '').trim()
    const name = String(raw.name || '').trim()
    if (!id || !name) continue
    if (isBuiltinTimeRecordTagId(id) || isBuiltinTimeRecordTagId(name)) continue
    if (seen.has(id)) continue
    seen.add(id)
    result.push({
      id: id.slice(0, 64),
      name: name.slice(0, 20),
      createdAt:
        typeof raw.createdAt === 'string' && raw.createdAt
          ? raw.createdAt
          : new Date().toISOString(),
    })
  }
  return result
}

export function listTimeRecordTagOptions(
  customTags: CustomTimeRecordTag[] = [],
): TimeRecordTagOption[] {
  return [
    ...BUILTIN_TIME_RECORD_TAGS.map((tag) => ({
      id: tag.id,
      name: tag.name,
      builtin: true,
    })),
    ...customTags.map((tag) => ({
      id: tag.id,
      name: tag.name,
      builtin: false,
    })),
  ]
}

export function resolveTagName(
  tagId: string,
  customTags: CustomTimeRecordTag[] = [],
): string {
  const builtin = BUILTIN_TIME_RECORD_TAGS.find((tag) => tag.id === tagId)
  if (builtin) return builtin.name
  const custom = customTags.find((tag) => tag.id === tagId)
  if (custom) return custom.name
  return tagId
}

export function validateCustomTagName(
  name: string,
  customTags: CustomTimeRecordTag[] = [],
): { error: string } | { value: string } {
  const trimmed = name.trim()
  if (!trimmed) return { error: '标签名不能为空。' }
  if (trimmed.length > 20) return { error: '标签名最多 20 个字符。' }
  if (isBuiltinTimeRecordTagId(trimmed)) {
    return { error: '不能与内置标签重名。' }
  }
  if (
    BUILTIN_TIME_RECORD_TAGS.some((tag) => tag.name === trimmed) ||
    customTags.some((tag) => tag.name === trimmed)
  ) {
    return { error: '标签已存在。' }
  }
  return { value: trimmed }
}

export function createCustomTimeRecordTag(
  name: string,
  customTags: CustomTimeRecordTag[] = [],
  now = new Date(),
): { error: string } | { tag: CustomTimeRecordTag; tags: CustomTimeRecordTag[] } {
  const validated = validateCustomTagName(name, customTags)
  if ('error' in validated) return validated
  const tag: CustomTimeRecordTag = {
    id: `tag_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: validated.value,
    createdAt: now.toISOString(),
  }
  return { tag, tags: [...customTags, tag] }
}

export function tagIdToSessionKind(tagId: string): SessionKind {
  if (isBuiltinTimeRecordTagId(tagId)) return tagId
  return 'custom'
}

export function formatDefaultQuickAddTitle(tagName: string, date = new Date()) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hour = `${date.getHours()}`.padStart(2, '0')
  const minute = `${date.getMinutes()}`.padStart(2, '0')
  return `${tagName} · ${month}-${day} ${hour}:${minute}`
}

export function formatSessionKindOrTag(
  kind: SessionKind | string,
  activityTagLabel?: string | null,
) {
  if (activityTagLabel?.trim()) return activityTagLabel.trim()
  return formatSessionKind(kind)
}
