import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PracticeCompletionDialog } from '@/modules/practice/public'

describe('practice completion', () => {
  it('completes practice without legacy review-stage messaging', () => {
    const confirm = vi.fn()
    render(<PracticeCompletionDialog open durationSeconds={30} onConfirm={confirm} onCancel={vi.fn()} />)
    expect(screen.queryByText(/旧复习阶段/)).toBeNull()
    fireEvent.change(screen.getByPlaceholderText('复盘一句（可选）'), { target: { value: '继续练习弱点' } })
    fireEvent.click(screen.getByRole('button', { name: '确认完成' }))
    expect(confirm).toHaveBeenCalledWith('继续练习弱点')
  })
})
