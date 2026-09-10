import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionRecorderHost } from './SessionRecorderHost'
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
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull()
    act(() => startSessionRecording())
    expect(screen.getByRole('button', { name: '停止' })).toBeTruthy()
  })
})
