import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_RECORDER_LAYER_ZCLASS, SessionRecorderHost, SessionRecorderMenu } from './SessionRecorderHost'
import {
  openSessionRecorderDialog,
  resetSessionRecorderForTest,
  startSessionRecording,
} from './sessionRecorderStore'

describe('SessionRecorderHost', () => {
  beforeEach(() => {
    resetSessionRecorderForTest()
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  afterEach(() => {
    resetSessionRecorderForTest()
  })

  it('opens a live brief and copies it with notes', async () => {
    render(
      <MemoryRouter>
        <SessionRecorderHost />
      </MemoryRouter>,
    )

    act(() => openSessionRecorderDialog())
    expect(await screen.findByRole('dialog', { name: '刚才几分钟' })).toBeTruthy()
    expect(screen.getByLabelText('给 AI 的说明')).toBeTruthy()
    expect(screen.getByLabelText('刚才碰到什么问题？（可选）')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
    expect(screen.queryByRole('button', { name: '开始录制' })).toBeNull()
    fireEvent.change(screen.getByLabelText('刚才碰到什么问题？（可选）'), {
      target: { value: '点保存后卡片没了' },
    })
    fireEvent.click(screen.getByRole('button', { name: '复制给 AI' }))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled()
    })
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)?.[0] as string
    expect(copied).not.toContain('请根据')
    expect(copied).toContain('## 用户补充')
    expect(copied).toContain('点保存后卡片没了')
  })

  it('copies the focus captured at the last click, not the focus at copy time', async () => {
    render(
      <MemoryRouter>
        <div data-recorder-current="true" data-recorder-context="quiz" data-recorder-count="2" />
        <button type="button">第一题按钮</button>
        <SessionRecorderMenu />
        <SessionRecorderHost />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: '第一题按钮' }))
    document.querySelector('[data-recorder-current="true"]')?.setAttribute('data-recorder-count', '9')

    fireEvent.keyDown(screen.getByRole('button', { name: '录制' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: '复制上一次点击的位置' }))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled()
    })
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)?.[0] as string
    expect(copied).not.toContain('第一题按钮')
    expect(copied).toContain('quiz（2 项）')
    expect(copied).not.toContain('quiz（9 项）')
  })

  it('keeps the menu trigger as 录制 and never shows stop', () => {
    render(
      <MemoryRouter>
        <SessionRecorderMenu />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: '录制' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
    act(() => startSessionRecording())
    expect(screen.getByRole('button', { name: '录制' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
  })

  it('floats the menu above dialogs only when the host has no chrome to sit in', () => {
    const { rerender } = render(
      <MemoryRouter>
        <SessionRecorderHost />
      </MemoryRouter>,
    )
    expect(document.querySelector('[data-session-recorder-hud="true"]')).toBeNull()

    rerender(
      <MemoryRouter>
        <SessionRecorderHost floating />
      </MemoryRouter>,
    )
    const hud = document.querySelector('[data-session-recorder-hud="true"]') as HTMLElement
    expect(hud.className).toContain(SESSION_RECORDER_LAYER_ZCLASS)
    expect(hud.className).toContain('md:hidden')
    expect(hud.querySelector('button[aria-label="录制"]')).toBeTruthy()
  })
})
