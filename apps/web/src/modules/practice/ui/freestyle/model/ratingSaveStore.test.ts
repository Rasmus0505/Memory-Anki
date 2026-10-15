import { describe, expect, it, vi } from 'vitest'
import type { FreestyleRoundStatePayload } from '@/shared/api/contracts'
import {
  classifyRatingResponse,
  RatingSaveStore,
  type RatingPostResponse,
  type RatingSaveDeps,
  type RatingSaveEvent,
  type RatingTarget,
  type UndoneUnitResult,
} from './ratingSaveStore'
import { applyRatingSaveEvent, type RatingLedgerHandlers } from './ratingSaveLedger'

const target: RatingTarget = { encounterId: 'enc-1', unitId: 'unit-1', sessionId: 'session-1', unitRevision: 3 }

function round(overrides: Partial<FreestyleRoundStatePayload> = {}) {
  return {
    round_id: 'round-1',
    version: 2,
    plan_version: 2,
    conflict: false,
    duplicate: false,
    plan: { completed_ids: [] },
    ...overrides,
  } as unknown as FreestyleRoundStatePayload
}

function item(rating: 1 | 2 | 3 | 4, operationId: string, unitId = 'unit-1') {
  return {
    operation_id: operationId,
    study_session_id: 'session-1',
    encounter_id: 'enc-1',
    amended: false,
    unit: { id: unitId, revision: 3 },
    passed: rating >= 3,
    retry_after_cards: rating >= 3 ? 0 : 3,
    rating,
    rating_label: '',
    session_status: rating >= 3 ? 'passed' : 'retry',
    encounter: {
      id: 'enc-1',
      round_id: 'round-1',
      status: 'open',
      selected_rating: rating,
      passed: rating >= 3,
      retry_after_cards: rating >= 3 ? 0 : 3,
      effective_operation_id: operationId,
    },
  }
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A store whose network and clock are driven by the test. */
function harness() {
  const posts: Array<{ roundId: string; payload: Parameters<RatingSaveDeps['post']>[1]; reply: Deferred<RatingPostResponse> }> = []
  const timers: Array<{ callback: () => void; cleared: boolean }> = []
  let ids = 0
  const undo = vi.fn<RatingSaveDeps['undo']>()
  const close = vi.fn<NonNullable<RatingSaveDeps['close']>>(() => Promise.resolve(null))
  const store = new RatingSaveStore({
    post: (roundId, payload) => {
      const reply = deferred<RatingPostResponse>()
      posts.push({ roundId, payload, reply })
      return reply.promise
    },
    undo,
    close,
    newOperationId: () => `op-${++ids}`,
    setTimer: (callback) => {
      const timer = { callback, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (handle) => {
      ;(handle as { cleared: boolean }).cleared = true
    },
    timeoutMs: 1_000,
  })
  const events: RatingSaveEvent[] = []
  store.listen((event) => events.push(event))
  const fireTimeouts = () => timers.filter((timer) => !timer.cleared).forEach((timer) => {
    timer.cleared = true
    timer.callback()
  })
  return { store, posts, events, undo, close, fireTimeouts }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function rate(store: RatingSaveStore, cardId = 'card-1', rating: 1 | 2 | 3 | 4 = 3, extra: Record<string, unknown> = {}) {
  return store.submit({
    roundId: 'round-1',
    cardId,
    occurrenceId: '',
    rating,
    planVersion: 1,
    target: { ...target, encounterId: `enc-${cardId}` },
    ...extra,
  })
}

describe('classifyRatingResponse', () => {
  it('treats item:null with a round as a replayed success, not a failure', () => {
    expect(classifyRatingResponse({ item: null, round: round({ duplicate: true }) }, target).kind).toBe('replayed')
  })

  it('reports a conflict before anything else, even with an item', () => {
    const verdict = classifyRatingResponse({ item: item(3, 'x'), round: round({ conflict: true, plan_version: 7 }) }, target)
    expect(verdict).toMatchObject({ kind: 'conflict', version: 7 })
  })

  it('never adopts an item for another unit', () => {
    expect(classifyRatingResponse({ item: item(3, 'x', 'other'), round: round() }, target))
      .toEqual({ kind: 'failed', failure: 'identity' })
  })

  it('fails when the server gave neither item nor round', () => {
    expect(classifyRatingResponse({ item: null, round: null }, target)).toEqual({ kind: 'failed', failure: 'no_result' })
  })
})

describe('RatingSaveStore', () => {
  it('goes saving → saved only on acknowledgement', async () => {
    const { store, posts, events } = harness()
    expect(rate(store).status).toBe('saving')
    expect(posts).toHaveLength(1)
    expect(posts[0].payload).toMatchObject({ card_id: 'card-1', rating: 3, expected_version: 1, encounter_id: 'enc-card-1' })
    posts[0].reply.resolve({ item: item(3, 'op-1'), round: round() })
    await flush()
    expect(store.getEntry('round-1', 'card-1')).toMatchObject({ status: 'saved', ackedRating: 3, ackedOperationId: 'op-1' })
    expect(events.find((event) => event.type === 'acked')).toMatchObject({ current: true, replayed: false })
  })

  it('marks a request with no answer as failed on timeout and frees the lane for the next tap', async () => {
    const { store, posts, fireTimeouts, events } = harness()
    rate(store, 'card-1', 3)
    rate(store, 'card-1', 4)
    expect(posts).toHaveLength(1)
    fireTimeouts()
    // The newer tap owns the entry, so the timed-out one is no longer reported as failed;
    // the lane is free and the newer tap is on the wire.
    await flush()
    expect(posts).toHaveLength(2)
    expect(posts[1].payload.rating).toBe(4)
    expect(events.some((event) => event.type === 'failed')).toBe(false)
  })

  it('shows a timeout as 未保存 and upgrades it when the late answer succeeds', async () => {
    const { store, posts, fireTimeouts } = harness()
    rate(store)
    fireTimeouts()
    expect(store.getEntry('round-1', 'card-1')).toMatchObject({ status: 'failed', failure: 'timeout' })
    expect(store.failedCount('round-1')).toBe(1)
    expect(store.isBusy('round-1', 'card-1')).toBe(false)
    posts[0].reply.resolve({ item: item(3, 'op-1'), round: round() })
    await flush()
    expect(store.getEntry('round-1', 'card-1')).toMatchObject({ status: 'saved', ackedRating: 3 })
    expect(store.failedCount('round-1')).toBe(0)
  })

  it('retries a failed save with the same operation id', async () => {
    const { store, posts } = harness()
    rate(store)
    posts[0].reply.reject(new Error('503'))
    await flush()
    expect(store.getEntry('round-1', 'card-1')).toMatchObject({ status: 'failed', failure: 'network' })
    rate(store)
    expect(posts).toHaveLength(2)
    expect(posts[1].payload.operation_id).toBe(posts[0].payload.operation_id)
    posts[1].reply.resolve({ item: null, round: round({ duplicate: true }) })
    await flush()
    expect(store.getEntry('round-1', 'card-1')?.status).toBe('saved')
  })

  it('retries every 未保存 item of a round from the HUD', async () => {
    const { store, posts } = harness()
    rate(store, 'a')
    rate(store, 'b')
    posts[0].reply.reject(new Error('down'))
    posts[1].reply.reject(new Error('down'))
    await flush()
    expect(store.failedCount('round-1')).toBe(2)
    expect(store.retryFailed('round-1')).toBe(2)
    expect(posts.slice(2).map((post) => post.payload.operation_id)).toEqual(
      posts.slice(0, 2).map((post) => post.payload.operation_id),
    )
    expect(store.failedCount('round-1')).toBe(0)
  })

  it('treats a replayed operation as saved', async () => {
    const { store, posts, events } = harness()
    rate(store)
    posts[0].reply.resolve({ item: null, round: round({ duplicate: true, plan_version: 4 }) })
    await flush()
    expect(store.getEntry('round-1', 'card-1')).toMatchObject({ status: 'saved', ackedRating: 3, ackedOperationId: 'op-1' })
    expect(events.find((event) => event.type === 'acked')).toMatchObject({ replayed: true, item: null })
  })

  it('adopts a conflict reply and re-sends the same operation once against the new version', async () => {
    const { store, posts, events } = harness()
    rate(store)
    posts[0].reply.resolve({ item: item(3, 'op-1'), round: round({ conflict: true, plan_version: 9 }) })
    await flush()
    expect(events[0]).toMatchObject({ type: 'round' })
    expect(store.getEntry('round-1', 'card-1')?.status).toBe('saving')
    expect(posts).toHaveLength(2)
    expect(posts[1].payload).toMatchObject({ operation_id: 'op-1', expected_version: 9 })
    posts[1].reply.resolve({ item: item(3, 'op-1'), round: round({ plan_version: 10 }) })
    await flush()
    expect(store.getEntry('round-1', 'card-1')?.status).toBe('saved')
  })

  it('reports 未保存 when the re-sent operation conflicts again', async () => {
    const { store, posts } = harness()
    rate(store)
    posts[0].reply.resolve({ item: null, round: round({ conflict: true, plan_version: 9 }) })
    await flush()
    posts[1].reply.resolve({ item: null, round: round({ conflict: true, plan_version: 10 }) })
    await flush()
    expect(posts).toHaveLength(2)
    expect(store.getEntry('round-1', 'card-1')).toMatchObject({ status: 'failed', failure: 'conflict' })
  })

  it('keeps one lane per card: other cards save in parallel and do not disturb each other', async () => {
    const { store, posts } = harness()
    rate(store, 'a', 3)
    rate(store, 'b', 1)
    expect(posts.map((post) => post.payload.card_id)).toEqual(['a', 'b'])
    posts[1].reply.resolve({ item: item(1, 'op-2'), round: round() })
    await flush()
    expect(store.getEntry('round-1', 'b')?.status).toBe('saved')
    expect(store.getEntry('round-1', 'a')?.status).toBe('saving')
  })

  it('opens a glance first when the card has none, then rates with that identity', async () => {
    const { store, posts } = harness()
    const prepare = vi.fn(async () => ({ ...target, sessionId: 'fresh-session' }))
    store.submit({ roundId: 'round-1', cardId: 'card-1', occurrenceId: '', rating: 2, planVersion: 1, prepare })
    await flush()
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(posts[0].payload).toMatchObject({ study_session_id: 'fresh-session', encounter_id: 'enc-1' })
  })

  it('closes a background glance after the acknowledgement', async () => {
    const { store, posts, close } = harness()
    rate(store, 'card-1', 3, { closeAfterAck: true })
    posts[0].reply.resolve({ item: item(3, 'op-1'), round: round() })
    await flush()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('runs a clear requested during the save once the save is acknowledged', async () => {
    const { store, posts, undo, events } = harness()
    undo.mockResolvedValue({
      operation_id: 'undo-1',
      unit: { id: 'unit-1', revision: 3 },
      session_status: 'pending',
      encounter: { id: 'enc-1', selected_rating: null, passed: null, retry_after_cards: 0, effective_operation_id: null },
    } as unknown as UndoneUnitResult)
    rate(store)
    expect(store.requestUndo({ roundId: 'round-1', cardId: 'card-1', clearAll: true })).toBe(true)
    expect(store.getEntry('round-1', 'card-1')).toMatchObject({ status: 'saving', pendingKind: 'undo' })
    posts[0].reply.resolve({ item: item(3, 'op-1'), round: round() })
    await flush()
    expect(undo).toHaveBeenCalledWith('op-1', 'round-1')
    expect(store.getEntry('round-1', 'card-1')).toMatchObject({ status: 'saved', rating: null, ackedRating: null })
    expect(events.map((event) => event.type)).toEqual(['acked', 'undone'])
  })
})

describe('applyRatingSaveEvent', () => {
  function handlers(overrides: Partial<RatingLedgerHandlers> = {}): RatingLedgerHandlers {
    return {
      roundId: 'round-1',
      previousEncounter: () => undefined,
      adoptRound: vi.fn(),
      encounterChange: vi.fn(),
      branchComplete: vi.fn(),
      ratingSettled: vi.fn(),
      saveFailed: vi.fn(),
      staleDrop: vi.fn(),
      ...overrides,
    }
  }

  async function ackedEvent(roundId = 'round-1', cardId = 'card-1') {
    const { store, posts, events } = harness()
    store.submit({ roundId, cardId, occurrenceId: '', rating: 2, planVersion: 1, target })
    posts[0].reply.resolve({ item: item(2, 'op-1'), round: round({ round_id: roundId, plan_version: 5 }) })
    await flush()
    return events.find((event) => event.type === 'acked')!
  }

  it('adopts the acknowledged plan, then updates the encounter and completion', async () => {
    const ledger = handlers()
    applyRatingSaveEvent(await ackedEvent(), ledger)
    expect(ledger.adoptRound).toHaveBeenCalledWith(expect.objectContaining({ plan_version: 5 }))
    expect(ledger.encounterChange).toHaveBeenCalledWith('card-1', expect.objectContaining({
      encounterId: 'enc-1', selectedRating: 2, passed: false, retryAfterCards: 3, sessionId: 'session-1',
    }))
    expect(ledger.branchComplete).toHaveBeenCalledWith('card-1', { restudy: true, rating: 2, retryAfterCards: 3 })
    expect(ledger.ratingSettled).toHaveBeenCalledWith('card-1', false, 2, expect.objectContaining({ planVersion: 5 }))
  })

  it('ignores an acknowledgement from another round: no plan, no ledger, no viewport', async () => {
    const ledger = handlers()
    applyRatingSaveEvent(await ackedEvent('round-old'), ledger)
    expect(ledger.adoptRound).not.toHaveBeenCalled()
    expect(ledger.encounterChange).not.toHaveBeenCalled()
    expect(ledger.branchComplete).not.toHaveBeenCalled()
  })

  it('does not re-complete a card whose ledger already holds that score', async () => {
    const ledger = handlers({
      previousEncounter: () => ({
        encounterId: 'enc-1', unitRevision: 3, status: 'open', sessionId: 'session-1',
        selectedRating: 2, passed: false, retryAfterCards: 3,
      }),
    })
    applyRatingSaveEvent(await ackedEvent(), ledger)
    expect(ledger.branchComplete).not.toHaveBeenCalled()
    expect(ledger.encounterChange).toHaveBeenCalled()
  })

  it('reports only the current failure, and drops a stale card', () => {
    const ledger = handlers()
    const job = { key: 'k', roundId: 'round-1', cardId: 'card-1', occurrenceId: '', rating: 3 as const, planVersion: 1, operationId: 'op', sequence: 1 }
    applyRatingSaveEvent({ type: 'failed', roundId: 'round-1', cardId: 'card-1', job, failure: 'network', error: new Error('x'), current: false }, ledger)
    expect(ledger.saveFailed).not.toHaveBeenCalled()
    applyRatingSaveEvent({ type: 'failed', roundId: 'round-1', cardId: 'card-1', job, failure: 'stale', error: new Error('not due'), current: true }, ledger)
    expect(ledger.staleDrop).toHaveBeenCalledWith('card-1', expect.any(Error))
    expect(ledger.saveFailed).toHaveBeenCalledTimes(1)
  })
})
