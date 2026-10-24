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
    expect(screen.getAllByText('函数宫殿').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '展开全部 7 张' }))
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
  })

  it('lists one palace row per palace in round order, with its item count', () => {
    const mixed = {
      new_count: 3,
      review_count: 1,
      skipped_count: 0,
      order: [
        { card_id: 'a1', unit_id: 'u1', palace_id: 1, kind: 'new' as const },
        { card_id: 'b1', unit_id: 'u2', palace_id: 2, kind: 'new' as const },
        { card_id: 'a2', unit_id: 'u3', palace_id: 1, kind: 'review' as const },
        { card_id: 'a3', unit_id: 'u4', palace_id: 1, kind: 'new' as const },
      ],
    }
    render(
      <FreestyleConfigPreviewCard
        summary={mixed}
        palaceTitleByCardId={{ a1: '微积分', b1: '英语' }}
        onStart={vi.fn()}
      />,
    )
    const rows = screen.getAllByTestId('freestyle-preview-palace-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('微积分')
    expect(rows[0]?.textContent).toContain('3')
    expect(rows[1]?.textContent).toContain('英语')
    expect(rows[1]?.textContent).toContain('1')
  })

  it('stacks new and review counts into one bar and names both numbers', () => {
    render(<FreestyleConfigPreviewCard summary={summary} palaceTitleByCardId={{}} onStart={vi.fn()} />)
    expect(screen.getByText('新学 2 · 复习 1')).toBeTruthy()
    const bar = screen.getByRole('img', { name: '新学 2 张，复习 1 张' })
    expect(bar.children).toHaveLength(2)
    expect(bar.children[0]?.className).toContain('bg-info')
    expect(bar.children[1]?.className).toContain('bg-warning')
  })

  it('shows the unit order and new placement as plain chips', () => {
    render(
      <FreestyleConfigPreviewCard
        summary={summary}
        palaceTitleByCardId={{}}
        unitOrder="structured"
        newPlacement="ratio"
        onStart={vi.fn()}
      />,
    )
    expect(screen.getByText('宫殿内按知识结构')).toBeTruthy()
    expect(screen.getByText('按比例穿插')).toBeTruthy()
  })

  it('offers no controls that change the config, only expanding the order and starting', () => {
    render(
      <FreestyleConfigPreviewCard
        summary={summary}
        palaceTitleByCardId={{}}
        unitOrder="random"
        newPlacement="new_first"
        onStart={vi.fn()}
      />,
    )
    const buttons = screen.getAllByRole('button').map((button) => button.textContent?.trim())
    expect(buttons).toEqual(['展开全部 7 张', '开始学习'])
    expect(document.querySelectorAll('input, select, textarea')).toHaveLength(0)
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
    expect(screen.getByText('跳过')).toBeTruthy()
    expect(screen.getByText('另有 2 张不在本轮，会留到之后的轮次。')).toBeTruthy()
  })
})

describe('FreestyleDayRecap', () => {
  const yesterday = {
    date: '2026-10-11',
    learned_units: 3,
    learned_palace_count: 2,
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
        yesterday={{ ...yesterday, learned_units: 0, learned_palace_count: 0, weak_units: [] }}
        onDismiss={vi.fn()}
      />,
    )
    expect(screen.getByText('昨天没有学习记录')).toBeTruthy()
  })
})
