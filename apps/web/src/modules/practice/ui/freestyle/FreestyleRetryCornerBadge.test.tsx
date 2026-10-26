import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FreestyleCard } from '@/shared/api/contracts'
import { FreestyleRetryCornerBadge } from './FreestyleRetryCornerBadge'

function branch(id: string): FreestyleCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    palace_title: 'Palace',
    anchor_uid: 'unit-node',
    context_path: [],
    node_uids: [],
    node_count: 0,
    unit_id: `${id}-unit`,
    unit_revision: 1,
  } as unknown as FreestyleCard
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-25T12:00:00Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('FreestyleRetryCornerBadge', () => {
  it('counts down the server wait instead of promising a card offset', () => {
    render(
      <FreestyleRetryCornerBadge
        card={branch('a')}
        retryScheduled
        retryAvailableAt="2026-10-25T12:10:00+00:00"
        completed={false}
      />,
    )
    const badge = screen.getByTestId('freestyle-retry-corner-badge')
    expect(badge.textContent).toContain('10 分钟后重练')
    expect(badge.textContent).not.toContain('张')

    act(() => {
      vi.advanceTimersByTime(11 * 60_000)
    })
    expect(screen.getByTestId('freestyle-retry-corner-badge').textContent).toContain('重练已到点')
  })

  it('says 稍后重练 when the ack carried no instant', () => {
    render(<FreestyleRetryCornerBadge card={branch('a')} retryScheduled completed={false} />)
    expect(screen.getByTestId('freestyle-retry-corner-badge').textContent).toContain('稍后重练')
  })

  it('marks a retry card with its attempt number, not a wait', () => {
    const retry = { ...branch('retry:a-unit:1'), occurrence_kind: 'retry', retry_attempt: 2 } as unknown as FreestyleCard
    render(<FreestyleRetryCornerBadge card={retry} completed={false} />)
    expect(screen.getByTestId('freestyle-retry-corner-badge').textContent).toContain('重练第 2 次')
  })

  it('renders nothing for a source with no retry booked', () => {
    render(<FreestyleRetryCornerBadge card={branch('a')} completed={false} />)
    expect(screen.queryByTestId('freestyle-retry-corner-badge')).toBeNull()
  })
})
