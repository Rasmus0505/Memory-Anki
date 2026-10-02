import { describe, expect, it } from 'vitest'
import { planChargeBurst, planParentCharges, planRevealTransitions } from './parentCharge'

describe('planParentCharges', () => {
  it('counts only direct flip-session children and ignores edit-mode nodes', () => {
    const charges = planParentCharges([
      { id: 'root', parentId: null, phase: 'revealed' },
      { id: 'a', parentId: 'root', phase: 'revealed' },
      { id: 'b', parentId: 'root', phase: 'hidden' },
      { id: 'a1', parentId: 'a', phase: 'hidden' },
      { id: 'note', parentId: 'root', phase: 'other' },
    ])
    expect(charges.get('root')).toEqual({ done: 1, total: 2, mastered: false })
    expect(charges.get('a')).toEqual({ done: 0, total: 1, mastered: false })
    expect(charges.has('note')).toBe(false)
  })

  it('marks a parent mastered only when every direct child is cracked', () => {
    const charges = planParentCharges([
      { id: 'a', parentId: 'root', phase: 'revealed' },
      { id: 'b', parentId: 'root', phase: 'revealed' },
    ])
    expect(charges.get('root')).toEqual({ done: 2, total: 2, mastered: true })
  })
})

describe('planChargeBurst', () => {
  it('sends one orb per cracked card and freezes once when any parent fills', () => {
    const plan = planChargeBurst({
      flips: ['a1', 'a2', 'b1'],
      parentOf: new Map([
        ['a1', 'a'],
        ['a2', 'a'],
        ['b1', 'b'],
        ['b2', 'b'],
      ]),
      phaseOf: new Map([
        ['a1', 'revealed'],
        ['a2', 'revealed'],
        ['b1', 'revealed'],
        ['b2', 'hidden'],
      ]),
    })
    expect(plan.bursts).toEqual([
      { parentId: 'a', originId: 'a1', done: 2, total: 2, label: '2/2', mastered: true },
      { parentId: 'a', originId: 'a2', done: 2, total: 2, label: '2/2', mastered: true },
      { parentId: 'b', originId: 'b1', done: 1, total: 2, label: '1/2', mastered: false },
    ])
    expect(plan.freeze).toBe(true)
  })

  it('does not freeze a parent that still has a sealed child', () => {
    const plan = planChargeBurst({
      flips: ['a1'],
      parentOf: new Map([['a1', 'a'], ['a2', 'a']]),
      phaseOf: new Map([['a1', 'revealed'], ['a2', 'hidden']]),
    })
    expect(plan.freeze).toBe(false)
    expect(plan.bursts[0]?.label).toBe('1/2')
  })
})

describe('planRevealTransitions', () => {
  const input = (over: Partial<Parameters<typeof planRevealTransitions>[0]> = {}) => ({
    revealed: new Set<string>(),
    handled: new Set<string>(),
    previous: new Set<string>(),
    hydrated: true,
    sameGraph: true,
    staggerMs: 45,
    ...over,
  })

  it('hydrates an already-revealed document silently on first mount', () => {
    // Opening a palace where 3 cards were already flipped must not replay rewards.
    const plan = planRevealTransitions(input({
      revealed: new Set(['a', 'b', 'c']),
      hydrated: false,
    }))
    expect(plan.newlyRevealed).toEqual([])
    expect(plan.folded).toEqual([])
    expect(plan.delayMsById.size).toBe(0)
    expect(plan.handled).toEqual(new Set(['a', 'b', 'c']))
    expect(plan.previous).toEqual(new Set(['a', 'b', 'c']))
  })

  it('re-hydrates silently when the host switches to a different graph', () => {
    const plan = planRevealTransitions(input({
      revealed: new Set(['x', 'y']),
      handled: new Set(['a']),
      previous: new Set(['a']),
      hydrated: true,
      sameGraph: false,
    }))
    expect(plan.newlyRevealed).toEqual([])
    expect(plan.folded).toEqual([])
  })

  it('staggers simultaneous reveals by the batch cadence', () => {
    const plan = planRevealTransitions(input({
      revealed: new Set(['a', 'b', 'c']),
      handled: new Set(['a']),
      previous: new Set(['a']),
    }))
    expect(plan.newlyRevealed).toEqual(['b', 'c'])
    expect(plan.delayMsById.get('b')).toBe(0)
    expect(plan.delayMsById.get('c')).toBe(45)
  })

  it('reports folds and drops them from the handled set', () => {
    const plan = planRevealTransitions(input({
      revealed: new Set(['a']),
      handled: new Set(['a', 'b']),
      previous: new Set(['a', 'b']),
    }))
    expect(plan.folded).toEqual(['b'])
    expect(plan.newlyRevealed).toEqual([])
    expect(plan.handled.has('b')).toBe(false)
    expect(plan.previous).toEqual(new Set(['a']))
  })

  it('re-reveals a folded card with a fresh delay slot', () => {
    const plan = planRevealTransitions(input({
      revealed: new Set(['a', 'b']),
      handled: new Set(['a']),
      previous: new Set(['a']),
    }))
    expect(plan.newlyRevealed).toEqual(['b'])
    expect(plan.delayMsById.get('b')).toBe(0)
  })
})
