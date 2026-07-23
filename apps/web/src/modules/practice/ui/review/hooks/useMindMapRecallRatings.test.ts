import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMindMapRecallRatings } from './useMindMapRecallRatings'

const listMindMapSessionEventsApi = vi.fn()
const ratePalaceNodesApi = vi.fn()
const undoPalaceRatingApi = vi.fn()

vi.mock('@/modules/content/domain/mindmap-learning-entity', () => ({
  listMindMapSessionEventsApi: (...args: unknown[]) => listMindMapSessionEventsApi(...args),
}))

vi.mock('@/modules/practice/ui/review/api', () => ({
  ratePalaceNodesApi: (...args: unknown[]) => ratePalaceNodesApi(...args),
  undoPalaceRatingApi: (...args: unknown[]) => undoPalaceRatingApi(...args),
}))

function event(partial: Record<string, unknown>) {
  return {
    id: 'e1',
    study_session_id: 'session-1',
    palace_id: 7,
    node_uid: 'child',
    source_scene: 'formal_review',
    recall_round: 'first',
    rating: 3,
    rating_source: 'manual',
    rating_scope: 'single',
    evidence_origin: 'direct',
    inference_confidence: null,
    response_ms: null,
    hint_count: 0,
    retry_count: 0,
    operation_id: 'op1',
    occurred_at: '2026-07-19T10:00:00.000Z',
    supersedes_event_id: null,
    ...partial,
  }
}

describe('useMindMapRecallRatings', () => {
  beforeEach(() => {
    listMindMapSessionEventsApi.mockReset()
    ratePalaceNodesApi.mockReset()
    undoPalaceRatingApi.mockReset()
    listMindMapSessionEventsApi.mockResolvedValue({ items: [] })
    ratePalaceNodesApi.mockResolvedValue({
      item: { affected_node_uids: ['parent', 'child'], operation_id: 'op-new' },
    })
  })

  it('uses the latest event origin for directRatedUids (not the oldest)', async () => {
    listMindMapSessionEventsApi.mockResolvedValue({
      items: [
        event({
          id: 'old-inherited',
          node_uid: 'child',
          evidence_origin: 'batch_inherited',
          rating: 4,
          occurred_at: '2026-07-19T10:00:00.000Z',
          operation_id: 'op-old',
        }),
        event({
          id: 'new-direct',
          node_uid: 'child',
          evidence_origin: 'direct',
          rating: 1,
          occurred_at: '2026-07-19T11:00:00.000Z',
          operation_id: 'op-new',
        }),
      ],
    })

    const { result } = renderHook(() =>
      useMindMapRecallRatings({
        palaceId: 7,
        studySessionId: 'session-1',
        enabled: true,
      }),
    )

    await waitFor(() => expect(result.current.directRatedUids.has('child')).toBe(true))
    expect(result.current.firstRatings.get('child')).toBe(1)
  })

  it('treats missing evidence_origin as direct', async () => {
    listMindMapSessionEventsApi.mockResolvedValue({
      items: [
        event({
          id: 'legacy',
          node_uid: 'leaf',
          evidence_origin: undefined,
          occurred_at: '2026-07-19T10:00:00.000Z',
        }),
      ],
    })

    const { result } = renderHook(() =>
      useMindMapRecallRatings({
        palaceId: 7,
        studySessionId: 'session-1',
        enabled: true,
      }),
    )

    await waitFor(() => expect(result.current.directRatedUids.has('leaf')).toBe(true))
  })

  it('merges first and weak_retry ratings for display without dropping prior chips', async () => {
    listMindMapSessionEventsApi.mockResolvedValue({
      items: [
        event({
          id: 'first-good',
          node_uid: 'a',
          rating: 3,
          recall_round: 'first',
          occurred_at: '2026-07-19T10:00:00.000Z',
        }),
        event({
          id: 'first-hard',
          node_uid: 'b',
          rating: 2,
          recall_round: 'first',
          occurred_at: '2026-07-19T10:01:00.000Z',
        }),
        event({
          id: 'retry-b',
          node_uid: 'b',
          rating: 3,
          recall_round: 'weak_retry',
          occurred_at: '2026-07-19T10:05:00.000Z',
        }),
      ],
    })

    const { result } = renderHook(() =>
      useMindMapRecallRatings({
        palaceId: 7,
        studySessionId: 'session-1',
        enabled: true,
      }),
    )

    await waitFor(() => expect(result.current.displayRatings.get('a')).toBe(3))
    expect(result.current.displayRatings.get('b')).toBe(3)
    expect(result.current.weakNodeUids).toContain('b')
    // First-round hard still tracked even though retry improved it.
    expect(result.current.firstRatings.get('b')).toBe(2)
  })

  it('reloads session events when remounting the same studySessionId', async () => {
    listMindMapSessionEventsApi.mockResolvedValue({
      items: [event({ id: 'persisted', node_uid: 'a', rating: 2 })],
    })

    const { result, unmount } = renderHook(() =>
      useMindMapRecallRatings({
        palaceId: 7,
        studySessionId: 'session-1',
        enabled: true,
      }),
    )
    await waitFor(() => expect(result.current.firstRatings.get('a')).toBe(2))
    unmount()

    const remounted = renderHook(() =>
      useMindMapRecallRatings({
        palaceId: 7,
        studySessionId: 'session-1',
        enabled: true,
      }),
    )
    await waitFor(() => expect(remounted.result.current.firstRatings.get('a')).toBe(2))
    expect(listMindMapSessionEventsApi).toHaveBeenCalledWith('session-1')
  })

  it('marks subtree inherited children as batch_inherited so parent re-rate can conflict after child re-rate', async () => {
    listMindMapSessionEventsApi.mockResolvedValue({ items: [] })
    const { result } = renderHook(() =>
      useMindMapRecallRatings({
        palaceId: 7,
        studySessionId: 'session-1',
        enabled: true,
      }),
    )
    await waitFor(() => expect(listMindMapSessionEventsApi).toHaveBeenCalled())

    ratePalaceNodesApi.mockResolvedValueOnce({
      item: { affected_node_uids: ['parent', 'child'], operation_id: 'op-parent' },
    })
    await act(async () => {
      await result.current.rateNode('parent', 3, 'first', 'subtree')
    })
    expect(result.current.directRatedUids.has('parent')).toBe(true)
    expect(result.current.directRatedUids.has('child')).toBe(false)
    expect(result.current.sessionRatedUids.has('parent')).toBe(true)
    expect(result.current.sessionRatedUids.has('child')).toBe(true)

    ratePalaceNodesApi.mockResolvedValueOnce({
      item: { affected_node_uids: ['child'], operation_id: 'op-child' },
    })
    await act(async () => {
      await result.current.rateNode('child', 1, 'first', 'single')
    })
    expect(result.current.directRatedUids.has('child')).toBe(true)
    expect(result.current.sessionRatedUids.has('child')).toBe(true)
  })

  it('optimistically cascades through single-child spine into all grandchildren', async () => {
    listMindMapSessionEventsApi.mockResolvedValue({ items: [] })
    const { result } = renderHook(() =>
      useMindMapRecallRatings({
        palaceId: 7,
        studySessionId: 'session-1',
        enabled: true,
      }),
    )
    await waitFor(() => expect(listMindMapSessionEventsApi).toHaveBeenCalled())

    // Server list arrives later; client cascade UIDs must paint G* immediately.
    let resolveApi!: (value: { item: { affected_node_uids: string[] } }) => void
    ratePalaceNodesApi.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveApi = resolve
      }),
    )
    let pending: Promise<string | undefined>
    await act(async () => {
      pending = result.current.rateNode(
        'p',
        3,
        'first',
        'subtree',
        {},
        'overwrite',
        ['p', 'c', 'g1', 'g2', 'g3'],
      )
    })
    expect(result.current.sessionRatedUids.has('p')).toBe(true)
    expect(result.current.sessionRatedUids.has('c')).toBe(true)
    expect(result.current.sessionRatedUids.has('g1')).toBe(true)
    expect(result.current.sessionRatedUids.has('g2')).toBe(true)
    expect(result.current.sessionRatedUids.has('g3')).toBe(true)
    expect(result.current.directRatedUids.has('p')).toBe(true)
    expect(result.current.directRatedUids.has('g1')).toBe(false)

    await act(async () => {
      resolveApi({ item: { affected_node_uids: ['p', 'c', 'g1', 'g2', 'g3'] } })
      await pending
    })
    expect(result.current.sessionRatedUids.has('g3')).toBe(true)
  })
})
