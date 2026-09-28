import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import { planFoldBack, type RevealPhase } from './useMindMapRevealMotion'

const node = (id: string): Node => ({ id, position: { x: 0, y: 0 }, data: {} })

describe('planFoldBack', () => {
  const parents = new Map([
    ['a', 'root'],
    ['a1', 'a'],
    ['a2', 'a'],
    ['a1x', 'a1'],
  ])

  it('folds hidden children into the card that hid them, deep ones into the nearest survivor', () => {
    const previous = new Map<string, RevealPhase>([
      ['root', 'revealed'],
      ['a', 'revealed'],
      ['a1', 'revealed'],
      ['a2', 'hidden'],
      ['a1x', 'revealed'],
    ])
    const folds = planFoldBack(previous, parents, [node('root'), node('a')])
    expect(folds).toEqual([
      { id: 'a1', into: 'a' },
      { id: 'a2', into: 'a' },
      { id: 'a1x', into: 'a' },
    ])
  })

  it('never folds on the first projection or for edit-mode deletions', () => {
    expect(planFoldBack(null, parents, [node('root')])).toEqual([])
    const editing = new Map<string, RevealPhase>([['root', 'other'], ['a', 'other']])
    expect(planFoldBack(editing, parents, [node('root')])).toEqual([])
  })

  it('skips nodes with no surviving ancestor (a different map replaced this one)', () => {
    const previous = new Map<string, RevealPhase>([['root', 'revealed'], ['a', 'revealed']])
    expect(planFoldBack(previous, parents, [node('other-root')])).toEqual([])
  })
})
