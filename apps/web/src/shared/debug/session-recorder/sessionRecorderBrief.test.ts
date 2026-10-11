import { describe, expect, it } from 'vitest'
import { DIAGNOSIS_WINDOW_MS, filterRecentEvents } from './sessionRecorderBrief'
import type { SessionRecorderEvent } from './sessionRecorderTypes'

const NOW = Date.parse('2026-10-11T15:50:00.000Z')

function eventAgo(seconds: number): SessionRecorderEvent {
  return { at: new Date(NOW - seconds * 1000).toISOString(), kind: 'click', action: `ago-${seconds}`, detail: '' }
}

describe('filterRecentEvents', () => {
  it('keeps only the previous 3 minutes', () => {
    expect(DIAGNOSIS_WINDOW_MS).toBe(3 * 60 * 1000)
    const kept = filterRecentEvents([eventAgo(240), eventAgo(181), eventAgo(179), eventAgo(10)], NOW)
    expect(kept.map((event) => event.action)).toEqual(['ago-179', 'ago-10'])
  })
})
