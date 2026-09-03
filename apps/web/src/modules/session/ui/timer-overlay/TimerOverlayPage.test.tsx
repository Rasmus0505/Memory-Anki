import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UnifiedTimerSnapshot } from '@/shared/components/session/desktopTimerBridge'
import TimerOverlayPage from './TimerOverlayPage'

let snapshotHandler: ((snapshot: UnifiedTimerSnapshot) => void) | null = null
const sendTimerCommand = vi.fn()

vi.mock('@/shared/components/session/desktopTimerBridge', () => ({
  getDesktopTimerBridge: () => ({
    onTimerSnapshot: (handler: (snapshot: UnifiedTimerSnapshot) => void) => {
      snapshotHandler = handler
      return () => {
        snapshotHandler = null
      }
    },
    sendTimerCommand,
    setOverlayCollapsed: vi.fn(),
  }),
}))

function snapshot(overrides: Partial<UnifiedTimerSnapshot> = {}): UnifiedTimerSnapshot {
  return {
    mode: 'study',
    status: 'running',
    ownerSessionId: 'session-1',
    ownerSessionKey: 'freestyle',
    title: '随心模式',
    scene: '随心模式',
    displaySeconds: 65,
    effectiveSeconds: 65,
    primaryText: '正在计时',
    secondaryText: '有效学习时间 01:05',
    availableActions: ['pause'],
    targetPath: '/freestyle',
    updatedAt: Date.now(),
    semanticState: 'running',
    progressMode: 'elapsed',
    ...overrides,
  }
}

describe('TimerOverlayPage', () => {
  beforeEach(() => {
    snapshotHandler = null
    sendTimerCommand.mockReset()
  })

  it('renders the effective clock and pause action', async () => {
    render(<TimerOverlayPage />)
    await act(async () => {
      await Promise.resolve()
      snapshotHandler?.(snapshot())
    })
    expect(screen.getByText('01:05')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'pause' })
  })

  it('sends resume for a paused snapshot and does not expose break controls', async () => {
    render(<TimerOverlayPage />)
    await act(async () => {
      await Promise.resolve()
      snapshotHandler?.(snapshot({ status: 'paused', availableActions: ['resume'], semanticState: 'paused' }))
    })
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'resume' })
    expect(screen.queryByText(/休息/)).toBeNull()
    expect(screen.queryByText(/专注/)).toBeNull()
  })

  it('supports collapse and hide without changing timer state', async () => {
    render(<TimerOverlayPage />)
    await act(async () => {
      await Promise.resolve()
      snapshotHandler?.(snapshot())
    })
    fireEvent.click(screen.getByRole('button', { name: '收起计时器' }))
    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'collapse', collapsed: true })
    fireEvent.click(screen.getByRole('button', { name: '隐藏计时器' }))
    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'closeOverlay' })
  })
})
