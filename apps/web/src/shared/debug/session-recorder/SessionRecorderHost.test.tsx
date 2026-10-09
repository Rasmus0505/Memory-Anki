import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SESSION_RECORDER_ANCHOR_ATTR, SESSION_RECORDER_LAYER_ZCLASS, SessionRecorderHost } from './SessionRecorderHost'
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
    expect(copied).toContain('请根据下面这段刚才的操作')
    expect(copied).toContain('## 用户补充')
    expect(copied).toContain('点保存后卡片没了')
  })

  it('keeps the floating button as 录制 and never shows stop', () => {
    render(
      <MemoryRouter>
        <SessionRecorderHost />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: '录制' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
    act(() => startSessionRecording())
    expect(screen.getByRole('button', { name: '录制' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
  })

  it('keeps the recorder above dialogs, follows the sidebar anchor, and can be dragged', () => {
    const anchor = document.createElement('div')
    anchor.setAttribute(SESSION_RECORDER_ANCHOR_ATTR, 'true')
    document.body.appendChild(anchor)
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
      x: 28,
      y: 18,
      left: 28,
      top: 18,
      right: 64,
      bottom: 54,
      width: 36,
      height: 36,
      toJSON() {
        return {}
      },
    })

    render(
      <MemoryRouter>
        <SessionRecorderHost />
      </MemoryRouter>,
    )

    const hud = document.querySelector('[data-session-recorder-hud="true"]') as HTMLElement
    expect(hud.className).toContain(SESSION_RECORDER_LAYER_ZCLASS)
    expect(hud.style.left).toBe('28px')
    expect(hud.style.top).toBe('18px')

    act(() => startSessionRecording())
    const pointerDown = new MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 30 })
    const pointerMove = new MouseEvent('pointermove', { bubbles: true, clientX: 120, clientY: 90 })
    expect(pointerDown.clientX).toBe(40)
    expect(pointerMove.clientX).toBe(120)
    act(() => {
      hud.dispatchEvent(pointerDown)
      window.dispatchEvent(pointerMove)
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
    })

    expect(hud.style.left).toBe('108px')
    expect(hud.style.top).toBe('78px')
    anchor.remove()
  })
})
