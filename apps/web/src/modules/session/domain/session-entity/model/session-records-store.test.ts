import { describe, expect, it } from 'vitest'
import {
  formatClientSource,
  formatTimeRecordTagLabel,
} from '@/modules/session/domain/session-entity/model'

// Trend/breakdown aggregation moved to GET /study-sessions/time-record-analytics;
// the local implementations and their tests were removed with it.
describe('session-record formatters', () => {
  it('formats time record client source labels', () => {
    expect(formatClientSource('desktop')).toBe('电脑端')
    expect(formatClientSource('pwa')).toBe('PWA 端')
    expect(formatClientSource(null)).toBe('未知端')
  })

  it('formats time record tags as route plus behavior', () => {
    const base = {
      title: '随心模式',
      sourceKind: null,
      palaceId: null,
      englishCourseId: null,
      activityTag: null,
      activityTagLabel: null,
      sceneSegments: [] as [],
    }

    expect(formatTimeRecordTagLabel({ ...base, kind: 'practice' })).toBe('随心-翻卡')
    expect(formatTimeRecordTagLabel({ ...base, kind: 'quiz' })).toBe('随心-做题')
  })

  it('uses the recorded scene and keeps custom behavior labels', () => {
    expect(formatTimeRecordTagLabel({
      kind: 'custom',
      title: '阅读材料',
      sourceKind: 'english_reading',
      palaceId: null,
      englishCourseId: null,
      activityTag: 'tag_notes',
      activityTagLabel: '整理笔记',
      sceneSegments: [],
    })).toBe('英语阅读-整理笔记')
  })
})
