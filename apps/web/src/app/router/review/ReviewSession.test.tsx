import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewSession from '@/app/router/review/ReviewSession'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  toastSuccess: vi.fn(),
  getReviewSessionApi: vi.fn(),
  getReviewSessionProgressApi: vi.fn(),
  clearReviewSessionProgressApi: vi.fn(),
  submitReviewSessionApi: vi.fn(),
  getPalaceEditorApi: vi.fn(),
}))

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => mocks.navigate,
  useParams: () => ({ id: '309' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    info: vi.fn(),
  },
}))

vi.mock('@/features/review/components/MindMapReviewFlow', () => ({
  MindMapReviewFlow: ({ onComplete }: { onComplete: (payload: any) => void }) => (
    <button
      type="button"
      onClick={() =>
        onComplete({
          durationSeconds: 12,
          completionMode: 'manual_complete',
          revealedRemaining: true,
          redNodeIds: ['node-1'],
        })
      }
    >
      完成
    </button>
  ),
}))

vi.mock('@/shared/api/modules/reviews', () => ({
  getReviewSessionApi: (...args: unknown[]) => mocks.getReviewSessionApi(...args),
  getReviewSessionProgressApi: (...args: unknown[]) => mocks.getReviewSessionProgressApi(...args),
  clearReviewSessionProgressApi: (...args: unknown[]) => mocks.clearReviewSessionProgressApi(...args),
  saveReviewSessionProgressApi: vi.fn(),
  submitReviewSessionApi: (...args: unknown[]) => mocks.submitReviewSessionApi(...args),
}))

vi.mock('@/shared/api/modules/palaces', () => ({
  buildAttachmentUrl: (id: number) => `/attachments/${id}`,
  getPalaceEditorApi: (...args: unknown[]) => mocks.getPalaceEditorApi(...args),
}))

describe('ReviewSession', () => {
  beforeEach(() => {
    mocks.navigate.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.getReviewSessionApi.mockResolvedValue({
      id: 309,
      palace_id: 1,
      algorithm_used: 'ebbinghaus',
      review_type: 'standard',
      review_number: 3,
      interval_days: 1,
      palace: {
        id: 1,
        title: '第四节 收回教育权运动与教会教育的变革',
        attachments: [],
        stage_labels: ['1小时', '睡前', '1天', '2天', '4天', '7天', '15天', '30天', '60天'],
        review_stages: [
          { review_number: 0, label: '1小时', completed: true, completed_at: '2026-05-21T10:00', scheduled_at: '2026-05-21T11:00' },
          { review_number: 1, label: '睡前', completed: true, completed_at: '2026-05-21T22:00', scheduled_at: '2026-05-21T22:00' },
          { review_number: 2, label: '1天', completed: true, completed_at: '2026-05-22T10:00', scheduled_at: '2026-05-22T10:00' },
          { review_number: 3, label: '2天', completed: false, completed_at: null, scheduled_at: '2026-05-24T10:00' },
          { review_number: 4, label: '4天', completed: false, completed_at: null, scheduled_at: null },
          { review_number: 5, label: '7天', completed: false, completed_at: null, scheduled_at: null },
          { review_number: 6, label: '15天', completed: false, completed_at: null, scheduled_at: null },
          { review_number: 7, label: '30天', completed: false, completed_at: null, scheduled_at: null },
          { review_number: 8, label: '60天', completed: false, completed_at: null, scheduled_at: null },
        ],
      },
    })
    mocks.getReviewSessionProgressApi.mockResolvedValue({ progress: null })
    mocks.clearReviewSessionProgressApi.mockResolvedValue({ ok: true })
    mocks.submitReviewSessionApi.mockResolvedValue({ ok: true, next_id: null, score: 5 })
    mocks.getPalaceEditorApi.mockResolvedValue({
      editor_doc: { root: { data: { text: 'Root' }, children: [] } },
      editor_config: {},
      editor_local_config: {},
      lang: 'zh',
    })
  })

  it('submits completion without navigating to the next review session', async () => {
    render(<ReviewSession />)

    fireEvent.click(await screen.findByRole('button', { name: '完成' }))

    const confirmButton = await screen.findByRole('button', { name: /默认.*标记第 4 次完成/ })
    fireEvent.click(confirmButton)

    await waitFor(() => expect(mocks.submitReviewSessionApi).toHaveBeenCalledTimes(1))
    expect(mocks.submitReviewSessionApi).toHaveBeenCalledWith(309, {
      chapter_id: undefined,
      duration_seconds: 12,
      completion_mode: 'manual_complete',
      revealed_remaining: true,
      red_marked_count: 1,
      target_review_number: 3,
    })
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
})
