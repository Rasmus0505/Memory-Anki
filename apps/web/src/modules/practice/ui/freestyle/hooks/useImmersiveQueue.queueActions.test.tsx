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
async function mount() {
  const hook = renderHook(() => useImmersiveQueue(), { wrapper })
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  await waitFor(() => expect(hook.result.current.cards.filter((card) => card.type !== 'review_hint')).toHaveLength(3))
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
