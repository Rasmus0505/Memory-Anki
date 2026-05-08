import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setTimeRecordingThresholdSeconds } from '@/lib/session-records'
import { ProfileTimeRecordsPage } from '@/pages/Profile'

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart-container">{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => <div data-testid="area-chart-series" />,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Cell: () => <div />,
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/profile/time-records']}>
      <ProfileTimeRecordsPage />
    </MemoryRouter>,
  )
}

describe('ProfileTimeRecordsPage', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setTimeRecordingThresholdSeconds(0)
  })

  it('renders the empty state when there are no records', () => {
    renderPage()

    expect(screen.getByText('还没有可展示的时间记录。')).toBeTruthy()
  })

  it('renders chart sections, summary metrics, and table rows', () => {
    window.localStorage.setItem(
      'memory-anki.time-records.v1',
      JSON.stringify([
        {
          id: 'one',
          kind: 'review',
          palaceId: 1,
          title: '新文化运动',
          startedAt: '2026-05-08T14:54:00.000Z',
          endedAt: '2026-05-08T14:56:00.000Z',
          effectiveSeconds: 120,
          pauseCount: 0,
          completionMethod: 'left_page',
          durationEdited: false,
          events: [],
        },
        {
          id: 'two',
          kind: 'practice',
          palaceId: 1,
          title: '教育思潮',
          startedAt: '2026-05-07T14:54:00.000Z',
          endedAt: '2026-05-07T14:59:00.000Z',
          effectiveSeconds: 300,
          pauseCount: 2,
          completionMethod: 'saved',
          durationEdited: true,
          events: [],
        },
      ]),
    )

    renderPage()

    expect(screen.getByText('总记录数')).toBeTruthy()
    expect(screen.getByText('累计有效时长')).toBeTruthy()
    expect(screen.getByText('最近 7 天趋势')).toBeTruthy()
    expect(screen.getByText('会话类型分布')).toBeTruthy()
    expect(screen.getByText('时间记录列表')).toBeTruthy()
    expect(screen.getByText('手动新增记录')).toBeTruthy()
    expect(screen.getByText('新文化运动')).toBeTruthy()
    expect(screen.getAllByText('教育思潮').length).toBeGreaterThan(0)
    expect(screen.getAllByText('编辑').length).toBeGreaterThan(0)
    expect(screen.getAllByText('删除').length).toBeGreaterThan(0)
  })

  it('supports soft delete visibility toggle and restore', () => {
    window.localStorage.setItem(
      'memory-anki.time-records.v1',
      JSON.stringify([
        {
          id: 'one',
          kind: 'review',
          palaceId: 1,
          title: '零暂停',
          startedAt: '2026-05-08T14:54:00.000Z',
          endedAt: '2026-05-08T14:56:00.000Z',
          effectiveSeconds: 120,
          pauseCount: 0,
          completionMethod: 'left_page',
          durationEdited: false,
          events: [],
        },
        {
          id: 'two',
          kind: 'practice',
          palaceId: 1,
          title: '有暂停',
          startedAt: '2026-05-08T15:54:00.000Z',
          endedAt: '2026-05-08T15:59:00.000Z',
          effectiveSeconds: 300,
          pauseCount: 2,
          completionMethod: 'saved',
          durationEdited: true,
          events: [],
        },
      ]),
    )

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()

    expect(screen.getByText('已补录总时长')).toBeTruthy()
    expect(screen.getByText('未补录')).toBeTruthy()
    expect(screen.getAllByText('离开页面').length).toBeGreaterThan(0)
    expect(screen.getByText('保存结束')).toBeTruthy()

    const targetCell = screen.getByText('零暂停').closest('td')!
    const targetRow = targetCell.parentElement!
    fireEvent.click(within(targetRow).getByText('删除'))
    expect(screen.queryByText('零暂停')).toBeNull()

    fireEvent.click(screen.getByLabelText('显示已删除'))
    expect(screen.getByText('零暂停')).toBeTruthy()
    const deletedCell = screen.getByText('零暂停').closest('td')!
    const deletedRow = deletedCell.parentElement!
    expect(within(deletedRow).getByText('恢复')).toBeTruthy()

    fireEvent.click(within(deletedRow).getByText('恢复'))
    expect(screen.getByText('零暂停')).toBeTruthy()
  })

  it('supports selecting multiple records and bulk deleting them', () => {
    window.localStorage.setItem(
      'memory-anki.time-records.v1',
      JSON.stringify([
        {
          id: 'one',
          kind: 'review',
          palaceId: 1,
          title: '批量一',
          startedAt: '2026-05-08T14:54:00.000Z',
          endedAt: '2026-05-08T14:56:00.000Z',
          effectiveSeconds: 120,
          pauseCount: 0,
          completionMethod: 'left_page',
          durationEdited: false,
          events: [],
        },
        {
          id: 'two',
          kind: 'practice',
          palaceId: 1,
          title: '批量二',
          startedAt: '2026-05-08T15:54:00.000Z',
          endedAt: '2026-05-08T15:59:00.000Z',
          effectiveSeconds: 300,
          pauseCount: 2,
          completionMethod: 'saved',
          durationEdited: true,
          events: [],
        },
      ]),
    )

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPage()

    fireEvent.click(screen.getByLabelText('选择记录 批量一'))
    fireEvent.click(screen.getByLabelText('选择记录 批量二'))
    fireEvent.click(screen.getByText('批量删除所选'))

    expect(screen.queryByText('批量一')).toBeNull()
    expect(screen.queryByText('批量二')).toBeNull()

    fireEvent.click(screen.getByLabelText('显示已删除'))
    expect(screen.getByText('批量一')).toBeTruthy()
    expect(screen.getByText('批量二')).toBeTruthy()
  })

  it('filters historical records when threshold changes and blocks manual records at or below threshold', () => {
    window.localStorage.setItem(
      'memory-anki.time-records.v1',
      JSON.stringify([
        {
          id: 'short',
          kind: 'practice',
          palaceId: 1,
          title: '短记录',
          startedAt: '2026-05-08T14:54:00.000Z',
          endedAt: '2026-05-08T14:55:00.000Z',
          effectiveSeconds: 20,
          pauseCount: 0,
          completionMethod: 'left_page',
          durationEdited: false,
          events: [],
        },
        {
          id: 'long',
          kind: 'practice',
          palaceId: 1,
          title: '长记录',
          startedAt: '2026-05-08T15:54:00.000Z',
          endedAt: '2026-05-08T15:59:00.000Z',
          effectiveSeconds: 45,
          pauseCount: 0,
          completionMethod: 'saved',
          durationEdited: false,
          events: [],
        },
      ]),
    )

    renderPage()

    expect(screen.getByText('短记录')).toBeTruthy()
    expect(screen.getByText('长记录')).toBeTruthy()

    const thresholdInput = screen.getByLabelText('记录阈值（秒）')
    fireEvent.change(thresholdInput, { target: { value: '30' } })
    fireEvent.blur(thresholdInput)

    expect(screen.queryByText('短记录')).toBeNull()
    expect(screen.getByText('长记录')).toBeTruthy()

    fireEvent.click(screen.getByText('手动新增记录'))
    fireEvent.change(screen.getByLabelText('标题'), { target: { value: '手动短记录' } })
    fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '2026-05-09T00:00' } })
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '2026-05-09T00:01' } })
    fireEvent.change(screen.getByLabelText('有效时长（秒）'), { target: { value: '30' } })
    fireEvent.click(screen.getByText('新增记录'))

    expect(screen.getByText('有效时长必须大于 30 秒，才会进入时间记录。')).toBeTruthy()
  })
})
