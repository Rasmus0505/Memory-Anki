import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FreestyleSaveStatus } from './FreestyleSaveStatus'
import { FreestyleSettlementPopup } from './FreestyleSettlementPopup'

const subjects = [
  { subject_id: 1, name: '数学', done: 2, total: 4 },
  { subject_id: 2, name: '英语', done: 1, total: 1 },
  { subject_id: 3, name: '政治', done: 0, total: 2 },
  { subject_id: 4, name: '专业课', done: 3, total: 3 },
]

function renderPopup(overrides: Partial<Parameters<typeof FreestyleSettlementPopup>[0]> = {}) {
  const props = {
    saveOutcome: 'saved' as const,
    ratedCount: 4,
    passedCount: 3,
    remainingBefore: 12,
    remainingAfter: 7,
    subjects,
    palacesBySubject: [],
    nextReviews: [],
    onContinue: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  }
  render(<FreestyleSettlementPopup {...props} />)
  return props
}

describe('FreestyleSaveStatus', () => {
  it('says saved only for a confirmed save', () => {
    render(<FreestyleSaveStatus outcome="saved" />)
    expect(screen.getByText('数据已保存成功')).toBeTruthy()
  })

  it('never shows the success copy for a conflict', () => {
    render(<FreestyleSaveStatus outcome="conflict" />)
    expect(screen.queryByText('数据已保存成功')).toBeNull()
    expect(screen.getByText(/另一处已更新/)).toBeTruthy()
  })

  it('offers retry only on failure', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<FreestyleSaveStatus outcome="failed" onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    rerender(<FreestyleSaveStatus outcome="saved" onRetry={onRetry} />)
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })
})

describe('FreestyleSettlementPopup', () => {
  it('shows pass rate and the remaining change', () => {
    renderPopup()
    expect(screen.getByText('75%')).toBeTruthy()
    expect(screen.getByText('12 → 7')).toBeTruthy()
    expect(screen.getByText('数据已保存成功')).toBeTruthy()
  })

  it('folds subjects beyond the first three until expanded', () => {
    renderPopup()
    expect(screen.queryByText('专业课')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '展开其余 1 个学科' }))
    expect(screen.getByText('专业课')).toBeTruthy()
  })

  it('shows per-subject percent and opens palace detail', () => {
    renderPopup({
      palacesBySubject: [
        {
          subjectId: 1,
          subjectName: '数学',
          palaceCount: 1,
          cardCount: 2,
          palaces: [{ palaceId: 9, palaceTitle: '函数宫殿', cardCount: 2 }],
        },
      ],
    })
    expect(screen.getByText('2/4 · 50%')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /数学/ }))
    expect(screen.getByText('函数宫殿')).toBeTruthy()
  })

  it('closes on Escape and continues with the next round', () => {
    const props = renderPopup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '继续下一轮' }))
    expect(props.onContinue).toHaveBeenCalledTimes(1)
  })
})
