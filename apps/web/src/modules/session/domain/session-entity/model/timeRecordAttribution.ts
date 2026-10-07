/**
 * Four-dimension attribution for a time record.
 *
 * The ledger used to store only `session_key` + `completion_method`, so every
 * row rendered as `06:44 学习时段` and nothing could be totalled per subject.
 * These helpers build the attribution chain from the context a surface already
 * has (palace id, scene, active behaviour) plus whatever knowledge binding is
 * cached locally.
 *
 * Every field is optional: a dashboard visit legitimately has no subject, and
 * an unbound palace has no chapter. Absent stays absent rather than guessing.
 */

export type TimeRecordScene =
  | 'freestyle'
  | 'palace_edit'
  | 'review'
  | 'quiz'
  | 'practice'
  | 'english'
  | 'english_reading'
  | 'dashboard'
  | 'knowledge'
  | 'settings'
  | 'custom'

export type TimeRecordBehavior =
  | 'flip'
  | 'quiz'
  | 'edit'
  | 'lookup'
  | 'review'
  | 'reading'
  | 'listening'
  | 'browse'

export interface TimeRecordAttribution {
  subjectId?: number | null
  subjectName?: string | null
  chapterId?: number | null
  chapterName?: string | null
  unitLabel?: string | null
  palaceId?: number | null
  palaceSegmentId?: number | null
  scene?: TimeRecordScene | string | null
  behavior?: TimeRecordBehavior | string | null
}

export const SCENE_LABELS: Record<string, string> = {
  freestyle: '随心',
  palace_edit: '宫殿编辑',
  review: '复习',
  quiz: '做题',
  practice: '练习',
  english: '英语',
  english_reading: '英语阅读',
  dashboard: '仪表盘',
  knowledge: '知识体系',
  settings: '设置',
  custom: '其他',
}

export const BEHAVIOR_LABELS: Record<string, string> = {
  flip: '翻卡',
  quiz: '做题',
  edit: '编辑',
  lookup: '查词',
  review: '复习',
  reading: '阅读',
  listening: '听力',
  browse: '浏览',
}

/**
 * Knowledge binding resolved for a palace, as published by the knowledge UI.
 * The cache lives in `palaceKnowledgeBinding`; this is the shape contract.
 */
export interface PalaceKnowledgeBinding {
  subjectId: number | null
  subjectName: string | null
  chapterId: number | null
  chapterName: string | null
}

function clean(value: unknown, limit = 200): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text.slice(0, limit) : null
}

function positiveInt(value: unknown): number | null {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : null
}

/** Normalize attribution, dropping blanks and non-positive ids. */
export function normalizeAttribution(
  input: TimeRecordAttribution | null | undefined,
): TimeRecordAttribution {
  if (!input) return {}
  return {
    subjectId: positiveInt(input.subjectId),
    subjectName: clean(input.subjectName, 100),
    chapterId: positiveInt(input.chapterId),
    chapterName: clean(input.chapterName, 200),
    unitLabel: clean(input.unitLabel, 200),
    palaceId: positiveInt(input.palaceId),
    palaceSegmentId: positiveInt(input.palaceSegmentId),
    scene: clean(input.scene, 64),
    behavior: clean(input.behavior, 64),
  }
}

/** True when the record names what was studied, not merely that time passed. */
export function hasAttributionTarget(input: TimeRecordAttribution | null | undefined): boolean {
  const value = normalizeAttribution(input)
  return Boolean(value.subjectId || value.chapterId || value.palaceId || value.unitLabel)
}

/**
 * Flat metadata keys for the ledger `metadata` bag.
 *
 * snake_case matches the backend contract so the API can validate it directly.
 */
export function attributionToMetadata(
  input: TimeRecordAttribution | null | undefined,
): Record<string, string | number> {
  const value = normalizeAttribution(input)
  const mapping: Record<string, string | number> = {}
  if (value.subjectId) mapping.subject_id = value.subjectId
  if (value.subjectName) mapping.subject_name = value.subjectName
  if (value.chapterId) mapping.chapter_id = value.chapterId
  if (value.chapterName) mapping.chapter_name = value.chapterName
  if (value.unitLabel) mapping.unit_label = value.unitLabel
  if (value.palaceId) mapping.palace_id = value.palaceId
  if (value.palaceSegmentId) mapping.palace_segment_id = value.palaceSegmentId
  if (value.scene) mapping.scene = value.scene
  if (value.behavior) mapping.behavior = value.behavior
  return mapping
}

/** Read attribution back out of an API/ledger metadata bag. */
export function attributionFromMetadata(raw: unknown): TimeRecordAttribution {
  if (!raw || typeof raw !== 'object') return {}
  const source = raw as Record<string, unknown>
  const pick = (snake: string, camel: string) => source[snake] ?? source[camel]
  return normalizeAttribution({
    subjectId: pick('subject_id', 'subjectId') as number | null,
    subjectName: pick('subject_name', 'subjectName') as string | null,
    chapterId: pick('chapter_id', 'chapterId') as number | null,
    chapterName: pick('chapter_name', 'chapterName') as string | null,
    unitLabel: pick('unit_label', 'unitLabel') as string | null,
    palaceId: pick('palace_id', 'palaceId') as number | null,
    palaceSegmentId: pick('palace_segment_id', 'palaceSegmentId') as number | null,
    scene: pick('scene', 'scene') as string | null,
    behavior: pick('behavior', 'behavior') as string | null,
  })
}

/**
 * Compose the "学科-章节-单元-场景-行为" chain, skipping absent parts.
 */
export function formatAttributionLabel(input: TimeRecordAttribution | null | undefined): string {
  const value = normalizeAttribution(input)
  const parts = [
    value.subjectName || (value.subjectId ? `学科#${value.subjectId}` : null),
    value.chapterName || (value.chapterId ? `章节#${value.chapterId}` : null),
    value.unitLabel,
    value.scene ? (SCENE_LABELS[value.scene] ?? value.scene) : null,
    value.behavior ? (BEHAVIOR_LABELS[value.behavior] ?? value.behavior) : null,
  ]
  return parts.filter(Boolean).join('-')
}

/**
 * Merge attribution sources in priority order: explicit input wins, then the
 * palace's knowledge binding, then the palace id itself.
 */
export function composeAttribution(
  ...sources: Array<TimeRecordAttribution | null | undefined>
): TimeRecordAttribution {
  const merged: TimeRecordAttribution = {}
  for (const source of sources) {
    const value = normalizeAttribution(source)
    for (const [key, candidate] of Object.entries(value)) {
      if (candidate == null || candidate === '') continue
      if (merged[key as keyof TimeRecordAttribution] == null) {
        ;(merged as Record<string, unknown>)[key] = candidate
      }
    }
  }
  return merged
}

/** Build attribution from an active surface plus its palace knowledge binding. */
export function buildSurfaceAttribution(input: {
  scene?: TimeRecordScene | string | null
  behavior?: TimeRecordBehavior | string | null
  palaceId?: number | null
  palaceSegmentId?: number | null
  unitLabel?: string | null
  binding?: PalaceKnowledgeBinding | null
}): TimeRecordAttribution {
  return composeAttribution(
    {
      scene: input.scene ?? null,
      behavior: input.behavior ?? null,
      palaceId: input.palaceId ?? null,
      palaceSegmentId: input.palaceSegmentId ?? null,
      unitLabel: input.unitLabel ?? null,
    },
    input.binding
      ? {
          subjectId: input.binding.subjectId,
          subjectName: input.binding.subjectName,
          chapterId: input.binding.chapterId,
          chapterName: input.binding.chapterName,
        }
      : null,
  )
}
