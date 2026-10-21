import { describe, expect, it } from 'vitest'
import {
  DIAGNOSIS_MAX_WINDOW_MS,
  DIAGNOSIS_WINDOW_OPTIONS_MINUTES,
  buildDiagnosisBrief,
  describeRequestStep,
  diagnosisWindowMs,
  filterRecentEvents,
  readClickedRecorderFocus,
  readRecorderFocus,
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

  it('keeps settlement clicks even when later flips push them out of the recent actions', () => {
    const flips = Array.from({ length: 25 }, (_, index) => (
      eventAgo(60 - index, { kind: 'click', action: '点击', detail: '「下一张」' })
    ))
    const brief = buildDiagnosisBrief({
      events: [
        eventAgo(100, { kind: 'click', action: '点击', detail: '「结算已完成 12」' }),
        eventAgo(95, { kind: 'click', action: '点击', detail: '「确认结算」' }),
        ...flips,
      ],
      pageLabel: '随心',
      focus: null,
      windowMs: diagnosisWindowMs(2),
      now: NOW,
    })
    expect(brief).toContain('点了「结算已完成 12」')
    expect(brief).toContain('点了「确认结算」')
  })

  it('says how many earlier actions were left out instead of dropping them silently', () => {
    const flips = Array.from({ length: 25 }, (_, index) => (
      eventAgo(60 - index, { kind: 'click', action: '点击', detail: '「下一张」' })
    ))
    const brief = buildDiagnosisBrief({
      events: flips,
      pageLabel: '随心',
      focus: null,
      windowMs: diagnosisWindowMs(2),
      now: NOW,
    })
    expect(brief).toMatch(/还有 5 条较早的动作没列出/)
  })

  it('names a round action by its body action, not the shared URL', () => {
    expect(describeRequestStep({
      method: 'POST',
      path: '/freestyle/rounds/r1/actions',
      ok: true,
      status: 200,
      message: '',
      queuedRetry: false,
      elapsedMs: 5,
      action: 'compress_completed',
    }).action).toBe('结算已完成单元')
    expect(describeRequestStep({
      method: 'POST',
      path: '/freestyle/rounds/r1/actions',
      ok: true,
      status: 200,
      message: '',
      queuedRetry: false,
      elapsedMs: 5,
    }).action).toBe('记下这题的作答')
  })

  it('still shows a settlement save after eight other outcomes', () => {
    const flips: SessionRecorderEvent[] = []
    for (let index = 0; index < 9; index += 1) {
      flips.push(eventAgo(50 - index * 2, { kind: 'click', action: '点击', detail: '「下一张」' }))
      flips.push(eventAgo(49 - index * 2, { kind: 'step', action: '翻到这张卡', detail: '成功' }))
    }
    const brief = buildDiagnosisBrief({
      events: [
        ...flips,
        eventAgo(10, { kind: 'click', action: '点击', detail: '「确认结算」' }),
        eventAgo(9, { kind: 'step', action: '结算已完成单元', detail: '成功' }),
      ],
      pageLabel: '随心',
      focus: null,
      windowMs: diagnosisWindowMs(2),
      now: NOW,
    })
    expect(brief).toContain('点了「确认结算」之后，结算已完成单元成功了')
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

describe('recorder focus at click time', () => {
  it('names the clicked mind-map node instead of the previously selected card', () => {
    document.body.innerHTML = `
      <div data-recorder-current="true" data-recorder-place="第 1 题" data-recorder-title="上一题" data-recorder-excerpt="旧内容"></div>
      <div data-mindmap-node-id="n1" data-recorder-focus="true" data-recorder-place="第 2 层" data-recorder-title="评价：推动课程理论发展" data-recorder-excerpt="过分强调学科结构">
        <button id="label">评价：推动课程理论发展</button>
      </div>`
    const label = document.getElementById('label')

    expect(readClickedRecorderFocus(label)).toEqual({
      place: '第 2 层',
      title: '评价：推动课程理论发展',
      excerpt: '过分强调学科结构',
    })
    // A click outside any marked node falls back to the page-level current card.
    expect(readClickedRecorderFocus(document.body)).toBeNull()
    expect(readRecorderFocus(document)?.title).toBe('上一题')
  })

  it('returns null when the clicked element has no marked ancestor', () => {
    document.body.innerHTML = '<button id="plain">普通按钮</button>'
    expect(readClickedRecorderFocus(document.getElementById('plain'))).toBeNull()
  })
})
