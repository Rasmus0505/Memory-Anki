import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileFeedbackPage from '@/modules/settings/ui/profile/ProfileFeedbackPage'

const emitReviewConfetti = vi.fn()
const playEvent = vi.fn()

vi.mock('@/shared/components/celebration', () => ({
  emitReviewConfetti: (...args: unknown[]) => emitReviewConfetti(...args),
}))

vi.mock('@/shared/feedback/mindmap-audio/useMindMapFeedback', () => ({
  useMindMapFeedbackAudio: () => ({
    playEvent: (...args: unknown[]) => playEvent(...args),
    playComboMilestone: vi.fn(),
  }),
}))

describe('ProfileFeedbackPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    emitReviewConfetti.mockReset()
    playEvent.mockReset()
  })

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/profile/feedback']}>
        <ProfileFeedbackPage />
      </MemoryRouter>,
    )
  }

  it('renders preset-first global controls without duplicate timer settings', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: '反馈中心', level: 1 })).toBeTruthy()
    expect(screen.getByText('反馈模式')).toBeTruthy()
    expect(screen.getByRole('button', { name: /专注/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /平衡/ }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('switch', { name: '声音反馈' })).toBeTruthy()
    expect(screen.queryByText('计时器反馈设置')).toBeNull()
  })

  it('owns every celebration detail, including the timer scenes', () => {
    // Timer celebration used to be configured on the timer page with a second
    // set of labels for the same confetti presets.
    renderPage()

    expect(screen.getByText('计时 · 阶段提醒')).toBeTruthy()
    expect(screen.getByText('计时 · 整轮完成')).toBeTruthy()
    expect(screen.getByLabelText('计时 · 整轮完成烟花类型')).toBeTruthy()
  })

  it('lets an explicit channel choice survive a preset switch', () => {
    renderPage()

    const completion = screen.getByRole('switch', { name: '最终完成效果' })
    fireEvent.click(completion)
    expect(screen.getByRole('button', { name: /已自定义/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /激励/ }))
    expect(
      screen.getByRole('switch', { name: '最终完成效果' }).getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('applies a preset as a draft and confirms save inline', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /专注/ }))
    expect(screen.getByText('有尚未保存的更改')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    expect(screen.getByRole('status').textContent).toContain('反馈偏好已保存')
  })

  it('previews answer sounds without answer confetti', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '试听答对' }))
    fireEvent.click(screen.getByRole('button', { name: '试听答错' }))

    expect(playEvent).toHaveBeenNthCalledWith(1, 'quiz_result_correct', { audioScope: 'global' })
    expect(playEvent).toHaveBeenNthCalledWith(2, 'quiz_result_incorrect', { audioScope: 'global' })
    expect(emitReviewConfetti).not.toHaveBeenCalled()
  })

  it('reserves celebration previews for milestones and final completion', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '预览里程碑' }))
    fireEvent.click(screen.getByRole('button', { name: '预览完成' }))

    expect(emitReviewConfetti).toHaveBeenNthCalledWith(1, expect.objectContaining({ kind: 'milestone' }))
    expect(emitReviewConfetti).toHaveBeenNthCalledWith(2, expect.objectContaining({ kind: 'session_complete' }))
  })

  it('keeps timing rules off the feedback page', () => {
    // This page answers "how does the app respond to me". When to count study
    // time and when to rest belongs to 计时与休息.
    renderPage()

    expect(screen.queryByRole('switch', { name: '桌面通知' })).toBeNull()
    expect(screen.queryByRole('switch', { name: '计时中保持屏幕常亮' })).toBeNull()
    expect(screen.getByRole('switch', { name: '声音反馈' })).toBeTruthy()
  })
})
