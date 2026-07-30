import { beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from '@/shared/api/http'
import { closeUnitReviewEncounterApi } from './unitReviewApi'

vi.mock('@/shared/api/http', () => ({ request: vi.fn() }))
vi.mock('@/shared/events/appEvents', () => ({
  APP_EVENT_NAMES: {
    palaceCatalogInvalidated: 'palaceCatalogInvalidated',
    reviewStateChanged: 'reviewStateChanged',
  },
  emitAppEvent: vi.fn(),
}))

const requestMock = vi.mocked(request)

describe('unit review API', () => {
  beforeEach(() => {
    requestMock.mockReset()
    requestMock.mockResolvedValue({ item: {} })
  })

  it('persists client-observed foreground seconds with the close operation identity', async () => {
    await closeUnitReviewEncounterApi('session-1', 'unit-1', 'encounter-1', 'operation-1', 8.6)

    expect(requestMock).toHaveBeenCalledWith(
      '/review/session/session-1/units/unit-1/encounters/encounter-1/close',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ operation_id: 'operation-1', effective_seconds: 9 }),
        persistence: expect.objectContaining({
          resourceKey: 'review-unit-encounter-close:operation-1',
        }),
      }),
    )
  })
})
