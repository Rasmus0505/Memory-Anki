import { beforeEach, describe, expect, it, vi } from 'vitest'
import { submitReviewSessionApi } from './reviewApi'

const { invalidatePalaceCatalogCacheMock, requestMock } = vi.hoisted(() => ({
  invalidatePalaceCatalogCacheMock: vi.fn(),
  requestMock: vi.fn(),
}))

vi.mock('@/shared/api/http', () => ({
  request: requestMock,
}))

vi.mock('@/entities/palace/api', () => ({
  invalidatePalaceCatalogCache: invalidatePalaceCatalogCacheMock,
}))

describe('reviewApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates palace catalog state after a successful review submission', async () => {
    requestMock.mockResolvedValue({ ok: true, next_id: null, score: 5 })

    await submitReviewSessionApi(42, {
      completion_mode: 'manual_complete',
      target_review_number: 3,
    })

    expect(requestMock).toHaveBeenCalledWith('/review/session/42/submit', {
      method: 'POST',
      body: JSON.stringify({
        completion_mode: 'manual_complete',
        target_review_number: 3,
      }),
      persistence: {
        resourceKey: 'review-submit:42',
        description: 'Submit review session',
        replayMode: 'auto',
      },
    })
    expect(invalidatePalaceCatalogCacheMock).toHaveBeenCalledTimes(1)
  })
})
