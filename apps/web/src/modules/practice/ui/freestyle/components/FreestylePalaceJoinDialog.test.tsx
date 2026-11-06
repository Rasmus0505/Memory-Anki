import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestylePalaceJoinDialog } from './FreestylePalaceJoinDialog'

describe('FreestylePalaceJoinDialog', () => {
  it('asks before adding a marked palace that is not in the round', () => {
    const onJoin = vi.fn()
    render(
      <FreestylePalaceJoinDialog
        state={{ kind: 'join', palaceId: 149, title: '第一节 国民政府时期的教育' }}
        busy={false}
        onCancel={() => undefined}
        onJoin={onJoin}
      />,
    )
    expect(screen.getByRole('heading', { name: '加入本轮' })).toBeTruthy()
    expect(screen.getByText(/以后每轮都包含它/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加入本轮' }))
    expect(onJoin).toHaveBeenCalledTimes(1)
  })

  it('offers to mark an unmarked palace in the same step', () => {
    render(
      <FreestylePalaceJoinDialog
        state={{ kind: 'unmarked', palaceId: 10, title: '第二节 黄炎培的职业教育思想与实践' }}
        busy={false}
        onCancel={() => undefined}
        onJoin={() => undefined}
      />,
    )
    expect(screen.getByRole('button', { name: '标记并加入' })).toBeTruthy()
    expect(screen.getByText(/整座宫殿作为一个复习单元/)).toBeTruthy()
  })

  it('only explains a palace that is not due today', () => {
    const onJoin = vi.fn()
    render(
      <FreestylePalaceJoinDialog
        state={{ kind: 'not_due', title: '第二节 蔡元培的教育思想与实践', nextReviewDate: '2026-11-07' }}
        busy={false}
        onCancel={() => undefined}
        onJoin={onJoin}
      />,
    )
    expect(screen.getByText(/11月7日/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '加入本轮' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(onJoin).not.toHaveBeenCalled()
  })
})
