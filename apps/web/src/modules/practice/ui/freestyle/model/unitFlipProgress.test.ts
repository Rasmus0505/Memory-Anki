import { describe, expect, it } from 'vitest'
import { countUnitFlipProgress, unitFlipTargetUids } from './unitFlipProgress'

describe('countUnitFlipProgress', () => {
  it('counts only unit membership, not palace-wide nodes', () => {
    const revealMap = {
      root: 'revealed',
      'unit-a': 'revealed',
      'unit-b': 'hidden',
      'other-palace-node': 'revealed',
    } as const
    expect(
      countUnitFlipProgress(revealMap, ['unit-a', 'unit-b'], 'unit-a'),
    ).toEqual({ revealed: 1, total: 2 })
  })

  it('includes anchor when missing from node_uids', () => {
    expect(
      countUnitFlipProgress({ anchor: 'hidden', child: 'revealed' }, ['child'], 'anchor'),
    ).toEqual({ revealed: 1, total: 2 })
  })

  it('returns 0/0 for empty unit', () => {
    expect(countUnitFlipProgress({}, [], null)).toEqual({ revealed: 0, total: 0 })
  })

  it('does not flip the parent anchor of a cohort card', () => {
    expect(unitFlipTargetUids(['B1', 'B2'], 'A', 'cohort')).toEqual(['B1', 'B2'])
    expect(unitFlipTargetUids(['B1', 'C1'], 'B1', 'mark')).toEqual(['B1', 'C1'])
  })
})
