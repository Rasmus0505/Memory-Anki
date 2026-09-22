import { describe, expect, it } from 'vitest'
import {
  DWELL_LIVE_SESSION_KEY,
  DWELL_RESUME_WINDOW_MS,
  applyDwellFragmentOverride,
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

  it('lets an open overlay replace the countable fragment without changing the route', () => {
    const freestyle = resolveDwellFragment('/freestyle')
    expect(applyDwellFragmentOverride(freestyle, {
      scene: 'quiz',
      kind: 'quiz',
      title: '做题',
      palaceId: 27,
      sourceKind: 'palace',
    })).toMatchObject({
      countable: true,
      scene: 'quiz',
      title: '做题',
      palaceId: 27,
      sourceKind: 'palace',
      routePath: '/freestyle',
    })
    expect(applyDwellFragmentOverride(freestyle, null)).toBe(freestyle)

    const palaceQuiz = resolveDwellFragment('/palaces/12/quiz')
    expect(applyDwellFragmentOverride(palaceQuiz, {
      scene: 'practice',
      kind: 'practice',
      title: '查看宫殿',
      palaceId: null,
      sourceKind: null,
    })).toMatchObject({
      title: '查看宫殿',
      palaceId: 12,
      sourceKind: 'palace',
      routePath: '/palaces/12/quiz',
    })

    const settings = resolveDwellFragment('/profile/timer')
    const overridden = applyDwellFragmentOverride(settings, {
      scene: 'quiz',
      kind: 'quiz',
      title: '做题',
      palaceId: 1,
      sourceKind: 'palace',
    })
    expect(overridden).toBe(settings)
    expect(overridden.countable).toBe(false)
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
