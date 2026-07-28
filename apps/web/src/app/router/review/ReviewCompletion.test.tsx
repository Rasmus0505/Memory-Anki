import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ReviewCompletion from '@/app/router/review/ReviewCompletion'

vi.mock('@/modules/practice/public', () => ({
  getUnitReviewCompletionApi: vi.fn().mockResolvedValue({
    study_session_id: 'session-1',
    palace_id: 2,
    completed_unit_count: 4,
    duration_seconds: 95,
    hard_retry_count: 2,
    again_retry_count: 1,
    next_review_date: '2026-07-30',
    completed_at: '2026-07-27T10:00:00Z',
  }),
}))

describe('ReviewCompletion unit receipt', () => {
  it('shows only unit-level completion facts', async () => {
    render(
      <MemoryRouter initialEntries={['/review/completed/session-1']}>
        <Routes>
          <Route path="/review/completed/:reviewLogId" element={<ReviewCompletion />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('本次单元复习已完成')).toBeTruthy()
    expect(screen.getByText('4')).toBeTruthy()
    expect(screen.getByText('1分35秒')).toBeTruthy()
    expect(screen.getByText('2 / 1')).toBeTruthy()
    expect(screen.queryByText(/FSRS/)).toBeNull()
    expect(screen.queryByText(/掌握/)).toBeNull()
  })
})
