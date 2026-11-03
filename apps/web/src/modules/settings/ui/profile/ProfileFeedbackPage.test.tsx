import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileFeedbackPage from '@/modules/settings/ui/profile/ProfileFeedbackPage'

const playEvent = vi.fn()

vi.mock('@/shared/feedback/mindmap-audio/useMindMapFeedback', () => ({
  useMindMapFeedbackAudio: () => ({
    playEvent: (...args: unknown[]) => playEvent(...args),
    playComboMilestone: vi.fn(),
  }),
}))

describe('ProfileFeedbackPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    playEvent.mockReset()
  })

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/profile/feedback']}>
        <ProfileFeedbackPage />
      </MemoryRouter>,
    )
  }

  it('puts preview and sound choices before all other concerns', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: '反馈中心', level: 1 })).toBeTruthy()
    expect(screen.getByText('先听一声')).toBeTruthy()
    expect(screen.getByRole('switch', { name: '声音反馈' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: '全局音量' })).toBeTruthy()
    expect(screen.getAllByRole('checkbox')).toHaveLength(3)
    expect(screen.queryByText('反馈模式')).toBeNull()
    expect(screen.queryByText('分类通道')).toBeNull()
    expect(screen.queryByText('按场景微调')).toBeNull()
  })

  it('previews without changing the selected pool', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '试听答对' }))
    fireEvent.click(screen.getAllByRole('button', { name: '试听这套' })[0]!)

    expect(playEvent).toHaveBeenNthCalledWith(1, 'quiz_result_correct', {
      audioScope: 'global',
      voice: ['crystal', 'wood', 'celesta'],
    })
    expect(playEvent).toHaveBeenNthCalledWith(2, 'quiz_result_correct', {
      audioScope: 'global',
      voice: 'crystal',
    })
    expect(screen.getAllByRole('checkbox').every((item) => item.getAttribute('aria-checked') === 'true')).toBe(true)
  })

  it('supports one style or an equal-probability mixed pool', () => {
    renderPage()

    fireEvent.click(screen.getByRole('checkbox', { name: '选择禅境温木' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择灵音八音盒' }))
    expect(screen.getByText('单一风格')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: '选择禅境温木' }))
    expect(screen.getByText('2 种风格等概率混合')).toBeTruthy()

    fireEvent.click(screen.getByRole('checkbox', { name: '选择灵音八音盒' }))
    expect(screen.getByText('三种风格等概率混合')).toBeTruthy()
  })

  it('does not allow the last style to be removed', () => {
    renderPage()

    for (const label of ['选择禅境温木', '选择灵音八音盒']) {
      fireEvent.click(screen.getByRole('checkbox', { name: label }))
    }
    const crystal = screen.getByRole('checkbox', { name: '选择晶莹微风' })
    expect(crystal.hasAttribute('disabled')).toBe(true)
  })

  it('autosaves the sound-only draft without a save button', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('switch', { name: '声音反馈' }))
    expect(screen.getByText('正在保存…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '保存设置' })).toBeNull()
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已保存'), { timeout: 2000 })
  })
})
