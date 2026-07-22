import { act, fireEvent, render, screen } from '@testing-library/react'
import TimerOverlayPage from './TimerOverlayPage'
import type { UnifiedTimerSnapshot } from '@/shared/components/session/desktopTimerBridge'

let snapshotHandler: ((snapshot: UnifiedTimerSnapshot) => void) | null = null
const sendTimerCommand = vi.fn()
const setOverlayCollapsed = vi.fn()
const oscillatorStart = vi.fn()

class MockAudioContext {
  currentTime = 0
  destination = {}

  createOscillator() {
    return {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: oscillatorStart,
      stop: vi.fn(),
    }
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    }
  }

  close() {
    return Promise.resolve()
  }
}

vi.mock('@/shared/preferences/clientPreferences', () => ({
  getClientPreferenceCacheStatus: () => ({ hasEntry: false, value: null }),
  hasLoadedClientPreferences: () => false,
  saveClientPreference: vi.fn(),
}))

vi.mock('@/shared/components/session/desktopTimerBridge', async () => {
  const actual = await vi.importActual<typeof import('@/shared/components/session/desktopTimerBridge')>(
    '@/shared/components/session/desktopTimerBridge',
  )
  return {
    ...actual,
    getDesktopTimerBridge: () => ({
      onTimerSnapshot: (handler: (snapshot: UnifiedTimerSnapshot) => void) => {
        snapshotHandler = handler
        return () => {
          snapshotHandler = null
        }
      },
      sendTimerCommand,
      setOverlayCollapsed,
    }),
  }
})

describe('TimerOverlayPage', () => {
  beforeEach(() => {
    snapshotHandler = null
    sendTimerCommand.mockClear()
    setOverlayCollapsed.mockClear()
    oscillatorStart.mockClear()
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: MockAudioContext,
    })
  })

  it('renders without the main app shell', () => {
    render(<TimerOverlayPage />)

    expect(screen.getByText('待开始')).toBeTruthy()
    expect(screen.queryByText('个人中心')).toBeNull()
  })

  it('renders break countdown from the main timer snapshot', () => {
    render(<TimerOverlayPage />)

    act(() => {
      snapshotHandler?.({
        mode: 'break',
        status: 'running',
        title: '休息倒计时',
        scene: '休息中',
        displaySeconds: 90,
        primaryText: '计划 5 分钟',
        secondaryText: '延后 0 次',
        snoozeCount: 0,
        availableActions: ['pause', 'finishBreak', 'openTarget'],
        presetMinutes: [5, 10, 20],
        snoozeMinutes: [1, 3, 5],
        targetPath: '/freestyle',
        updatedAt: 1,
      })
    })

    expect(screen.getByText('休息倒计时')).toBeTruthy()
    expect(screen.getByText('01:30')).toBeTruthy()
    expect(screen.getByText('计划 5 分钟')).toBeTruthy()
  })

  it('sends commands instead of owning countdown state', () => {
    render(<TimerOverlayPage />)

    act(() => {
      snapshotHandler?.({
        mode: 'break',
        status: 'prompting',
        title: '要开始休息吗？',
        scene: '休息询问',
        displaySeconds: null,
        primaryText: '离开学习页一会儿了',
        secondaryText: '开始休息会暂停当前学习计时',
        snoozeCount: 0,
        availableActions: ['startBreak'],
        presetMinutes: [1, 3],
        snoozeMinutes: [1, 3, 5],
        targetPath: '/freestyle',
        updatedAt: 1,
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '3 分钟' }))

    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'startBreak', minutes: 3 })
    expect(screen.getByText('--:--')).toBeTruthy()
  })

  it('starts a custom break duration when pressing Enter in the minutes input', () => {
    render(<TimerOverlayPage />)

    act(() => {
      snapshotHandler?.({
        mode: 'break',
        status: 'prompting',
        title: '要开始休息吗？',
        scene: '休息询问',
        displaySeconds: null,
        primaryText: '离开学习页一会儿了',
        secondaryText: '开始休息会暂停当前学习计时',
        snoozeCount: 0,
        availableActions: ['startBreak'],
        presetMinutes: [1, 3],
        snoozeMinutes: [1, 3, 5],
        targetPath: '/freestyle',
        updatedAt: 1,
      })
    })

    fireEvent.change(screen.getByRole('spinbutton', { name: '自定义休息分钟' }), { target: { value: '8' } })
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: '自定义休息分钟' }), { key: 'Enter' })

    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'startBreak', minutes: 8 })
  })

  it('expands from capsule back to the card and restores the desktop window size', () => {
    render(<TimerOverlayPage />)

    fireEvent.click(screen.getByTitle('折叠为胶囊'))
    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'collapse', collapsed: true })
    expect(setOverlayCollapsed).toHaveBeenCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: '展开计时器' }))

    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'collapse', collapsed: false })
    expect(setOverlayCollapsed).toHaveBeenCalledWith(false)
    expect(screen.getByText('待开始')).toBeTruthy()
  })

  it('updates from break copy back to study copy when the main app publishes a study snapshot', () => {
    render(<TimerOverlayPage />)

    act(() => {
      snapshotHandler?.({
        mode: 'break',
        status: 'prompting',
        title: '要开始休息吗？',
        scene: '休息询问',
        displaySeconds: null,
        primaryText: '离开学习页一会儿了',
        secondaryText: '开始休息会暂停当前学习计时',
        snoozeCount: 0,
        availableActions: ['startBreak'],
        presetMinutes: [1, 3],
        snoozeMinutes: [1, 3, 5],
        targetPath: '/freestyle',
        updatedAt: 1,
      })
    })
    expect(screen.getByText('休息询问')).toBeTruthy()

    act(() => {
      snapshotHandler?.({
        mode: 'study',
        status: 'running',
        title: '随心模式',
        scene: '随心模式',
        displaySeconds: 55,
        primaryText: '闲置 0/120 秒',
        secondaryText: '00:05/25:00 0.00',
        snoozeCount: 0,
        availableActions: ['pause'],
        presetMinutes: [],
        snoozeMinutes: [],
        targetPath: '/freestyle',
        updatedAt: 2,
      })
    })

    expect(screen.getByText('学习计时')).toBeTruthy()
    expect(screen.getByText('随心模式')).toBeTruthy()
    expect(screen.getByText('00:55')).toBeTruthy()
    expect(screen.queryByText('休息询问')).toBeNull()
  })

  it('renders effective elapsed time, round progress, and goal actions from the shared snapshot', () => {
    render(<TimerOverlayPage />)

    act(() => {
      snapshotHandler?.({
        mode: 'study',
        status: 'running',
        title: '随心模式',
        scene: '随心模式',
        displaySeconds: 1502,
        studyPhase: 'goal_reached',
        effectiveSeconds: 1502,
        roundElapsedSeconds: 1502,
        roundTargetSeconds: 1500,
        roundIndex: 1,
        idleWarningRemainingSeconds: null,
        suggestedBreakMinutes: 5,
        feedbackSignal: null,
        primaryText: '目标完成',
        secondaryText: '',
        snoozeCount: 0,
        availableActions: ['continueRound', 'startGoalBreak'],
        presetMinutes: [],
        snoozeMinutes: [],
        targetPath: '/freestyle',
        updatedAt: 3,
      })
    })

    expect(screen.getByText('25:02')).toBeTruthy()
    expect(screen.getByText('第 1 轮目标完成')).toBeTruthy()
    expect(screen.getByText('本轮 25:02/25:00')).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: '本轮专注进度' }).getAttribute('aria-valuenow')).toBe('100')

    fireEvent.click(screen.getByRole('button', { name: '继续学习' }))
    fireEvent.click(screen.getByRole('button', { name: '休息 5 分钟' }))

    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'continueRound' })
    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'startGoalBreak', minutes: 5 })
  })

  it('shows the idle warning while keeping the pause command available', () => {
    render(<TimerOverlayPage />)

    act(() => {
      snapshotHandler?.({
        mode: 'study',
        status: 'running',
        title: '复习会话',
        scene: '复习',
        displaySeconds: 121,
        studyPhase: 'idle_warning',
        effectiveSeconds: 121,
        roundElapsedSeconds: 121,
        roundTargetSeconds: 1500,
        roundIndex: 1,
        idleWarningRemainingSeconds: 29,
        suggestedBreakMinutes: 5,
        feedbackSignal: null,
        primaryText: '',
        secondaryText: '',
        snoozeCount: 0,
        availableActions: ['pause'],
        presetMinutes: [],
        snoozeMinutes: [],
        targetPath: '/freestyle',
        updatedAt: 4,
      })
    })

    expect(screen.getByText('仍在学习吗？ 29 秒后暂停')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'pause' })
  })

  it('starts study explicitly after an expired break', () => {
    render(<TimerOverlayPage />)

    act(() => {
      snapshotHandler?.({
        mode: 'break',
        status: 'expired',
        title: '该回来了',
        scene: '休息到点',
        displaySeconds: 0,
        primaryText: '休息已经结束',
        secondaryText: '计划 5 分钟',
        snoozeCount: 0,
        availableActions: ['snooze', 'startStudy'],
        presetMinutes: [5],
        snoozeMinutes: [1, 3, 5],
        targetPath: '/freestyle',
        updatedAt: 5,
      })
    })

    fireEvent.click(screen.getByRole('button', { name: '开始学习' }))
    expect(sendTimerCommand).toHaveBeenCalledWith({ type: 'startStudy' })
  })

  it('plays each focus feedback signal only once even when the snapshot is republished', () => {
    render(<TimerOverlayPage />)
    const publishSignal = (nonce: number, kind: 'interval' | 'goal', updatedAt: number) => {
      snapshotHandler?.({
        mode: 'study',
        status: 'running',
        title: '随心模式',
        scene: '随心模式',
        displaySeconds: 300,
        studyPhase: 'focusing',
        effectiveSeconds: 300,
        roundElapsedSeconds: 300,
        roundTargetSeconds: 1500,
        roundIndex: 1,
        idleWarningRemainingSeconds: null,
        suggestedBreakMinutes: 5,
        feedbackSignal: {
          eventId: `session:round:1:${kind}:${nonce}`,
          kind,
          ordinal: nonce,
          roundIndex: 1,
          occurredAt: updatedAt,
        },
        primaryText: '正在计时',
        secondaryText: '',
        snoozeCount: 0,
        availableActions: ['pause'],
        presetMinutes: [],
        snoozeMinutes: [],
        targetPath: '/freestyle',
        updatedAt,
      })
    }

    act(() => publishSignal(1, 'interval', 6))
    act(() => publishSignal(1, 'interval', 7))
    expect(oscillatorStart).toHaveBeenCalledTimes(1)

    act(() => publishSignal(2, 'goal', 8))
    expect(oscillatorStart).toHaveBeenCalledTimes(2)
  })
})
