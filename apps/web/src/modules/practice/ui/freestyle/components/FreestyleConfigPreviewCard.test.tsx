import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestyleConfigPreviewCard } from './FreestyleConfigPreviewCard'
import { FreestyleDayRecap } from './FreestyleDayRecap'

const summary = {
  new_count: 2,
  review_count: 1,
  skipped_count: 0,
  order: Array.from({ length: 7 }, (_, index) => ({
    card_id: `c${index}`,
    unit_id: `u${index}`,
    palace_id: 1,
    kind: index === 0 ? ('review' as const) : ('new' as const),
  })),
}

describe('FreestyleConfigPreviewCard', () => {
  it('shows counts and only the first five entries until expanded', () => {
    render(
      <FreestyleConfigPreviewCard
        summary={summary}
        palaceTitleByCardId={{ c0: '函数宫殿' }}
        onStart={vi.fn()}
      />,
    )
    expect(screen.getByText('这一轮将学习 3 张')).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText('函数宫殿')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '展开全部 7 张' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
  })

  it('starts the round from the preview', () => {
    const onStart = vi.fn()
    render(<FreestyleConfigPreviewCard summary={summary} palaceTitleByCardId={{}} onStart={onStart} />)
    fireEvent.click(screen.getByRole('button', { name: '开始学习' }))
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('disables start when nothing is scheduled', () => {
    render(
      <FreestyleConfigPreviewCard
        summary={{ new_count: 0, review_count: 0, skipped_count: 2, order: [] }}
        palaceTitleByCardId={{}}
        onStart={vi.fn()}
      />,
    )
    expect((screen.getByRole('button', { name: '开始学习' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('跳过 2')).toBeTruthy()
  })
})

describe('FreestyleDayRecap', () => {
  const yesterday = {
    date: '2026-10-11',
    learned_units: 3,
    rated_count: 9,
    weak_units: [
      { unit_id: 'u1', name: '导数定义', palace_name: '微积分', again_ratio: 0.5 },
    ],
  }

  it('summarises yesterday and dismisses', () => {
    const onDismiss = vi.fn()
    render(<FreestyleDayRecap yesterday={yesterday} onDismiss={onDismiss} />)
    expect(screen.getByText('导数定义')).toBeTruthy()
    expect(screen.getByText('忘记 50%')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('says so when yesterday had no ratings', () => {
    render(
      <FreestyleDayRecap
        yesterday={{ ...yesterday, learned_units: 0, rated_count: 0, weak_units: [] }}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText('昨天没有学习记录')).toBeTruthy()
  })
})
