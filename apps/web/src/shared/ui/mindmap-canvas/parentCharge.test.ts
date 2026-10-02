import { describe, expect, it } from 'vitest'
import { planChargeBurst, planParentCharges } from './parentCharge'

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
  it('merges a batch into one orb per parent and freezes once when any parent fills', () => {
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
