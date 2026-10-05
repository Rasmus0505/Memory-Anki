import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { planRevealMotion, readRevealPhase, shouldPlayRevealMotion, type RevealPhase } from './useMindMapRevealMotion'

function node(id: string, phase: RevealPhase, depth = 1, y = 0): Node {
  const visual = phase === 'hidden' ? { concealText: true } : phase === 'revealed' ? { revealed: true } : {}
  return { id, position: { x: 0, y }, data: { metadata: { depth, visual } } }
}

function phases(nodes: Node[]) {
  return new Map(nodes.map((item) => [item.id, readRevealPhase(item)]))
}

describe('planRevealMotion', () => {
  it('never animates the first projection', () => {
    expect(planRevealMotion(null, [node('a', 'revealed'), node('b', 'hidden')])).toEqual({ flips: [], deals: [] })
  })

  it('flips a 待回忆 card that turns into its answer', () => {
    const before = [node('root', 'revealed', 0), node('a', 'hidden')]
    const after = [node('root', 'revealed', 0), node('a', 'revealed')]
    expect(planRevealMotion(phases(before), after).flips).toEqual(['a'])
  })

  it('flips children that come back revealed after their branch was folded away', () => {
    // Right-click folds the branch: the children leave the projection entirely.
    const folded = [node('root', 'revealed', 0), node('parent', 'revealed', 1)]
    const reopened = [
      node('root', 'revealed', 0),
      node('parent', 'revealed', 1),
      node('c2', 'revealed', 2, 40),
      node('c1', 'revealed', 2, 10),
    ]
    expect(planRevealMotion(phases(folded), reopened).flips).toEqual(['c1', 'c2'])
  })

  it('orders a branch reveal like dominoes: depth first, then top to bottom', () => {
    const before = [node('root', 'revealed', 0)]
    const after = [
      node('root', 'revealed', 0),
      node('deep', 'revealed', 2, 0),
      node('low', 'revealed', 1, 80),
      node('high', 'revealed', 1, 20),
    ]
    expect(planRevealMotion(phases(before), after).flips).toEqual(['high', 'low', 'deep'])
  })

  it('deals new 待回忆 cards instead of flipping them', () => {
    const before = [node('root', 'revealed', 0)]
    const after = [node('root', 'revealed', 0), node('a', 'hidden')]
    expect(planRevealMotion(phases(before), after)).toEqual({ flips: [], deals: ['a'] })
  })

  it('does not flip when leaving edit mode (no reveal state → revealed)', () => {
    const editing = [node('root', 'other', 0), node('a', 'other')]
    const review = [node('root', 'revealed', 0), node('a', 'revealed')]
    expect(planRevealMotion(phases(editing), review)).toEqual({ flips: [], deals: [] })
  })

  it('does not animate cards that stay revealed', () => {
    const same = [node('root', 'revealed', 0), node('a', 'revealed')]
    expect(planRevealMotion(phases(same), same)).toEqual({ flips: [], deals: [] })
  })
})

describe('shouldPlayRevealMotion', () => {
  it('plays a tap and a small branch', () => {
    expect(shouldPlayRevealMotion({ flips: ['a'], deals: [] })).toBe(true)
    expect(shouldPlayRevealMotion({ flips: ['a', 'b', 'c'], deals: [] }, { userGesture: true })).toBe(true)
  })

  it('does not replay a restored palace, with or without a fresh tap', () => {
    const restored = { flips: Array.from({ length: 9 }, (_, index) => `n${index}`), deals: [] }
    expect(shouldPlayRevealMotion(restored)).toBe(false)
    expect(shouldPlayRevealMotion(restored, { userGesture: true })).toBe(false)
    expect(shouldPlayRevealMotion({ flips: ['a', 'b'], deals: [] })).toBe(false)
  })
})
