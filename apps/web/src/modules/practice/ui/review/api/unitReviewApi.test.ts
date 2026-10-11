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

  it('sends the close operation identity and never queues it', async () => {
    await closeUnitReviewEncounterApi('session-1', 'unit-1', 'encounter-1', 'operation-1')

    expect(requestMock).toHaveBeenCalledWith(
      '/review/session/session-1/units/unit-1/encounters/encounter-1/close',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ operation_id: 'operation-1' }),
        persistence: false,
      }),
    )
  })

  it('sends stable occurrence and attempt identity before loading rating previews', async () => {
    await startFreestyleUnitReviewSessionApi(
      { id: 'unit-1', revision: 3 }, 'round-1', 'encounter-retry-2',
      { cardId: 'retry-slot', occurrenceId: 'retry-slot', retryAttempt: 2 },
    )
    const payload = JSON.parse(String(requestMock.mock.calls[0][1]?.body))
    expect(payload).toMatchObject({
      card_id: 'retry-slot', occurrence_id: 'retry-slot', retry_attempt: 2,
      encounter_id: 'encounter-retry-2',
    })
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
