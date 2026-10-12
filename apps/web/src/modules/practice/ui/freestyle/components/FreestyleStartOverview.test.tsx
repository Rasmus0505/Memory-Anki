import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FreestyleOverviewResponse } from '@/shared/api/contracts'
import { FreestyleStartOverview } from './FreestyleStartOverview'

const overview: FreestyleOverviewResponse = {
  round: {
    round_id: 'r1',
    version: 3,
    counts: { palaces: 4, units: 18, new: 6, review: 12, done: 2, remaining: 16 },
    by_subject: [],
  },
  today: { due_count: 9, overdue_count: 2, new_palace_count: 1 },
  yesterday: { date: '2026-10-11', learned_units: 0, rated_count: 0, weak_units: [] },
  next_reviews: [],
}

describe('FreestyleStartOverview', () => {
  it('shows palace, unit, due and new counts from the overview', () => {
    render(<FreestyleStartOverview overview={overview} onStart={() => {}} />)
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText('18')).toBeTruthy()
    expect(screen.getByText('9')).toBeTruthy()
    expect(screen.getByText('6')).toBeTruthy()
  })

  it('falls back to today counts and dashes when no round is loaded', () => {
    render(
      <FreestyleStartOverview
        overview={{ ...overview, round: null }}
        onStart={() => {}}
      />,
    )
    expect(screen.getAllByText('—')).toHaveLength(2)
    expect(screen.getByText('1')).toBeTruthy()
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
      today: { due_count: 0, overdue_count: 0, new_palace_count: 0 },
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
      today: { due_count: 9, overdue_count: 2, new_palace_count: 0 },
    }
    render(<FreestyleStartOverview overview={finished} onStart={onStart} />)
    fireEvent.click(screen.getByRole('button', { name: '开始学习' }))
    expect(onStart).toHaveBeenCalledTimes(1)
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
