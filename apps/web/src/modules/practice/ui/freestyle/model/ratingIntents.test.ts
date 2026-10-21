import { describe, expect, it, vi } from 'vitest'
import {
  RatingSaveStore,
  type RatingIntentRecord,
  type RatingPostResponse,
  type RatingSaveDeps,
  type RatingTarget,
} from './ratingSaveStore'

const target: RatingTarget = { encounterId: 'enc-1', unitId: 'unit-1', sessionId: 'session-1', unitRevision: 3 }

function ackResponse(operationId: string, rating: 1 | 2 | 3 | 4, unitId = 'unit-1'): RatingPostResponse {
  return {
    item: {
      operation_id: operationId,
      rating,
      unit: { id: unitId, revision: 3 },
      encounter: { id: 'enc-1', status: 'open', selected_rating: rating, passed: rating >= 3 },
    },
    round: null,
  } as unknown as RatingPostResponse
}

function harness(extra: Partial<RatingSaveDeps> = {}) {
  const posts: Array<{ payload: Parameters<RatingSaveDeps['post']>[1]; resolve: (r: RatingPostResponse) => void; reject: (e: unknown) => void }> = []
  let ids = 0
  const store = new RatingSaveStore({
    post: (_roundId, payload) => new Promise<RatingPostResponse>((resolve, reject) => {
      posts.push({ payload, resolve, reject })
    }),
    undo: vi.fn(),
    newOperationId: () => `op-${++ids}`,
    setTimer: () => 0,
    clearTimer: () => undefined,
    timeoutMs: 60_000,
    ...extra,
  })
  return { store, posts }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function rate(store: RatingSaveStore, cardId = 'card-1', rating: 1 | 2 | 3 | 4 = 3) {
  return store.submit({
    roundId: 'round-1',
    cardId,
    occurrenceId: '',
    rating,
    planVersion: 1,
    target: { ...target, encounterId: `enc-${cardId}` },
  })
}

describe('rating intents in the store', () => {
  it('persists a failed save with its operation id, grade, failure and request', async () => {
    const persistIntent = vi.fn<(roundId: string, cardId: string, intent: RatingIntentRecord) => Promise<unknown>>(
      () => Promise.resolve(null),
    )
    const { store, posts } = harness({ persistIntent })
    rate(store, 'card-1', 3)
    posts[0].reject(new Error('network down'))
    await flush()

    expect(persistIntent).toHaveBeenCalledWith('round-1', 'card-1', expect.objectContaining({
      operation_id: 'op-1',
      rating: 3,
      failure: 'network',
      payload: expect.objectContaining({
        card_id: 'card-1',
        encounter_id: 'enc-card-1',
        study_session_id: 'session-1',
        unit_id: 'unit-1',
        unit_revision: 3,
      }),
    }))
  })

  it('clears the intent for the operation that finally lands, and retries under the same operation id', async () => {
    const persistIntent = vi.fn(() => Promise.resolve(null))
    const clearIntent = vi.fn(() => Promise.resolve(null))
    const { store, posts } = harness({ persistIntent, clearIntent })
    rate(store, 'card-1', 3)
    posts[0].reject(new Error('network down'))
    await flush()

    store.retryFailed('round-1')
    expect(posts[1].payload.operation_id).toBe('op-1')
    posts[1].resolve(ackResponse('op-1', 3))
    await flush()

    expect(clearIntent).toHaveBeenCalledWith('round-1', 'card-1', 'op-1')
    expect(store.getEntry('round-1', 'card-1')?.status).toBe('saved')
  })

  it('hydrates a server intent as retryable 未保存 and resends it with its original operation id and target', () => {
    const { store, posts } = harness()
    store.hydrateIntents('round-1', [{
      card_id: 'card-9',
      operation_id: 'op-server',
      rating: 2,
      failure: 'timeout',
      payload: {
        encounter_id: 'enc-9',
        study_session_id: 'session-9',
        unit_id: 'unit-9',
        unit_revision: 4,
        expected_version: 5,
        occurrence_id: '',
      },
    }], () => null)

    expect(store.getEntry('round-1', 'card-9')).toMatchObject({ status: 'failed', rating: 2, operationId: 'op-server' })
    expect(store.failedCount('round-1')).toBe(1)

    store.retryFailed('round-1')
    expect(posts).toHaveLength(1)
    expect(posts[0].payload).toMatchObject({ operation_id: 'op-server', rating: 2, unit_id: 'unit-9', encounter_id: 'enc-9' })
  })

  it('does not overwrite a save that is still on the wire', () => {
    const { store } = harness()
    rate(store, 'card-1', 3)
    store.hydrateIntents('round-1', [{
      card_id: 'card-1',
      operation_id: 'op-other-device',
      rating: 1,
      failure: 'network',
      payload: {},
    }], () => null)

    expect(store.getEntry('round-1', 'card-1')).toMatchObject({ status: 'saving', rating: 3 })
  })

  it('drops a failure it knew the server held once the server no longer lists it', async () => {
    const persistIntent = vi.fn(() => Promise.resolve(null))
    const { store, posts } = harness({ persistIntent })
    rate(store, 'card-1', 3)
    posts[0].reject(new Error('network down'))
    await flush()
    expect(store.getEntry('round-1', 'card-1')?.status).toBe('failed')

    store.hydrateIntents('round-1', [], () => null)
    expect(store.getEntry('round-1', 'card-1')).toBeNull()
    expect(store.failedCount('round-1')).toBe(0)
  })

  it('keeps a failure this browser has not yet uploaded when the server list is empty', () => {
    const { store } = harness()
    store.hydrateIntents('round-1', [{
      card_id: 'card-2',
      operation_id: 'op-local',
      rating: 4,
      failure: 'network',
      payload: {},
      confirmed: false,
    }], () => null)
    store.hydrateIntents('round-1', [], () => null)

    expect(store.getEntry('round-1', 'card-2')).toMatchObject({ status: 'failed', operationId: 'op-local' })
  })
})
