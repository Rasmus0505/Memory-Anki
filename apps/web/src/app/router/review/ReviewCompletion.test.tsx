import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ReviewCompletion from '@/app/router/review/ReviewCompletion'

vi.mock('@/features/review/api', () => ({ getReviewCompletionApi: vi.fn().mockResolvedValue({ ok: true, completion_mode: 'manual_complete', score: 3, next_id: null, review_log_id: 1, palace_id: 2, chapter_id: null, duration_seconds: 30, scope_node_count: 3, rated_node_count: 2, unrated_due_node_count: 1, rating_counts: { 忘记: 0, 困难: 1, 记得: 1, 轻松: 0 }, mastery_progress: 0.5, mastery_percent: 50, memory_health: 0.8, memory_health_percent: 80, remaining_due_node_count: 1, due_node_count: 1, overdue_node_count: 0, next_review_at: '2026-07-16T10:00:00Z' }) }))

describe('ReviewCompletion FSRS receipt', () => {
  it('shows ratings, memory state, and unrated nodes', async () => {
    render(<MemoryRouter initialEntries={['/review/completed/1']}><Routes><Route path="/review/completed/:reviewLogId" element={<ReviewCompletion />} /></Routes></MemoryRouter>)
    expect(await screen.findByText('本次 FSRS 复习已完成')).toBeTruthy()
    expect(screen.getByText('2/3')).toBeTruthy()
    expect(screen.getByText(/本次未评分 1 个节点保持到期/)).toBeTruthy()
  })
})
