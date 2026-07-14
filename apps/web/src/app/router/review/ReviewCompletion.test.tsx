import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ReviewCompletion from '@/app/router/review/ReviewCompletion'

vi.mock('@/features/review/api', () => ({
  getReviewCompletionApi: vi.fn(async () => ({
    ok: true,
    completion_mode: 'manual_complete',
    score: 5,
    next_id: 310,
    mastered: false,
    review_log_id: 801,
    palace_id: 1,
    chapter_id: 42,
    duration_seconds: 75,
    completed_stage_count: 4,
    total_stage_count: 9,
    completed_stage_label: '2天',
    next_stage_label: '4天',
    next_review_at: '2026-07-15T10:00:00',
    needs_practice: false,
  })),
}))

describe('ReviewCompletion', () => {
  it('reloads and renders the persisted completion receipt', async () => {
    render(
      <MemoryRouter initialEntries={['/review/completed/801']}>
        <Routes>
          <Route path="/review/completed/:reviewLogId" element={<ReviewCompletion />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('本次复习已完成')).toBeTruthy()
    expect(screen.getByText('1分 15秒')).toBeTruthy()
    expect(screen.getByText('4/9')).toBeTruthy()
    expect(screen.getByRole('link', { name: /下一条复习/ }).getAttribute('href')).toBe('/review/session/310')
    expect(screen.getByRole('link', { name: /返回复习队列/ }).getAttribute('href')).toBe('/review')
  })
})
