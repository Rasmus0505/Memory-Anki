import { describe, expect, it } from 'vitest'
import {
  DWELL_LIVE_SESSION_KEY,
  DWELL_RESUME_WINDOW_MS,
  dwellSessionKeyForRecord,
  formatDwellRecordTitle,
  isDwellExcludedPath,
  isDwellSessionKey,
  pickDominantFragmentKind,
  resolveDwellFragment,
  shouldResumeDwell,
} from './dwellPolicy'

describe('dwellPolicy', () => {
  it('classifies excluded settings and overlay routes', () => {
    expect(isDwellExcludedPath('/profile')).toBe(true)
    expect(isDwellExcludedPath('/profile/timer')).toBe(true)
    expect(isDwellExcludedPath('/profile/backups?x=1')).toBe(true)
    expect(isDwellExcludedPath('/timer-overlay')).toBe(true)
    expect(isDwellExcludedPath('/dev/tokens')).toBe(true)
    expect(isDwellExcludedPath('/freestyle')).toBe(false)
    expect(isDwellExcludedPath('/dashboard')).toBe(false)
  })

  it('maps countable pages to route fragments', () => {
    expect(resolveDwellFragment('/dashboard')).toMatchObject({
      countable: true,
      scene: 'dashboard',
      title: '洞察',
    })
    expect(resolveDwellFragment('/palaces/12/quiz')).toMatchObject({
      countable: true,
      scene: 'quiz',
      kind: 'quiz',
      palaceId: 12,
      title: '宫殿做题',
    })
    expect(resolveDwellFragment('/english/listening/courses/4')).toMatchObject({
      countable: true,
      scene: 'english',
      englishCourseId: 4,
      title: '英语课程',
    })
    expect(resolveDwellFragment('/profile/ai')).toMatchObject({
      countable: false,
      title: '设置',
    })
  })

  it('resumes the same block inside 15 minutes and splits after', () => {
    expect(shouldResumeDwell(1_000, 1_000 + DWELL_RESUME_WINDOW_MS)).toBe(true)
    expect(shouldResumeDwell(1_000, 1_000 + DWELL_RESUME_WINDOW_MS + 1)).toBe(false)
    expect(shouldResumeDwell(null, 99_000)).toBe(true)
  })

  it('formats the list title from the local start clock', () => {
    const startedAt = new Date(2026, 8, 17, 9, 12, 0)
    expect(formatDwellRecordTitle(startedAt)).toBe('09:12 学习时段')
  })

  it('identifies dwell keys and picks the longest fragment kind', () => {
    expect(isDwellSessionKey(DWELL_LIVE_SESSION_KEY)).toBe(true)
    expect(isDwellSessionKey(dwellSessionKeyForRecord('abc'))).toBe(true)
    expect(isDwellSessionKey('palace:1')).toBe(false)
    expect(pickDominantFragmentKind([
      { kind: 'practice', effectiveSeconds: 20 },
      { kind: 'quiz', effectiveSeconds: 40 },
      { kind: 'practice', effectiveSeconds: 15 },
    ], 'practice')).toBe('quiz')
  })
})
