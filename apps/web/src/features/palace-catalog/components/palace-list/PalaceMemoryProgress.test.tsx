import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPalaceMasteryTrendApi } from '@/entities/review/api'
import { PalaceMemoryProgress } from './PalaceMemoryProgress'

vi.mock('@/entities/review/api', () => ({
  getPalaceMasteryTrendApi: vi.fn(),
}))

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: ReactNode }) => <div data-testid="trend-chart">{children}</div>,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}))

const getTrendMock = vi.mocked(getPalaceMasteryTrendApi)

function palace(id: number, masteryPercent: number) {
  return { id, mastery_percent: masteryPercent }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('PalaceMemoryProgress', () => {
  beforeEach(() => {
    getTrendMock.mockReset()
  })

  function trendTrigger(masteryPercent: number) {
    return screen.getByRole('button', { name: `掌握度 ${masteryPercent}%，查看趋势` })
  }

  it('shows only mastery and the progress bar before opening the trend card', () => {
    render(<PalaceMemoryProgress palace={palace(1, 42)} />)

    expect(screen.getByText('掌握 42%')).toBeTruthy()
    expect(screen.queryByText(/记忆|到期|逾期|弱点/)).toBeNull()
    expect(trendTrigger(42)).toBeTruthy()
    expect(screen.getByRole('progressbar', { name: '掌握度 42%' })).toBeTruthy()
  })

  it('opens trend only from the progress bar, not from the mastery label', async () => {
    getTrendMock.mockResolvedValue({ palace_id: 1, points: [] })
    render(<PalaceMemoryProgress palace={palace(1, 42)} />)

    fireEvent.pointerEnter(screen.getByText('掌握 42%'))
    expect(screen.queryByText('掌握度趋势')).toBeNull()
    expect(getTrendMock).not.toHaveBeenCalled()

    fireEvent.pointerEnter(trendTrigger(42))
    expect(await screen.findByText('完成一次正式复习后，这里会显示掌握度变化')).toBeTruthy()
  })

  it('closes the trend card as soon as the pointer leaves the progress bar', async () => {
    getTrendMock.mockResolvedValue({ palace_id: 1, points: [] })
    render(<PalaceMemoryProgress palace={palace(1, 42)} />)

    fireEvent.pointerEnter(trendTrigger(42))
    expect(await screen.findByText('完成一次正式复习后，这里会显示掌握度变化')).toBeTruthy()

    fireEvent.pointerLeave(trendTrigger(42))
    await waitFor(() => {
      expect(screen.queryByText('完成一次正式复习后，这里会显示掌握度变化')).toBeNull()
    })
  })

  it('uses the same concise empty state when no formal review is completed', async () => {
    getTrendMock.mockResolvedValue({ palace_id: 1, points: [] })
    render(<PalaceMemoryProgress palace={palace(1, 0)} />)

    fireEvent.focus(trendTrigger(0))

    expect(await screen.findByText('完成一次正式复习后，这里会显示掌握度变化')).toBeTruthy()
    expect(screen.queryByText(/到期|逾期|弱点|记忆健康/)).toBeNull()
  })

  it.each([
    { previous: 36, current: 42, label: '↑ 6%' },
    { previous: 45, current: 42, label: '↓ 3%' },
    { previous: 42, current: 42, label: '持平' },
  ])('shows $label against the previous formal completion', async ({ previous, current, label }) => {
    getTrendMock.mockResolvedValue({
      palace_id: 1,
      points: [
        { at: '2026-07-15T09:20:00', mastery_progress: previous / 100, mastery_percent: previous },
        { at: '2026-07-16T10:30:00', mastery_progress: current / 100, mastery_percent: current },
      ],
    })
    render(<PalaceMemoryProgress palace={palace(1, current)} />)

    fireEvent.pointerEnter(trendTrigger(current))

    expect((await screen.findAllByText(label)).length).toBeGreaterThan(0)
    expect(screen.getByTestId('trend-chart')).toBeTruthy()
    expect(screen.getByText('最近正式复习')).toBeTruthy()
    expect(screen.getByText(/较上次正式复习/)).toBeTruthy()
    expect(screen.getByText(/共 2 次正式复习/)).toBeTruthy()
    expect(screen.getByText(/每个点 = 一次正式复习结束后的宫殿掌握度/)).toBeTruthy()
  })

  it('labels a single formal completion as the first record', async () => {
    getTrendMock.mockResolvedValue({
      palace_id: 1,
      points: [
        { at: '2026-07-16T10:30:00', mastery_progress: 0.42, mastery_percent: 42 },
      ],
    })
    render(<PalaceMemoryProgress palace={palace(1, 42)} />)

    fireEvent.click(trendTrigger(42))

    expect(await screen.findByText('首次记录')).toBeTruthy()
    expect(screen.getByText(/这是第一次正式复习后的记录/)).toBeTruthy()
    expect(screen.getByText('起点')).toBeTruthy()
  })

  it('does not let a stale palace trend update the next palace card', async () => {
    const first = deferred<{ palace_id: number; points: Array<{ at: string; mastery_progress: number; mastery_percent: number }> }>()
    const second = deferred<{ palace_id: number; points: Array<{ at: string; mastery_progress: number; mastery_percent: number }> }>()
    getTrendMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const view = render(<PalaceMemoryProgress palace={palace(1, 10)} />)

    fireEvent.focus(trendTrigger(10))
    view.rerender(<PalaceMemoryProgress palace={palace(2, 20)} />)
    fireEvent.focus(trendTrigger(20))

    first.resolve({
      palace_id: 1,
      points: [{ at: '2026-07-15T09:00:00', mastery_progress: 0.9, mastery_percent: 90 }],
    })
    await Promise.resolve()
    expect(screen.queryByText('首次记录')).toBeNull()

    second.resolve({
      palace_id: 2,
      points: [{ at: '2026-07-16T09:00:00', mastery_progress: 0.2, mastery_percent: 20 }],
    })
    await waitFor(() => expect(screen.getByText('首次记录')).toBeTruthy())
    expect(screen.getAllByText('20%').length).toBeGreaterThan(0)
  })

  it('shows a non-blocking message when trend loading fails', async () => {
    getTrendMock.mockRejectedValue(new Error('offline'))
    render(<PalaceMemoryProgress palace={palace(1, 42)} />)

    fireEvent.focus(trendTrigger(42))

    expect(await screen.findByText('暂时无法读取趋势，请稍后再试')).toBeTruthy()
    expect(screen.getByText('掌握 42%')).toBeTruthy()
  })
})
