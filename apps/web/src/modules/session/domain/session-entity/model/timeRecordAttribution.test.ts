import { describe, expect, it } from 'vitest'
import {
  attributionFromMetadata,
  attributionToMetadata,
  buildSurfaceAttribution,
  composeAttribution,
  formatAttributionLabel,
  hasAttributionTarget,
  normalizeAttribution,
} from './timeRecordAttribution'

/**
 * Regression guard for the attribution gap: the ledger used to store only
 * `session_key` + `completion_method`, so no time record could be totalled per
 * subject/chapter/unit.
 */
describe('time record attribution', () => {
  const full = {
    subjectId: 4,
    subjectName: '中国教育史',
    chapterId: 6,
    chapterName: '第一节 民国初年的教育改革',
    unitLabel: '夸美纽斯宫殿',
    palaceId: 12,
    scene: 'freestyle',
    behavior: 'flip',
  }

  it('serializes the four dimensions into snake_case ledger metadata', () => {
    expect(attributionToMetadata(full)).toEqual({
      subject_id: 4,
      subject_name: '中国教育史',
      chapter_id: 6,
      chapter_name: '第一节 民国初年的教育改革',
      unit_label: '夸美纽斯宫殿',
      palace_id: 12,
      scene: 'freestyle',
      behavior: 'flip',
    })
  })

  it('round-trips through the ledger metadata bag', () => {
    expect(attributionFromMetadata(attributionToMetadata(full))).toEqual(
      normalizeAttribution(full),
    )
  })

  it('reads snake_case and camelCase metadata alike', () => {
    expect(attributionFromMetadata({ subject_id: 4, subject_name: '中国教育史' }).subjectId).toBe(4)
    expect(attributionFromMetadata({ subjectId: 5, subjectName: '外国教育史' }).subjectId).toBe(5)
  })

  it('drops blank and non-positive values instead of guessing', () => {
    expect(
      attributionToMetadata({
        subjectId: 0,
        subjectName: '   ',
        chapterId: -3,
        unitLabel: '',
        palaceId: null,
      }),
    ).toEqual({})
  })

  it('reports whether the record names a study target', () => {
    expect(hasAttributionTarget(full)).toBe(true)
    expect(hasAttributionTarget({ scene: 'dashboard', behavior: 'browse' })).toBe(false)
    expect(hasAttributionTarget({ palaceId: 9 })).toBe(true)
    expect(hasAttributionTarget(null)).toBe(false)
  })

  it('composes the 学科-章节-单元-场景-行为 chain', () => {
    expect(formatAttributionLabel(full)).toBe(
      '中国教育史-第一节 民国初年的教育改革-夸美纽斯宫殿-随心-翻卡',
    )
  })

  it('skips absent parts of the chain rather than leaving separators', () => {
    expect(formatAttributionLabel({ palaceId: 3, scene: 'quiz', behavior: 'quiz' })).toBe('做题-做题')
    expect(formatAttributionLabel({ subjectId: 2, scene: 'freestyle' })).toBe('学科#2-随心')
    expect(formatAttributionLabel({})).toBe('')
  })

  it('falls back to ids when names are missing', () => {
    expect(formatAttributionLabel({ subjectId: 4, chapterId: 6 })).toBe('学科#4-章节#6')
  })

  it('merges sources with earlier entries taking priority', () => {
    const merged = composeAttribution(
      { palaceId: 12, scene: 'freestyle' },
      { subjectId: 4, subjectName: '中国教育史', palaceId: 99 },
    )
    expect(merged.palaceId).toBe(12)
    expect(merged.subjectId).toBe(4)
  })

  it('builds surface attribution from scene plus knowledge binding', () => {
    const result = buildSurfaceAttribution({
      scene: 'freestyle',
      behavior: 'flip',
      palaceId: 12,
      unitLabel: '夸美纽斯宫殿',
      binding: {
        subjectId: 4,
        subjectName: '中国教育史',
        chapterId: 6,
        chapterName: '第一节',
      },
    })
    expect(formatAttributionLabel(result)).toBe('中国教育史-第一节-夸美纽斯宫殿-随心-翻卡')
  })

  it('still records scene and palace when no knowledge binding is cached', () => {
    const result = buildSurfaceAttribution({
      scene: 'palace_edit',
      behavior: 'edit',
      palaceId: 12,
      binding: null,
    })
    expect(result.subjectId ?? null).toBeNull()
    expect(result.palaceId).toBe(12)
    expect(hasAttributionTarget(result)).toBe(true)
  })

  it('keeps an unknown scene label readable', () => {
    expect(formatAttributionLabel({ scene: 'future_surface' })).toBe('future_surface')
    expect(formatAttributionLabel({ behavior: 'future_action' })).toBe('future_action')
  })
})
