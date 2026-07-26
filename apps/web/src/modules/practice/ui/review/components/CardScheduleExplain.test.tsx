import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CardScheduleExplain, formatScheduleSource } from './CardScheduleExplain'

const detailMock = vi.fn()

vi.mock('@/modules/practice/ui/review/api/scheduleInsightApi', () => ({
  getNodeScheduleDetailApi: (...args: unknown[]) => detailMock(...args),
}))

function renderExplain() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CardScheduleExplain palaceId={7} nodeUid="node-a" />
    </QueryClientProvider>,
  )
}

describe('CardScheduleExplain', () => {
  beforeEach(() => {
    detailMock.mockReset()
  })

  it('lazy-loads the schedule detail only after expanding', async () => {
    detailMock.mockResolvedValue({
      item: {
        palace_id: 7,
        node_uid: 'node-a',
        exists: true,
        state: 2,
        stability_days: 12.4,
        difficulty: 5.31,
        retrievability: 0.87,
        last_review_at: '2026-07-20T02:00:00Z',
        raw_due_at: '2026-07-24T02:00:00Z',
        effective_due_at: '2026-07-26T02:00:00Z',
        shifted: true,
        schedule_source: 'aggregated_pull',
        schedule_reason: '聚合到本宫殿集中复习日',
        previews: [],
      },
    })
    renderExplain()

    expect(detailMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /为什么是今天/ }))
    expect(await screen.findByText('稳定度')).toBeTruthy()
    expect(detailMock).toHaveBeenCalledWith(7, 'node-a')
    expect(screen.getByText('12 天')).toBeTruthy()
    expect(screen.getByText('87%')).toBeTruthy()
    expect(screen.getByText('聚合日挪动')).toBeTruthy()
    expect(screen.getByText(/到期日被挪动：聚合到本宫殿集中复习日/)).toBeTruthy()
  })

  it('explains backlog cards that are not scheduled yet', async () => {
    detailMock.mockResolvedValue({
      item: {
        palace_id: 7,
        node_uid: 'node-a',
        exists: false,
        state: 'backlog_new',
        stability_days: null,
        difficulty: null,
        retrievability: null,
        last_review_at: null,
        raw_due_at: null,
        effective_due_at: null,
        shifted: false,
        schedule_source: 'backlog',
        schedule_reason: '尚未放出：等待每日新学额度',
        previews: [],
      },
    })
    renderExplain()
    fireEvent.click(screen.getByRole('button', { name: /为什么是今天/ }))
    expect(await screen.findByText(/尚未放出：等待每日新学额度/)).toBeTruthy()
  })

  it('maps schedule sources to Chinese labels', () => {
    expect(formatScheduleSource('fsrs_direct')).toBe('FSRS 直出')
    expect(formatScheduleSource('aggregated_push')).toBe('聚合日挪动')
    expect(formatScheduleSource('daily_new_release')).toBe('今日新学放出')
  })
})
