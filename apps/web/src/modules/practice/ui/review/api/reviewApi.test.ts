import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitReviewSessionApi } from './reviewApi'
import { APP_EVENT_NAMES, onAppEvent } from '@/shared/events/appEvents'

const { invalidatePalaceCatalogCacheMock, requestMock } = vi.hoisted(() => ({
  invalidatePalaceCatalogCacheMock: vi.fn(),
  requestMock: vi.fn(),
}))

vi.mock('@/shared/api/http', () => ({
  request: requestMock,
}))

vi.mock('@/modules/content/domain/palace-entity/api', () => ({
  invalidatePalaceCatalogCache: invalidatePalaceCatalogCacheMock,
}))

describe('reviewApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates palace catalog state after a successful review submission', async () => {
    requestMock.mockResolvedValue({
      ok: true,
      next_id: null,
      score: 5,
      review_log_id: 8,
      palace_id: 9,
      chapter_id: 10,
      duration_seconds: 75,
      rated_node_count: 4,
      scope_node_count: 9,
      mastery_percent: 60,
      rating_counts: { 忘记: 0, 困难: 1, 记得: 3, 轻松: 0 },
      next_review_at: '2026-07-15T10:00:00',
      mastered: false,

    })
    const stateChanged = vi.fn()
    const unsubscribe = onAppEvent(APP_EVENT_NAMES.reviewStateChanged, stateChanged)

    await submitReviewSessionApi(42, {
      completion_mode: 'manual_complete',

    }, { mutationId: 'stable-review-operation' })

    expect(requestMock).toHaveBeenCalledWith('/review/session/42/submit', {
      method: 'POST',
      headers: { 'X-Memory-Anki-Mutation-ID': 'stable-review-operation' },
      body: JSON.stringify({
        completion_mode: 'manual_complete',

      }),
      persistence: {
        resourceKey: 'review-submit:42',
        description: 'Submit review session',
        replayMode: 'auto',
      },
    })
    expect(invalidatePalaceCatalogCacheMock).toHaveBeenCalledTimes(1)
    expect(stateChanged).toHaveBeenCalledWith(expect.objectContaining({
      palaceId: 9,
      chapterId: 10,
      completedStageCount: 4,
      totalStageCount: 9,
    }), expect.any(CustomEvent))
    unsubscribe()
  })
})
