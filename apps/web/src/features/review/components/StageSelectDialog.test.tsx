import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StageSelectDialog } from './StageSelectDialog'

describe('StageSelectDialog completion modes', () => {
  it('renders plain practice confirmation instead of disappearing without stages', () => {
    const onConfirm = vi.fn()
    render(
      <StageSelectDialog
        open
        stageLabels={[]}
        stages={[]}
        currentReviewNumber={0}
        durationSeconds={12}
        requiresStages={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '确认完成' }))

    expect(onConfirm).toHaveBeenCalledWith(0, false, '')
    expect(screen.getByText('本次耗时：')).toBeTruthy()
  })

  it('renders a retryable error when schedule-backed stage data is unavailable', () => {
    const onRetry = vi.fn()
    render(
      <StageSelectDialog
        open
        stageLabels={[]}
        stages={[]}
        currentReviewNumber={0}
        requiresStages
        preparationFailed
        error="复习阶段信息不完整"
        onRetry={onRetry}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('复习阶段信息不完整')
    fireEvent.click(screen.getByRole('button', { name: '重新加载结算信息' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('locks the confirmed selection and exposes a single same-operation retry after submit failure', () => {
    const onRetrySubmission = vi.fn()
    render(
      <StageSelectDialog
        open
        stageLabels={['first', 'second']}
        stages={[
          { review_number: 0, label: 'first', completed: true, completed_at: null, scheduled_at: null },
          { review_number: 1, label: 'second', completed: false, completed_at: null, scheduled_at: null },
        ]}
        currentReviewNumber={1}
        submissionFailed
        error="网络暂时不可用"
        onRetrySubmission={onRetrySubmission}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert').textContent).toContain('网络暂时不可用')
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '完成，但仍需练习' })).toBeNull()
    fireEvent.keyDown(window, { code: 'Digit1', key: '1' })
    expect(screen.getByTitle(/first/).className).not.toContain('scale-125')
    fireEvent.click(screen.getByRole('button', { name: '重新提交相同结算' }))
    expect(onRetrySubmission).toHaveBeenCalledTimes(1)
  })

  it('marks the dialog as excluded from automatic timer activity', () => {
    render(
      <StageSelectDialog
        open
        stageLabels={[]}
        stages={[]}
        currentReviewNumber={0}
        requiresStages={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )

    expect(screen.getByRole('dialog').closest('[data-timer-activity="ignore"]')).toBeTruthy()
  })
})
