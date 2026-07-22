import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FsrsCompletionDialog } from '@/modules/practice/ui/review/components/FsrsCompletionDialog'
import type { ReviewCompletionSummary } from '@/shared/api/contracts'

const summary: ReviewCompletionSummary = {
  scope_node_count: 3,
  rated_node_count: 2,
  unrated_due_node_count: 0,
  rating_counts: { 忘记: 0, 困难: 1, 记得: 1, 轻松: 0 },
  mastery_progress: 0.55,
  mastery_percent: 55,
  previous_mastery_percent: 50,
  memory_health: 0.8,
  memory_health_percent: 80,
  remaining_due_node_count: 0,
  due_node_count: 0,
  overdue_node_count: 0,
  last_review_at: '2026-07-10T08:00:00Z',
  next_review_at: '2026-07-16T10:00:00Z',
  next_review_node_count: 2,
  next_review_entry_mode: 'node',
  next_review_entry_label: '节点复习',
}

describe('FsrsCompletionDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-07-15T10:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows last/next review and mastery delta without review-note input', async () => {
    const onConfirm = vi.fn()
    render(
      <FsrsCompletionDialog
        open
        summary={summary}
        durationSeconds={42}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByText('上次正式复习')).toBeTruthy()
    expect(screen.getByText('下次复习（整宫）')).toBeTruthy()
    expect(screen.getByText(/距今 · 5天/)).toBeTruthy()
    expect(screen.getByText(/间隔 · 1天后/)).toBeTruthy()
    expect(screen.getByText('+5')).toBeTruthy()
    expect(screen.queryByText('复盘一句（可选）')).toBeNull()
    expect(screen.queryByPlaceholderText('这次哪里卡了、下次注意什么')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '确认结束本次复习' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('disables confirm when frozen due nodes remain unrated', () => {
    const onConfirm = vi.fn()
    render(
      <FsrsCompletionDialog
        open
        summary={{ ...summary, rated_node_count: 1, unrated_due_node_count: 2 }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        onBulkRateUnrated={vi.fn()}
      />,
    )

    expect(screen.getByText(/还有 2 个到期节点未评分/)).toBeTruthy()
    const confirm = screen.getByRole('button', { name: '还有 2 个未评分' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

