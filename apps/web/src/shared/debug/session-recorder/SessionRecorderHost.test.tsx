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

  it('starts from the dialog, shows a global stop control, then copy includes notes', async () => {
    render(
      <MemoryRouter>
        <SessionRecorderHost />
      </MemoryRouter>,
    )

    act(() => openSessionRecorderDialog())
    expect(await screen.findByRole('dialog', { name: '操作记录' })).toBeTruthy()
    expect(screen.getByLabelText('文本操作记录')).toBeTruthy()
    expect(screen.getByLabelText('刚才碰到什么问题？（可选）')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '开始录制' }))
    expect(screen.queryByRole('dialog', { name: '操作记录' })).toBeNull()
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy()
    expect(screen.getByText(/录制中/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(await screen.findByRole('dialog', { name: '操作记录' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('刚才碰到什么问题？（可选）'), {
      target: { value: '点保存后卡片没了' },
    })
    fireEvent.click(screen.getByRole('button', { name: '复制' }))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled()
    })
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)?.[0] as string
    expect(copied).toContain('请根据以下操作记录排查错误。')
    expect(copied).toContain('## 用户补充')
    expect(copied).toContain('点保存后卡片没了')
  })

  it('does not show the floating stop control until recording starts', () => {
    render(
      <MemoryRouter>
        <SessionRecorderHost />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: '录制' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
    act(() => startSessionRecording())
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy()
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
