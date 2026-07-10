import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { InlineFeedback, TaskFeedbackPanel } from '@/shared/feedback/FeedbackStatus'

describe('feedback status components', () => {
  it('announces inline errors at the owning surface', () => {
    render(<InlineFeedback tone="error" message="请先填写答案" />)
    expect(screen.getByRole('alert').textContent).toContain('请先填写答案')
  })

  it('keeps running task progress persistent and accessible', () => {
    render(<TaskFeedbackPanel title="正在生成" state="running" progress={42} />)
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('进度 42%')).toBeTruthy()
  })

  it('offers retry only for failed tasks', () => {
    const retry = vi.fn()
    render(<TaskFeedbackPanel title="生成失败" state="error" onRetry={retry} />)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
})
