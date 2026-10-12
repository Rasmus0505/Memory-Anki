import { describe, expect, it } from 'vitest'
import {
  DIAGNOSIS_MAX_WINDOW_MS,
  DIAGNOSIS_WINDOW_OPTIONS_MINUTES,
  buildDiagnosisBrief,
  diagnosisWindowMs,
  filterRecentEvents,
} from './sessionRecorderBrief'
import type { SessionRecorderEvent } from './sessionRecorderTypes'

const NOW = Date.parse('2026-10-11T15:50:00.000Z')

function eventAgo(seconds: number, partial: Partial<SessionRecorderEvent> = {}): SessionRecorderEvent {
  return {
    at: new Date(NOW - seconds * 1000).toISOString(),
    kind: 'click',
    action: `ago-${seconds}`,
    detail: '',
    ...partial,
  }
}

describe('filterRecentEvents', () => {
  it('keeps events for the longest selectable window by default', () => {
    expect(DIAGNOSIS_MAX_WINDOW_MS).toBe(5 * 60 * 1000)
    const kept = filterRecentEvents([eventAgo(400), eventAgo(301), eventAgo(299), eventAgo(10)], NOW)
    expect(kept.map((event) => event.action)).toEqual(['ago-299', 'ago-10'])
  })

  it('narrows to a shorter window when asked', () => {
    const kept = filterRecentEvents([eventAgo(130), eventAgo(70), eventAgo(10)], NOW, diagnosisWindowMs(2))
    expect(kept.map((event) => event.action)).toEqual(['ago-70', 'ago-10'])
  })
})

describe('buildDiagnosisBrief', () => {
  it('offers 1, 2 and 5 minute copies', () => {
    expect(DIAGNOSIS_WINDOW_OPTIONS_MINUTES).toEqual([1, 2, 5])
  })

  it('describes behaviour only, with no instructions to the assistant', () => {
    const brief = buildDiagnosisBrief({
      events: [
        eventAgo(20, { kind: 'click', action: '结束这次学习', detail: '「完成」' }),
        eventAgo(18, { kind: 'view', action: '自动切到结算页' }),
      ],
      pageLabel: '随心',
      focus: null,
      windowMs: diagnosisWindowMs(2),
      now: NOW,
    })
    expect(brief).not.toContain('请')
    expect(brief).not.toContain('帮我')
    expect(brief).not.toContain('请先看这些')
    expect(brief).toContain('最近 2 分钟')
  })

  it('reports an app-made view change with the click before it when there was one', () => {
    const brief = buildDiagnosisBrief({
      events: [
        eventAgo(20, { kind: 'click', action: '评分', detail: '「记得」' }),
        eventAgo(19, { kind: 'view', action: '自动切到结算页' }),
        eventAgo(60, { kind: 'view', action: '自动切到第 3 张（共 12 张）' }),
      ],
      pageLabel: '随心',
      focus: null,
      windowMs: diagnosisWindowMs(5),
      now: NOW,
    })
    expect(brief).toContain('点了「记得」之后，自动切到结算页')
    expect(brief).toContain('没有点击，自动切到第 3 张（共 12 张）')
  })

  it('prefixes each action with its clock time', () => {
    const brief = buildDiagnosisBrief({
      events: [eventAgo(30, { kind: 'click', action: '完成', detail: '「完成」' })],
      pageLabel: '随心',
      focus: null,
      windowMs: diagnosisWindowMs(1),
      now: NOW,
    })
    expect(brief).toMatch(/- \d{2}:\d{2}:\d{2} 点了/)
  })
})
