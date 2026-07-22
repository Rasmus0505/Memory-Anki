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
    expect(screen.queryByText('烟花类型')).toBeNull()
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

  it('requests notification permission only after an explicit opt-in and keeps a denial local', async () => {
    const requestPermission = vi.fn().mockResolvedValue('denied')
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { permission: 'default', requestPermission },
    })
    renderPage()

    fireEvent.click(screen.getByRole('switch', { name: '桌面通知' }))

    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('桌面通知权限未开启，计时器仍会保留常驻状态')).toBeTruthy()
    expect(screen.getByRole('switch', { name: '桌面通知' }).getAttribute('aria-checked')).toBe('false')
  })
})
