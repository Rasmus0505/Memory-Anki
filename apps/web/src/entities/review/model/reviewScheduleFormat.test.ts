import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatNextReviewDetailLabel,
  formatReviewAbsolute,
  formatReviewIntervalFromNow,
  formatReviewIntervalLabel,
} from './reviewScheduleFormat'

describe('reviewScheduleFormat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats absolute next-review time', () => {
    expect(formatReviewAbsolute(null)).toBe('暂无后续安排')
    expect(formatReviewAbsolute('2026-07-16T10:00:00Z')).toMatch(/2026/)
  })

  it('formats relative intervals from now', () => {
    expect(formatReviewIntervalFromNow('2026-07-15T10:30:00Z')).toBe('30分钟后')
    expect(formatReviewIntervalFromNow('2026-07-15T12:00:00Z')).toBe('2小时后')
    expect(formatReviewIntervalFromNow('2026-07-16T10:00:00Z')).toBe('1天后')
    expect(formatReviewIntervalFromNow('2026-07-15T09:00:00Z')).toBe('已到期，可立即复习')
  })

  it('labels completion interval lines', () => {
    expect(formatReviewIntervalLabel('2026-07-16T10:00:00Z')).toBe('间隔 · 1天后')
    expect(formatReviewIntervalLabel(null)).toBe('间隔 · —')
  })

  it('labels next-review detail with node count and entry mode', () => {
    expect(
      formatNextReviewDetailLabel({
        nextReviewAt: '2026-07-16T10:00:00Z',
        nextReviewNodeCount: 3,
        nextReviewEntryMode: 'node',
        nextReviewEntryLabel: '节点复习',
      }),
    ).toBe('间隔 · 1天后 · 3 个节点 · 节点复习')
    expect(
      formatNextReviewDetailLabel({
        nextReviewAt: '2026-07-16T10:00:00Z',
        nextReviewNodeCount: 12,
        nextReviewEntryMode: 'palace',
        nextReviewEntryLabel: '开始复习',
      }),
    ).toBe('间隔 · 1天后 · 12 个节点 · 整宫复习')
  })
})
