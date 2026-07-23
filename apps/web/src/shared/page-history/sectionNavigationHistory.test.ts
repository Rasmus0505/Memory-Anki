import { describe, expect, it } from 'vitest'
import {
  applySectionHistoryPointerMove,
  applySectionNavigationTransition,
  canSectionNavigateBack,
  canSectionNavigateForward,
  createSectionNavigationHistoryState,
  peekSectionHistoryTarget,
} from './sectionNavigationHistory'

const entry = (key: string, fullPath: string) => ({ key, fullPath })

describe('sectionNavigationHistory', () => {
  it('tracks in-section push/back/forward without mixing other sections', () => {
    let state = createSectionNavigationHistoryState(entry('k1', '/knowledge'), 'palaces')
    state = applySectionNavigationTransition(
      state,
      entry('k2', '/knowledge/tree/1'),
      'palaces',
      'PUSH',
    )

    expect(canSectionNavigateBack(state)).toBe(true)
    expect(peekSectionHistoryTarget(state, -1)?.fullPath).toBe('/knowledge')

    // Leave to freestyle — freestyle starts its own stack
    state = applySectionNavigationTransition(state, entry('f1', '/freestyle'), 'freestyle', 'PUSH')
    expect(state.activeSection).toBe('freestyle')
    expect(canSectionNavigateBack(state)).toBe(false)

    // Return to knowledge deep page with a new location key (tab restore)
    state = applySectionNavigationTransition(
      state,
      entry('k2b', '/knowledge/tree/1'),
      'palaces',
      'PUSH',
    )
    expect(state.activeSection).toBe('palaces')
    expect(canSectionNavigateBack(state)).toBe(true)
    expect(state.stacks.palaces?.entries.map((item) => item.fullPath)).toEqual([
      '/knowledge',
      '/knowledge/tree/1',
    ])
    expect(state.stacks.palaces?.index).toBe(1)

    const moved = applySectionHistoryPointerMove(
      state,
      entry('k1b', '/knowledge'),
      'palaces',
      -1,
    )
    expect(moved).not.toBeNull()
    expect(moved?.stacks.palaces?.index).toBe(0)
    expect(canSectionNavigateForward(moved!)).toBe(true)
  })

  it('resets a section stack when re-entering on an unknown path', () => {
    let state = createSectionNavigationHistoryState(entry('a', '/palaces'), 'palaces')
    state = applySectionNavigationTransition(state, entry('b', '/palaces/1'), 'palaces', 'PUSH')
    state = applySectionNavigationTransition(state, entry('f', '/freestyle'), 'freestyle', 'PUSH')
    state = applySectionNavigationTransition(state, entry('x', '/palaces/99'), 'palaces', 'PUSH')

    expect(state.stacks.palaces?.entries).toEqual([entry('x', '/palaces/99')])
    expect(canSectionNavigateBack(state)).toBe(false)
  })

  it('disables navigation when outside primary sections', () => {
    const state = createSectionNavigationHistoryState(entry('p', '/profile'), null)
    expect(canSectionNavigateBack(state)).toBe(false)
    expect(canSectionNavigateForward(state)).toBe(false)
  })
})
