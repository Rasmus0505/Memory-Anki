import { beforeEach, describe, expect, it, vi } from 'vitest'
import { request } from '@/shared/api/http'
import {
  SESSION_START_TIMEOUT_MS,
  closeUnitReviewEncounterApi,
  startFreestyleUnitReviewSessionApi,
} from './unitReviewApi'

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

  it('caps the session-start POST and keeps it out of the mutation queue', async () => {
    await startFreestyleUnitReviewSessionApi({ id: 'unit-1', revision: 3 }, 'round-1', 'encounter-1')

    expect(requestMock).toHaveBeenCalledWith(
      '/review/units/unit-1/sessions',
      expect.objectContaining({
        method: 'POST',
        timeoutMs: SESSION_START_TIMEOUT_MS,
        persistence: false,
        body: expect.stringContaining('"encounter_id":"encounter-1"'),
      }),
    )
  })
})
