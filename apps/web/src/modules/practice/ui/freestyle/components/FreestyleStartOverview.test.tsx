import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FreestyleOverviewResponse } from '@/shared/api/contracts'
import { FreestyleStartOverview } from './FreestyleStartOverview'

const overview: FreestyleOverviewResponse = {
  round: {
    round_id: 'r1',
    version: 3,
    counts: {
      palaces: 4,
      units: 18,
      new: 6,
      review: 12,
      done: 2,
      remaining: 16,
      remaining_palaces: 3,
      remaining_units: 14,
    },
    by_subject: [],
  },
  milestones: { today: '2026-10-11', groups: [], overdue_count: 0 },
  today: { due_count: 9, due_palace_count: 3, overdue_count: 2, new_unit_count: 6, new_palace_count: 2 },
  yesterday: { date: '2026-10-11', learned_units: 0, learned_palace_count: 0, weak_units: [] },
  next_reviews: [],
}

describe('FreestyleStartOverview', () => {
  it('shows due and new figures as 宫殿/复习单元 pairs', () => {
    render(<FreestyleStartOverview overview={overview} onStart={() => {}} />)
    expect(screen.getByText('3/9')).toBeTruthy()
    expect(screen.getByText('2/6')).toBeTruthy()
  })

  it('keeps both figures visible even when no round is loaded', () => {
    render(
      <FreestyleStartOverview
        overview={{ ...overview, round: null }}
        onStart={() => {}}
      />,
    )
    expect(screen.getByText('3/9')).toBeTruthy()
    expect(screen.getByText('2/6')).toBeTruthy()
  })

  it('shows dashes when the today figures are not available', () => {
    render(<FreestyleStartOverview overview={{ ...overview, today: null }} onStart={() => {}} />)
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('starts when the button is pressed and work exists', () => {
    const onStart = vi.fn()
    render(<FreestyleStartOverview overview={overview} onStart={onStart} />)
    fireEvent.click(screen.getByRole('button', { name: '开始学习' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('disables start and says so when nothing is due or new', () => {
    const empty: FreestyleOverviewResponse = {
      ...overview,
      round: { ...overview.round!, counts: { ...overview.round!.counts, remaining: 0, new: 0 } },
      today: { due_count: 0, due_palace_count: 0, overdue_count: 0, new_unit_count: 0, new_palace_count: 0 },
    }
    render(<FreestyleStartOverview overview={empty} onStart={() => {}} />)
    const button = screen.getByRole('button', { name: '暂无需要学习的内容' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('stays startable when the round is finished but today still has due units', () => {
    const onStart = vi.fn()
    const finished: FreestyleOverviewResponse = {
      ...overview,
      round: { ...overview.round!, counts: { ...overview.round!.counts, remaining: 0, new: 0 } },
      today: { due_count: 9, due_palace_count: 3, overdue_count: 2, new_unit_count: 0, new_palace_count: 0 },
    }
    render(<FreestyleStartOverview overview={finished} onStart={onStart} />)
    fireEvent.click(screen.getByRole('button', { name: '开始学习' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('lists every item on a milestone day, not just the next one', () => {
    render(
      <FreestyleStartOverview
        overview={{
          ...overview,
          milestones: {
            today: '2026-10-23',
            groups: [
              {
                date: '2026-10-31',
                days_left: 8,
                items: [
                  { id: 'zhongjiaoshi', title: '中国教育史完成', category: '333', detail: '' },
                  { id: 'mayuan', title: '马原 8 宫完成', category: '政治', detail: '' },
                ],
              },
            ],
            overdue_count: 0,
          },
        }}
        onStart={() => {}}
      />,
    )
    expect(screen.getByLabelText('近期里程碑')).toBeTruthy()
    expect(screen.getByText('10/31')).toBeTruthy()
    expect(screen.getByText('中国教育史完成')).toBeTruthy()
    expect(screen.getByText('马原 8 宫完成')).toBeTruthy()
  })

  it('still offers a direct start and a retry when the overview fails', () => {
    const onRetry = vi.fn()
    const onStart = vi.fn()
    render(<FreestyleStartOverview overview={null} error onStart={onStart} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: '重试概览' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '直接开始学习' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })
})
