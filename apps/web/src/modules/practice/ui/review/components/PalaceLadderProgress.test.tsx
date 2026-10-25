import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PalaceLadderProgress } from './PalaceLadderProgress'

const apiMocks = vi.hoisted(() => ({
  getPalaceLadderProgressApi: vi.fn(),
}))

vi.mock('../api/unitReviewApi', () => ({
  getPalaceLadderProgressApi: (...args: unknown[]) => apiMocks.getPalaceLadderProgressApi(...args),
}))

function samplePayload(overrides: Record<string, unknown> = {}) {
  return {
    palace_id: 7,
    title: '测试宫殿',
    ladder: [0, 1, 3, 7, 14, 30, 60, 120, 240, 365],
    scope: 'unit' as const,
    current: {
      unit_id: 'u1',
      title: '单元',
      stage_index: 3,
      interval_days: 7,
      due_date: '2026-08-01',
      due: false,
      has_passed: true,
      horizon: 'd3' as const,
    },
    palace: {
      unit_count: 2,
      due_count: 1,
      weakest_stage_index: 0,
      stage_histogram: [1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
      due_horizon: { today: 0, d3: 1, week: 0, month: 1, later: 0 },
      next_review_date: '2026-08-01',
      review_status: 'due',
      mark_required: false,
    },
    unit_range_stats: {
      range: 'all' as const,
      per_stage: Array.from({ length: 10 }, (_, stage_index) => ({
        stage_index,
        interval_days: [0, 1, 3, 7, 14, 30, 60, 120, 240, 365][stage_index],
        pass_count: stage_index === 3 ? 3 : 0,
        last_at: stage_index === 3 ? '2026-07-28T10:00:00+00:00' : null,
        seconds: stage_index === 3 ? 120 : 0,
      })),
      total_reviews: 4,
      total_seconds: 200,
      rating_share: { forgot: 0, hard: 1, remember: 2, easy: 1 },
    },
    palace_range_stats: {
      range: 'all' as const,
      per_stage: Array.from({ length: 10 }, (_, stage_index) => ({
        stage_index,
        interval_days: [0, 1, 3, 7, 14, 30, 60, 120, 240, 365][stage_index],
        pass_count: 0,
        last_at: null,
        seconds: 0,
      })),
      total_reviews: 5,
      total_seconds: 300,
      rating_share: { forgot: 1, hard: 1, remember: 2, easy: 1 },
    },
    selected_range_summary: {
      range: 'all' as const,
      unit_count: 4,
      total_seconds: 420,
      freestyle_rating_count: 6,
      quiz_count: 2,
    },
    palace_all_time_summary: {
      range: 'all' as const,
      unit_count: 2,
      total_seconds: 600,
      freestyle_rating_count: 5,
      quiz_count: 3,
    },
    ...overrides,
  }
}

describe('PalaceLadderProgress', () => {
  beforeEach(() => {
    apiMocks.getPalaceLadderProgressApi.mockReset()
    apiMocks.getPalaceLadderProgressApi.mockResolvedValue(samplePayload())
    try {
      localStorage.removeItem('memory-anki.ladder-progress.range')
    } catch {
      // ignore
    }
  })

  it('shows a due-date distribution instead of ladder levels', async () => {
    render(<PalaceLadderProgress palaceId={7} unitId="u1" />)

    await screen.findByTestId('palace-ladder-progress')
    expect(apiMocks.getPalaceLadderProgressApi).toHaveBeenCalledWith(7, {
      range: 'all',
      unitId: 'u1',
    })
    expect(screen.getByTestId('horizon-today').textContent).toBe('今天0')
    expect(screen.getByTestId('horizon-d3').textContent).toBe('3天内1')
    expect(screen.getByTestId('horizon-month').textContent).toBe('本月1')
    // The current unit's own bucket is the one marked.
    expect(screen.getByTestId('horizon-d3').getAttribute('data-current')).toBe('true')
    expect(screen.getByTestId('horizon-today').getAttribute('data-current')).toBeNull()
  })

  it('labels the number as the booked interval, not a level', async () => {
    render(<PalaceLadderProgress palaceId={7} unitId="u1" />)
    expect(await screen.findByText('间隔 7天')).toBeTruthy()
  })

  it('marks the unit as due today when the booked gap is zero', async () => {
    apiMocks.getPalaceLadderProgressApi.mockResolvedValue(
      samplePayload({
        current: {
          ...samplePayload().current,
          interval_days: 0,
          has_passed: true,
          due: true,
          horizon: 'today',
        },
      }),
    )
    render(<PalaceLadderProgress palaceId={7} unitId="u1" />)
    expect(await screen.findByText('今天到期')).toBeTruthy()
  })

  it('explains a bucket on hover and says when the current unit is in it', async () => {
    render(<PalaceLadderProgress palaceId={7} unitId="u1" />)
    await screen.findByTestId('horizon-d3')

    fireEvent.mouseEnter(screen.getByTestId('horizon-d3'))
    const tip = await screen.findByTestId('ladder-horizon-tooltip')
    expect(tip.textContent).toContain('3天内 · 1 个单元')
    expect(tip.textContent).toContain('占整宫 50%')
    expect(tip.textContent).toContain('当前单元在这里（8月1日）')
  })

  it('says a bucket is empty instead of leaving a silent zero', async () => {
    render(<PalaceLadderProgress palaceId={7} unitId="u1" />)
    await screen.findByTestId('horizon-week')

    fireEvent.mouseEnter(screen.getByTestId('horizon-week'))
    const tip = await screen.findByTestId('ladder-horizon-tooltip')
    expect(tip.textContent).toContain('本周 · 0 个单元')
    expect(tip.textContent).toContain('这段时间没有单元到期')
  })

  it('shows the palace distribution and the real gap on track hover', async () => {
    render(<PalaceLadderProgress palaceId={7} unitId="u1" />)
    const image = await screen.findByRole('group', { name: /到期分布/ })

    fireEvent.mouseEnter(image.parentElement as HTMLElement)
    const tip = await screen.findByTestId('ladder-track-tooltip')
    expect(tip.textContent).toContain('当前单元 · 当前间隔 约 7 天后')
    expect(tip.textContent).toContain('下次复习：8月1日')
    expect(tip.textContent).toContain('宫殿：2 个单元 · 1 个到期 · 最近到期 8月1日')
    expect(tip.textContent).toContain('到期分布：3天内×1 · 本月×1')
    expect(tip.textContent).toContain('全部记录：5 次 · 学习总时长 5分')
    expect(tip.textContent).toContain('评分：忘记 1 · 困难 1 · 记得 2 · 轻松 1')
  })

  it('shows range and palace learning summaries from the leading nodes', async () => {
    render(<PalaceLadderProgress palaceId={7} unitId="u1" />)
    await screen.findByTestId('ladder-summary-range')

    fireEvent.mouseEnter(screen.getByTestId('ladder-summary-range'))
    const rangeTip = await screen.findByTestId('ladder-summary-tooltip')
    expect(rangeTip.textContent).toContain('全部记录学习情况')
    expect(rangeTip.textContent).toContain('学习单元数：4')
    expect(rangeTip.textContent).toContain('学习总时长：7分')
    expect(rangeTip.textContent).toContain('随心刷卡次数：6 次')
    expect(rangeTip.textContent).toContain('刷题数量：2 题')

    fireEvent.mouseEnter(screen.getByTestId('ladder-summary-palace'))
    const palaceTip = await screen.findByTestId('ladder-summary-tooltip')
    expect(palaceTip.textContent).toContain('当前宫殿 · 全部学习情况')
    expect(palaceTip.textContent).toContain('学习总时长：10分')
  })

  it('says the palace has no units instead of drawing an empty strip', async () => {
    apiMocks.getPalaceLadderProgressApi.mockResolvedValue(
      samplePayload({
        current: null,
        palace: {
          ...samplePayload().palace,
          unit_count: 0,
          due_count: 0,
          due_horizon: { today: 0, d3: 0, week: 0, month: 0, later: 0 },
        },
        scope: 'palace',
      }),
    )
    render(<PalaceLadderProgress palaceId={7} unitId="u1" />)
    expect(await screen.findByText('暂无单元')).toBeTruthy()
  })

  it('refetches when range changes', async () => {
    render(<PalaceLadderProgress palaceId={7} unitId="u1" />)
    await screen.findByTestId('ladder-range-select')

    fireEvent.change(screen.getByTestId('ladder-range-select'), {
      target: { value: 'week' },
    })

    await waitFor(() => {
      expect(apiMocks.getPalaceLadderProgressApi).toHaveBeenCalledWith(7, {
        range: 'week',
        unitId: 'u1',
      })
    })
  })
})
