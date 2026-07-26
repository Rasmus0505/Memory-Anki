import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReviewLoadCalendar } from './ReviewLoadCalendar'

const forecastMock = vi.fn()

vi.mock('@/modules/practice/ui/review/api/reviewApi', () => ({
  getReviewLoadForecastApi: (...args: unknown[]) => forecastMock(...args),
}))

function renderCalendar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ReviewLoadCalendar />
    </QueryClientProvider>,
  )
}

describe('ReviewLoadCalendar', () => {
  beforeEach(() => {
    forecastMock.mockReset()
  })

  it('renders 30-day bars with today highlighted and overdue shown separately', async () => {
    forecastMock.mockResolvedValue({
      days: 30,
      overdue_count: 4,
      total_upcoming: 57,
      items: Array.from({ length: 30 }, (_, index) => ({
        date: `2026-08-${String(index + 1).padStart(2, '0')}`,
        due_count: index === 0 ? 9 : index % 3,
        is_today: index === 0,
      })),
    })
    renderCalendar()

    expect(await screen.findByText(/复习日历 · 未来 30 天共 57 张/)).toBeTruthy()
    expect(screen.getByText('逾期 4 张')).toBeTruthy()
    expect(screen.getByTestId('load-bar-today')).toBeTruthy()
    expect(forecastMock).toHaveBeenCalledWith(30)
  })

  it('renders nothing while forecast is unavailable', async () => {
    forecastMock.mockRejectedValue(new Error('offline'))
    const { container } = renderCalendar()
    // 拿不到数据时静默隐藏，不阻塞复习队列页
    await Promise.resolve()
    expect(container.querySelector('[data-testid="review-load-calendar"]')).toBeNull()
  })
})
