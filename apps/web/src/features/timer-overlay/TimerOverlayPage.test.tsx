import { act, fireEvent, render, screen } from '@testing-library/react'
import TimerOverlayPage from './TimerOverlayPage'
import type { UnifiedTimerSnapshot } from '@/shared/components/session/desktopTimerBridge'

let snapshotHandler: ((snapshot: UnifiedTimerSnapshot) => void) | null = null
const sendTimerCommand = vi.fn()
const setOverlayCollapsed = vi.fn()

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
})
