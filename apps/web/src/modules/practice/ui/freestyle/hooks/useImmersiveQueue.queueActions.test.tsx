import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { FreestyleCard, FreestyleRoundStatePayload } from '@/shared/api/contracts'
import { createRoundPlan, saveQueueState, readFreestyleFeedConfig } from '@/modules/practice/public'
import { DEFAULT_QUEUE_STATE } from '@/modules/practice/domain/queueState'
import { useImmersiveQueue } from './useImmersiveQueue'

const api = vi.hoisted(() => ({ action: vi.fn(), read: vi.fn(), active: vi.fn(), build: vi.fn() }))
vi.mock('@/modules/practice/ui/freestyle/api', () => ({
  applyFreestyleRoundActionApi: api.action,
  getFreestyleRoundApi: api.read,
  getActiveFreestyleRoundApi: api.read,
  getOrCreateFreestyleRoundApi: api.active,
  buildFreestyleQueueApi: api.build,
  appendFreestyleBedtimeApi: vi.fn(), dropFreestyleOverlayQuizPalacesApi: vi.fn(),
  rateFreestyleBedtimeCardApi: vi.fn(), startFreestyleRoundApi: vi.fn(),
}))
vi.mock('@/shared/preferences/clientPreferences', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/shared/preferences/clientPreferences')>(),
  hasLoadedClientPreferences: () => true,
}))
vi.mock('@/shared/study-text/studyTextLibrary', () => ({ ensureStudyTextLibrary: async () => {} }))

const cards = ['a', 'b', 'c'].map((id) => ({
  id, type: 'mindmap_branch', content_type: 'mindmap_branch', palace_id: 1,
  palace_title: '宫殿', unit_id: id, unit_revision: 1, anchor_uid: id,
  context_path: [{ uid: id, text: id }], node_uids: [id], node_count: 1,
})) as FreestyleCard[]

function round(version = 1, order = ['a', 'b', 'c'], excluded: string[] = []): FreestyleRoundStatePayload {
  return {
    round_id: 'queue-test', version, plan_version: version, current_card_id: 'a',
    config: readFreestyleFeedConfig(), workspace: 'primary', conflict: false,
    plan: {
      original_cards: cards.map((card) => ({ card_id: card.id, unit_id: card.id,
        kind: 'mindmap_branch', palace_id: 1, unit_revision: 1, label: card.id })),
      presented_ids: order, current_card_id: 'a', current_index: order.indexOf('a'),
      completed_ids: [], excluded_ids: excluded, compressed_ids: [],
      encounters: {}, occurrences: [], bedtime_ratings: {},
    },
  } as FreestyleRoundStatePayload
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/freestyle']}>{children}</MemoryRouter>
async function mount(expectedCardCount = 3) {
  const hook = renderHook(() => useImmersiveQueue(), { wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  await waitFor(() => expect(hook.result.current.cards.filter((card) => card.type !== 'review_hint')).toHaveLength(expectedCardCount))
  // Flush the cold-open cursor before controlling the queue-action promises.
  // Otherwise its 200ms timer can consume a deferred reorder/restore response.
  api.action.mockResolvedValueOnce(round(1))
  await act(async () => { window.dispatchEvent(new Event('pagehide')) })
  api.action.mockReset().mockResolvedValue(round(2))
  return hook
}
const feedIds = (hook: Awaited<ReturnType<typeof mount>>) => hook.result.current.cards.filter((card) => card.type !== 'review_hint').map((card) => card.id)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  const config = readFreestyleFeedConfig()
  saveQueueState({ ...DEFAULT_QUEUE_STATE, roundId: 'queue-test', currentCardId: 'a',
    roundPlan: createRoundPlan('queue-test', cards, config) })
  api.read.mockResolvedValue(round())
  api.active.mockResolvedValue(round())
  api.build.mockImplementation(async (body) => ({ operation_id: body.operation_id, cards, phase_stats: {} }))
  api.action.mockResolvedValue(round(2))
})
afterEach(cleanup)

describe('useImmersiveQueue queue edits', () => {
  it('serializes rapid reorders and retries conflict without letting old intent win', async () => {
    const hook = await mount()
    const first = deferred<FreestyleRoundStatePayload>()
    api.action.mockReset().mockResolvedValue(round(4, ['b', 'c', 'a']))
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ ...round(3), conflict: true })
      .mockResolvedValueOnce(round(4, ['b', 'c', 'a']))
    act(() => {
      hook.result.current.reorderPlan(['c', 'a', 'b'])
      hook.result.current.reorderPlan(['b', 'c', 'a'])
    })
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1))
    expect(feedIds(hook)).toEqual(['b', 'c', 'a'])
    expect(hook.result.current.cards[hook.result.current.currentIndex]?.id).toBe('a')
    await act(async () => first.resolve(round(2, ['c', 'a', 'b'])))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(3))
    const bodies = api.action.mock.calls.map((call) => call[1])
    expect(bodies.map((body) => body.expected_version)).toEqual([1, 2, 3])
    expect(bodies[1].operation_id).toBe(bodies[2].operation_id)
    expect(bodies[2].order_ids).toEqual(['b', 'c', 'a'])
    expect(feedIds(hook)).toEqual(['b', 'c', 'a'])
  })

  it('keeps the newest A → B → A reorder pending after the first A ACK', async () => {
    const hook = await mount()
    const first = deferred<FreestyleRoundStatePayload>()
    const middle = deferred<FreestyleRoundStatePayload>()
    const last = deferred<FreestyleRoundStatePayload>()
    api.action.mockReset()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => middle.promise)
      .mockImplementationOnce(() => last.promise)
    const orderA = ['c', 'a', 'b']
    const orderB = ['b', 'c', 'a']
    act(() => {
      hook.result.current.reorderPlan(orderA)
      hook.result.current.reorderPlan(orderB)
      hook.result.current.reorderPlan(orderA)
    })
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1))
    await act(async () => first.resolve(round(2, orderA)))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(2))
    await act(async () => middle.resolve(round(3, orderB)))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(3))
    const operations = api.action.mock.calls.map((call) => call[1].operation_id)
    expect(new Set(operations).size).toBe(3)
    api.read.mockResolvedValue(round(3, orderB))
    await act(async () => hook.result.current.hydrateLiveRound({
      roundId: 'queue-test', planVersion: 3, queueCardIds: ['a', 'b', 'c'],
    }))
    expect(feedIds(hook)).toEqual(orderA)
    expect(hook.result.current.queueState.roundPlan?.orderIds).toEqual(orderA)
    await act(async () => last.resolve(round(4, orderA)))
    // Its own ACK releases the overlay, so a later peer reorder can win.
    api.read.mockResolvedValue(round(5, orderB))
    await act(async () => hook.result.current.hydrateLiveRound({
      roundId: 'queue-test', planVersion: 5, queueCardIds: ['a', 'b', 'c'],
    }))
    expect(feedIds(hook)).toEqual(orderB)
  })

  it('keeps the newest restore pending through restore → exclude → restore ACKs', async () => {
    api.read.mockResolvedValue(round(1, ['a', 'b', 'c'], ['b']))
    api.active.mockResolvedValue(round(1, ['a', 'b', 'c'], ['b']))
    const hook = await mount(2)
    const first = deferred<FreestyleRoundStatePayload>()
    const removed = deferred<FreestyleRoundStatePayload>()
    const last = deferred<FreestyleRoundStatePayload>()
    api.action.mockReset()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => removed.promise)
      .mockImplementationOnce(() => last.promise)
    act(() => {
      hook.result.current.restorePlanCards(['b'])
      hook.result.current.excludePlanCards(['b'])
      hook.result.current.restorePlanCards(['b'])
    })
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1))
    api.active.mockResolvedValue(round(2))
    await act(async () => first.resolve(round(2)))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(feedIds(hook)).toContain('b'))
    api.active.mockResolvedValue(round(3, ['a', 'b', 'c'], ['b']))
    await act(async () => removed.resolve(round(3, ['a', 'b', 'c'], ['b'])))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(3))
    expect(api.action.mock.calls.map((call) => call[1].action)).toEqual(['restore', 'exclude', 'restore'])
    expect(api.action.mock.calls[0][1].operation_id).not.toBe(api.action.mock.calls[2][1].operation_id)
    api.read.mockResolvedValue(round(3, ['a', 'b', 'c'], ['b']))
    await act(async () => hook.result.current.hydrateLiveRound({
      roundId: 'queue-test', planVersion: 3, queueCardIds: ['a', 'b', 'c'],
    }))
    expect(hook.result.current.queueState.hiddenIds).not.toContain('b')
    expect(hook.result.current.queueState.roundPlan?.cardsById.b?.status).not.toBe('excluded')
    expect(feedIds(hook)).toContain('b')
    api.active.mockResolvedValue(round(4))
    await act(async () => last.resolve(round(4)))
    await waitFor(() => expect(hook.result.current.planVersion).toBe(4))
  })

  it('acknowledges each restore before the rest of its batch finishes', async () => {
    api.read.mockResolvedValue(round(1, ['a', 'b', 'c'], ['b', 'c']))
    api.active.mockResolvedValue(round(1, ['a', 'b', 'c'], ['b', 'c']))
    const hook = await mount(1)
    const first = deferred<FreestyleRoundStatePayload>()
    const last = deferred<FreestyleRoundStatePayload>()
    api.action.mockReset()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => last.promise)
    act(() => hook.result.current.restorePlanCards(['b', 'c']))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1))
    await act(async () => first.resolve(round(2, ['a', 'b', 'c'], ['c'])))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(2))
    // A peer removes b after its restore succeeded; c's restore is still pending.
    api.read.mockResolvedValue(round(3, ['a', 'b', 'c'], ['b', 'c']))
    await act(async () => hook.result.current.hydrateLiveRound({
      roundId: 'queue-test', planVersion: 3, queueCardIds: ['a', 'b', 'c'],
    }))
    expect(hook.result.current.queueState.hiddenIds).toEqual(['b'])
    expect(feedIds(hook)).toEqual(['a', 'c'])
    api.active.mockResolvedValue(round(4, ['a', 'b', 'c'], ['b']))
    await act(async () => last.resolve(round(4, ['a', 'b', 'c'], ['b'])))
    await waitFor(() => expect(hook.result.current.planVersion).toBe(4))
  })

  it('preserves a reorder of restored cards while the restore request is pending', async () => {
    api.read.mockResolvedValue(round(1, ['a', 'b', 'c'], ['b']))
    api.active.mockResolvedValue(round(1, ['a', 'b', 'c'], ['b']))
    const hook = await mount(2)
    const restored = deferred<FreestyleRoundStatePayload>()
    const reordered = deferred<FreestyleRoundStatePayload>()
    api.action.mockReset()
      .mockImplementationOnce(() => restored.promise)
      .mockImplementationOnce(() => reordered.promise)
    act(() => {
      hook.result.current.restorePlanCards(['b'])
      hook.result.current.reorderPlan(['b', 'c', 'a'])
    })
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1))
    await act(async () => hook.result.current.hydrateLiveRound({
      roundId: 'queue-test', planVersion: 1, queueCardIds: ['a', 'b', 'c'],
    }))
    expect(feedIds(hook)).toEqual(['b', 'c', 'a'])
    expect(hook.result.current.queueState.roundPlan?.orderIds).toEqual(['b', 'c', 'a'])
    api.active.mockResolvedValue(round(2))
    await act(async () => restored.resolve(round(2)))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(2))
    await act(async () => reordered.resolve(round(3, ['b', 'c', 'a'])))
  })

  it('does not release another round exclusions with the old round restore overlay', async () => {
    const hook = await mount()
    const oldAck = deferred<FreestyleRoundStatePayload>()
    api.action.mockImplementationOnce(() => oldAck.promise)
    act(() => hook.result.current.restorePlanCards(['b']))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1))
    api.read.mockResolvedValue({ ...round(1, ['a', 'b', 'c'], ['b']), round_id: 'next-round' })
    await act(async () => hook.result.current.hydrateLiveRound({
      roundId: 'next-round', planVersion: 1, queueCardIds: ['a', 'b', 'c'],
    }))
    expect(hook.result.current.queueState.roundId).toBe('next-round')
    expect(hook.result.current.queueState.hiddenIds).toContain('b')
    expect(hook.result.current.queueState.roundPlan?.cardsById.b?.status).toBe('excluded')
    const newAck = deferred<FreestyleRoundStatePayload>()
    api.action.mockImplementationOnce(() => newAck.promise)
    act(() => hook.result.current.reorderPlan(['c', 'a', 'b']))
    await act(async () => oldAck.resolve(round(20)))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(2))
    expect(api.action.mock.calls[1][0]).toBe('next-round')
    expect(api.action.mock.calls[1][1].expected_version).toBe(1)
    expect(hook.result.current.planVersion).toBe(1)
    await act(async () => newAck.resolve({ ...round(2, ['c', 'a', 'b'], ['b']), round_id: 'next-round' }))
  })

  it('skips old queued actions and ignores their ACK after a round switch', async () => {
    const hook = await mount()
    const oldAck = deferred<FreestyleRoundStatePayload>()
    const newAck = deferred<FreestyleRoundStatePayload>()
    api.action.mockReset()
      .mockImplementationOnce(() => oldAck.promise)
      .mockImplementationOnce(() => newAck.promise)
    act(() => {
      hook.result.current.reorderPlan(['c', 'a', 'b'])
      hook.result.current.reorderPlan(['b', 'c', 'a'])
    })
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1))
    api.read.mockResolvedValue({ ...round(1), round_id: 'next-round' })
    await act(async () => hook.result.current.hydrateLiveRound({
      roundId: 'next-round', planVersion: 1, queueCardIds: ['a', 'b', 'c'],
    }))
    expect(feedIds(hook)).toEqual(['a', 'b', 'c'])
    // Equal order contents in a new round still belong to a different operation.
    act(() => hook.result.current.reorderPlan(['c', 'a', 'b']))
    await act(async () => oldAck.resolve(round(20, ['c', 'a', 'b'])))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(2))
    expect(api.action.mock.calls.map((call) => call[0])).toEqual(['queue-test', 'next-round'])
    expect(api.action.mock.calls[1][1].expected_version).toBe(1)
    await act(async () => hook.result.current.hydrateLiveRound({
      roundId: 'next-round', planVersion: 1, queueCardIds: ['a', 'b', 'c'],
    }))
    expect(feedIds(hook)).toEqual(['c', 'a', 'b'])
    expect(hook.result.current.planVersion).toBe(1)
    await act(async () => newAck.resolve({ ...round(2, ['c', 'a', 'b']), round_id: 'next-round' }))
  })

  it('records a successful restore even when another card in the batch fails', async () => {
    api.read.mockResolvedValue(round(1, ['a', 'b', 'c'], ['b', 'c']))
    api.active.mockResolvedValue(round(1, ['a', 'b', 'c'], ['b', 'c']))
    const hook = await mount(1)
    api.action.mockReset()
      .mockResolvedValueOnce(round(2, ['a', 'b', 'c'], ['c']))
      .mockRejectedValueOnce(new Error('offline'))
    // A newer server removal must win for b; c remains an unacknowledged draft.
    api.active.mockResolvedValue(round(3, ['a', 'b', 'c'], ['b', 'c']))
    act(() => hook.result.current.restorePlanCards(['b', 'c']))
    await waitFor(() => expect(hook.result.current.planVersion).toBe(3))
    expect(api.action).toHaveBeenCalledTimes(2)
    expect(hook.result.current.queueState.hiddenIds).toEqual(['b'])
    expect(feedIds(hook)).toEqual(['a', 'c'])
  })

  it('does not clear a restore overlay on a conflict and reuses its request id', async () => {
    api.read.mockResolvedValue(round(1, ['a', 'b', 'c'], ['b']))
    api.active.mockResolvedValue(round(1, ['a', 'b', 'c'], ['b']))
    const hook = await mount(2)
    const retried = deferred<FreestyleRoundStatePayload>()
    api.action.mockReset()
      .mockResolvedValueOnce({ ...round(2, ['a', 'b', 'c'], ['b']), conflict: true })
      .mockImplementationOnce(() => retried.promise)
    act(() => hook.result.current.restorePlanCards(['b']))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(2))
    expect(api.action.mock.calls[0][1].operation_id).toBe(api.action.mock.calls[1][1].operation_id)
    expect(api.action.mock.calls.map((call) => call[1].expected_version)).toEqual([1, 2])
    api.read.mockResolvedValue(round(3, ['a', 'b', 'c'], ['b']))
    await act(async () => hook.result.current.hydrateLiveRound({
      roundId: 'queue-test', planVersion: 3, queueCardIds: ['a', 'b', 'c'],
    }))
    expect(feedIds(hook)).toContain('b')
    api.active.mockResolvedValue(round(4))
    await act(async () => retried.resolve(round(4)))
    await waitFor(() => expect(hook.result.current.planVersion).toBe(4))
  })

  it('keeps a pending local order when hydration echoes the previous server order', async () => {
    const hook = await mount()
    const pending = deferred<FreestyleRoundStatePayload>()
    api.action.mockImplementationOnce(() => pending.promise)
    act(() => hook.result.current.reorderPlan(['c', 'b', 'a']))
    await act(async () => hook.result.current.hydrateLiveRound({
      roundId: 'queue-test', planVersion: 1, queueCardIds: ['a', 'b', 'c'],
    }))
    expect(feedIds(hook)).toEqual(['c', 'b', 'a'])
    expect(hook.result.current.queueState.roundPlan?.orderIds).toEqual(['c', 'b', 'a'])
    await act(async () => pending.resolve(round(2, ['c', 'b', 'a'])))
  })

  it('rejects hydration fetched before a reorder ACK even if the build finishes afterwards', async () => {
    const hook = await mount()
    const ack = deferred<FreestyleRoundStatePayload>()
    const build = deferred<{ operation_id: string; cards: FreestyleCard[] }>()
    api.action.mockImplementationOnce(() => ack.promise)
    act(() => hook.result.current.reorderPlan(['c', 'a', 'b']))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1))
    api.build.mockImplementationOnce(() => build.promise)
    let hydration!: Promise<void>
    act(() => { hydration = hook.result.current.hydrateLiveRound({
      roundId: 'queue-test', planVersion: 1, queueCardIds: ['a', 'b', 'c'],
    }) })
    await waitFor(() => expect(api.build).toHaveBeenCalledTimes(2))
    await act(async () => ack.resolve(round(2, ['c', 'a', 'b'])))
    await act(async () => {
      build.resolve({ operation_id: 'late-build', cards })
      await hydration
    })
    expect(feedIds(hook)).toEqual(['c', 'a', 'b'])
    expect(hook.result.current.planVersion).toBe(2)
  })

  it('saves a newer reorder even when the previous request fails', async () => {
    const hook = await mount()
    api.action.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(round(2, ['b', 'c', 'a']))
    act(() => {
      hook.result.current.reorderPlan(['c', 'a', 'b'])
      hook.result.current.reorderPlan(['b', 'c', 'a'])
    })
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(2))
    expect(feedIds(hook)).toEqual(['b', 'c', 'a'])
    expect(api.action.mock.calls[1][1].order_ids).toEqual(['b', 'c', 'a'])
  })

  it('does not re-hide a restored card when an exclude ACK or stale hydration lands late', async () => {
    const hook = await mount()
    const excluded = deferred<FreestyleRoundStatePayload>()
    api.action.mockReset().mockResolvedValue(round(3)).mockImplementationOnce(() => excluded.promise)
    api.active.mockResolvedValue(round(3))
    act(() => hook.result.current.excludePlanCards(['b']))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(1))
    act(() => hook.result.current.restorePlanCards(['b']))
    expect(hook.result.current.queueState.hiddenIds).not.toContain('b')
    await act(async () => excluded.resolve(round(2, ['a', 'b', 'c'], ['b'])))
    await waitFor(() => expect(api.action).toHaveBeenCalledTimes(2))
    api.active.mockResolvedValue(round(3))
    await waitFor(() => expect(feedIds(hook)).toContain('b'))
    expect(api.action.mock.calls.map((call) => call[1].action)).toEqual(['exclude', 'restore'])
    expect(hook.result.current.queueState.hiddenIds).not.toContain('b')
    expect(hook.result.current.queueState.roundPlan?.cardsById.b?.status).not.toBe('excluded')
    api.read.mockResolvedValue(round(2, ['a', 'b', 'c'], ['b']))
    await act(async () => hook.result.current.hydrateLiveRound({
      roundId: 'queue-test', planVersion: 2, queueCardIds: ['a', 'b', 'c'],
    }))
    expect(hook.result.current.queueState.hiddenIds).not.toContain('b')
    expect(hook.result.current.cards[hook.result.current.currentIndex]?.id).toBe('a')
    // A genuinely newer explicit removal from another device supersedes this
    // device's completed restore; the protection is not a permanent local veto.
    api.read.mockResolvedValue(round(4, ['a', 'b', 'c'], ['b']))
    await act(async () => hook.result.current.hydrateLiveRound({
      roundId: 'queue-test', planVersion: 4, queueCardIds: ['a', 'b', 'c'],
    }))
    expect(hook.result.current.queueState.hiddenIds).toContain('b')
    expect(feedIds(hook)).not.toContain('b')
  })
})
