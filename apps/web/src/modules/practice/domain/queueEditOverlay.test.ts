import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { FreestyleRoundPlanPayload } from '@/shared/api/contracts'
import {
  acknowledgeReorder,
  acknowledgeRestore,
  beginReorder,
  beginRestore,
  dropRestores,
  emptyQueueEditState,
  isRestoring,
  overlayQueueEdits,
  queueEditsForRound,
  reorderServerPresentedIds,
  restoringIds,
} from './queueEditOverlay'

interface QueueOrderCase {
  name: string
  plan: Partial<FreestyleRoundPlanPayload> & {
    original_cards: Array<Partial<FreestyleRoundPlanPayload['original_cards'][number]> & { card_id: string }>
    presented_ids: string[]
  }
  order_ids: string[]
  expected_presented_ids: string[]
}

// Same golden file the backend reads (`test_queue_order_parity.py`). A lock that
// exists on one side only fails one of the two tests.
const cases = JSON.parse(
  readFileSync(resolve(process.cwd(), '../api/tests/fixtures/queue_order_cases.json'), 'utf8'),
) as QueueOrderCase[]

function serverPlan(partial: Partial<FreestyleRoundPlanPayload> = {}): FreestyleRoundPlanPayload {
  return {
    original_cards: [],
    presented_ids: [],
    current_card_id: null,
    current_index: 0,
    completed_ids: [],
    excluded_ids: [],
    occurrences: [],
    encounters: {},
    ...partial,
  } as FreestyleRoundPlanPayload
}

function fromCase(testCase: QueueOrderCase): FreestyleRoundPlanPayload {
  return serverPlan({
    ...testCase.plan,
    original_cards: testCase.plan.original_cards.map((card) => ({
      unit_id: '',
      unit_revision: 0,
      kind: 'mindmap_branch',
      palace_id: null,
      palace_title: '',
      label: card.card_id,
      ...card,
    })),
  } as Partial<FreestyleRoundPlanPayload>)
}

describe('queue order parity with the backend', () => {
  it('has shared cases', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(reorderServerPresentedIds(fromCase(testCase), testCase.order_ids))
        .toEqual(testCase.expected_presented_ids)
    })
  }
})

const cards = ['a', 'b', 'c'].map((card_id) => ({
  card_id,
  unit_id: '',
  unit_revision: 0,
  kind: 'mindmap_branch',
  palace_id: null,
  palace_title: '',
  label: card_id,
}))

describe('queue edit overlay', () => {
  it('keeps a restored card visible on a snapshot that predates the restore', () => {
    const state = beginRestore(emptyQueueEditState('r1'), 'b', 'restore-1')
    const stale = serverPlan({ original_cards: cards, presented_ids: ['a', 'b', 'c'], excluded_ids: ['b'] })
    const result = overlayQueueEdits(state, stale, 'r1', 4)
    expect(result.plan.excluded_ids).toEqual([])
    expect(isRestoring(result.state, 'b')).toBe(true)
  })

  it('still protects the restore on a snapshot at the ACK version', () => {
    const state = acknowledgeRestore(beginRestore(emptyQueueEditState('r1'), 'b', 'restore-1'), 'b', 'restore-1', 7)
    const snapshot = serverPlan({ original_cards: cards, presented_ids: ['a', 'b', 'c'], excluded_ids: ['b'] })
    expect(overlayQueueEdits(state, snapshot, 'r1', 7).plan.excluded_ids).toEqual([])
  })

  it('lets a strictly newer removal from another device win over an acknowledged restore', () => {
    const state = acknowledgeRestore(beginRestore(emptyQueueEditState('r1'), 'b', 'restore-1'), 'b', 'restore-1', 7)
    const newer = serverPlan({ original_cards: cards, presented_ids: ['a', 'b', 'c'], excluded_ids: ['b'] })
    const result = overlayQueueEdits(state, newer, 'r1', 8)
    expect(result.plan.excluded_ids).toEqual(['b'])
    expect(isRestoring(result.state, 'b')).toBe(false)
  })

  it('never lets an unacknowledged restore lose to a newer snapshot', () => {
    // No ACK yet: the restore action has not reached the server, so no read can
    // already contain a removal that happened after it.
    const state = beginRestore(emptyQueueEditState('r1'), 'b', 'restore-1')
    const newer = serverPlan({ original_cards: cards, presented_ids: ['a', 'b', 'c'], excluded_ids: ['b'] })
    expect(overlayQueueEdits(state, newer, 'r1', 99).plan.excluded_ids).toEqual([])
  })

  it('a local removal drops the earlier restore', () => {
    const state = dropRestores(beginRestore(emptyQueueEditState('r1'), 'b', 'restore-1'), ['b'])
    expect(isRestoring(state, 'b')).toBe(false)
    expect(acknowledgeRestore(state, 'b', 'restore-1', 7)).toBe(state)
  })

  it.each([false, true])('ignores an old restore ACK after a newer restore (removed between: %s)', (removed) => {
    const first = beginRestore(emptyQueueEditState('r1'), 'b', 'restore-1')
    const second = beginRestore(removed ? dropRestores(first, ['b']) : first, 'b', 'restore-2')
    const afterOldAck = acknowledgeRestore(second, 'b', 'restore-1', 7)
    expect(afterOldAck).toBe(second)
    const excluded = serverPlan({ original_cards: cards, presented_ids: ['a', 'b', 'c'], excluded_ids: ['b'] })
    expect(overlayQueueEdits(afterOldAck, excluded, 'r1', 8).plan.excluded_ids).toEqual([])
    const afterOwnAck = acknowledgeRestore(afterOldAck, 'b', 'restore-2', 9)
    expect(overlayQueueEdits(afterOwnAck, excluded, 'r1', 9).plan.excluded_ids).toEqual([])
    expect(overlayQueueEdits(afterOwnAck, excluded, 'r1', 10).plan.excluded_ids).toEqual(['b'])
  })

  it('acknowledges each restored card independently', () => {
    const state = beginRestore(beginRestore(emptyQueueEditState('r1'), 'b', 'restore-b'), 'c', 'restore-c')
    expect(acknowledgeRestore(state, 'c', 'restore-b', 7)).toBe(state)
    const acked = acknowledgeRestore(state, 'b', 'restore-b', 7)
    const snapshot = serverPlan({ original_cards: cards, presented_ids: ['a', 'b', 'c'], excluded_ids: ['b', 'c'] })
    const result = overlayQueueEdits(acked, snapshot, 'r1', 8)
    expect(result.plan.excluded_ids).toEqual(['b'])
    expect(restoringIds(result.state, 'r1')).toEqual(['c'])
  })

  it('overlays a pending order on a snapshot that has not seen it', () => {
    const state = beginReorder(emptyQueueEditState('r1'), ['c', 'a', 'b'], 'reorder-1')
    const snapshot = serverPlan({ original_cards: cards, presented_ids: ['a', 'b', 'c'] })
    expect(overlayQueueEdits(state, snapshot, 'r1', 3).plan.presented_ids).toEqual(['c', 'a', 'b'])
  })

  it('an older reorder ACK does not clear a newer pending order', () => {
    const first = beginReorder(emptyQueueEditState('r1'), ['c', 'a', 'b'], 'reorder-1')
    const second = beginReorder(first, ['b', 'c', 'a'], 'reorder-2')
    const afterOldAck = acknowledgeReorder(second, 'reorder-1')
    expect(afterOldAck).toBe(second)
    expect(afterOldAck.order?.orderIds).toEqual(['b', 'c', 'a'])
    expect(acknowledgeReorder(afterOldAck, 'reorder-2').order).toBeNull()
  })

  it('does not mistake equal order contents for the same operation', () => {
    const first = beginReorder(emptyQueueEditState('r1'), ['c', 'a', 'b'], 'reorder-1')
    const middle = beginReorder(first, ['b', 'c', 'a'], 'reorder-2')
    const last = beginReorder(middle, ['c', 'a', 'b'], 'reorder-3')
    expect(acknowledgeReorder(last, 'reorder-1')).toBe(last)
    expect(acknowledgeReorder(last, 'reorder-2')).toBe(last)
    expect(acknowledgeReorder(last, 'reorder-3').order).toBeNull()
  })

  it('applies the pending order only to rows the server still lets move', () => {
    const state = beginReorder(emptyQueueEditState('r1'), ['c', 'b', 'a'], 'reorder-1')
    // Another device rated `a` before our reorder reached the server.
    const snapshot = serverPlan({
      original_cards: cards,
      presented_ids: ['a', 'b', 'c'],
      encounters: { a: { encounter_id: 'e', status: 'passed', unit_revision: 1, rating: 3 } },
    })
    expect(overlayQueueEdits(state, snapshot, 'r1', 5).plan.presented_ids).toEqual(['a', 'c', 'b'])
  })

  it('applies restores before deciding which rows a later reorder can move', () => {
    const state = beginReorder(
      beginRestore(emptyQueueEditState('r1'), 'b', 'restore-1'),
      ['b', 'c', 'a'],
      'reorder-1',
    )
    const snapshot = serverPlan({ original_cards: cards, presented_ids: ['a', 'b', 'c'], excluded_ids: ['b'] })
    const result = overlayQueueEdits(state, snapshot, 'r1', 4)
    expect(result.plan.excluded_ids).toEqual([])
    expect(result.plan.presented_ids).toEqual(['b', 'c', 'a'])
    expect(snapshot.excluded_ids).toEqual(['b'])
    expect(snapshot.presented_ids).toEqual(['a', 'b', 'c'])
  })

  it('ignores another round and starts a new round empty', () => {
    const state = beginReorder(beginRestore(emptyQueueEditState('r1'), 'b', 'restore-1'), ['c', 'b', 'a'], 'reorder-1')
    const snapshot = serverPlan({ original_cards: cards, presented_ids: ['a', 'b', 'c'], excluded_ids: ['b'] })
    expect(overlayQueueEdits(state, snapshot, 'r2', 1).plan).toBe(snapshot)
    expect(restoringIds(state, 'r2')).toEqual([])
    expect(restoringIds(state, 'r1')).toEqual(['b'])
    const fresh = queueEditsForRound(state, 'r2')
    expect(fresh.restores.size).toBe(0)
    expect(fresh.order).toBeNull()
    expect(queueEditsForRound(state, 'r1')).toBe(state)
    const pending = beginReorder(beginRestore(fresh, 'b', 'restore-2'), ['c', 'b', 'a'], 'reorder-2')
    expect(acknowledgeRestore(pending, 'b', 'restore-1', 99)).toBe(pending)
    expect(acknowledgeReorder(pending, 'reorder-1')).toBe(pending)
  })

  it('returns the same plan object when there is nothing to overlay', () => {
    const snapshot = serverPlan({ original_cards: cards, presented_ids: ['a', 'b', 'c'] })
    expect(overlayQueueEdits(emptyQueueEditState('r1'), snapshot, 'r1', 1).plan).toBe(snapshot)
  })
})
