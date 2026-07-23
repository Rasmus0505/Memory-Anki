import { describe, expect, it } from 'vitest'
import {
  applySectionHierarchicalBack,
  applySectionHistoryPointerMove,
  applySectionNavigationTransition,
  canSectionNavigateBack,
  canSectionNavigateForward,
  createSectionNavigationHistoryState,
  peekSectionBackTarget,
  peekSectionHistoryTarget,
} from './sectionNavigationHistory'

const entry = (key: string, fullPath: string) => ({ key, fullPath })

describe('sectionNavigationHistory', () => {
  it('seeds full hierarchy so deep landings can step back level by level', () => {
    const state = createSectionNavigationHistoryState(
      entry('c1', '/english/listening/courses/7'),
      'english',
    )
    expect(canSectionNavigateBack(state)).toBe(true)
    expect(state.stacks.english?.entries.map((item) => item.fullPath)).toEqual([
      '/english',
      '/english/listening',
      '/english/listening/courses/7',
    ])
    expect(peekSectionHistoryTarget(state, -1)?.fullPath).toBe('/english/listening')
  })

  it('seeds section root so knowledge editor can go back to the bookshelf', () => {
    const state = createSectionNavigationHistoryState(entry('k1', '/knowledge'), 'palaces')
    expect(canSectionNavigateBack(state)).toBe(true)
    expect(peekSectionHistoryTarget(state, -1)?.fullPath).toBe('/palaces')
    expect(state.stacks.palaces?.entries.map((item) => item.fullPath)).toEqual([
      '/palaces',
      '/knowledge',
    ])
  })

  it('does not seed a root when already on the section home', () => {
    const state = createSectionNavigationHistoryState(entry('p1', '/palaces'), 'palaces')
    expect(canSectionNavigateBack(state)).toBe(false)
    expect(state.stacks.palaces?.entries.map((item) => item.fullPath)).toEqual(['/palaces'])
  })

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

    // Leave to freestyle — freestyle starts its own stack at the section root
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
      '/palaces',
      '/knowledge',
      '/knowledge/tree/1',
    ])
    expect(state.stacks.palaces?.index).toBe(2)

    const moved = applySectionHistoryPointerMove(
      state,
      entry('k1b', '/knowledge'),
      'palaces',
      -1,
    )
    expect(moved).not.toBeNull()
    expect(moved?.stacks.palaces?.index).toBe(1)
    expect(canSectionNavigateForward(moved!)).toBe(true)
  })

  it('resets a section stack when re-entering on an unknown path, still anchored to hierarchy', () => {
    let state = createSectionNavigationHistoryState(entry('a', '/palaces'), 'palaces')
    state = applySectionNavigationTransition(state, entry('b', '/palaces/1'), 'palaces', 'PUSH')
    state = applySectionNavigationTransition(state, entry('f', '/freestyle'), 'freestyle', 'PUSH')
    state = applySectionNavigationTransition(state, entry('x', '/palaces/99'), 'palaces', 'PUSH')

    expect(state.stacks.palaces?.entries.map((item) => item.fullPath)).toEqual([
      '/palaces',
      '/palaces/list',
      '/palaces/99',
    ])
    expect(canSectionNavigateBack(state)).toBe(true)
    expect(peekSectionHistoryTarget(state, -1)?.fullPath).toBe('/palaces/list')
  })

  it('supports hierarchical back fallback and keeps forward to the deep page', () => {
    // Simulate a broken single-entry stack that still has a logical parent.
    const state = {
      activeSection: 'english' as const,
      stacks: {
        english: {
          entries: [entry('only', '/english/listening/courses/7')],
          index: 0,
        },
      },
    }
    expect(canSectionNavigateBack(state)).toBe(true)
    expect(peekSectionBackTarget(state)).toEqual({
      fullPath: '/english/listening',
      mode: 'hierarchy',
    })

    const after = applySectionHierarchicalBack(
      state,
      entry('landed', '/english/listening'),
      'english',
    )
    expect(after?.stacks.english?.entries.map((item) => item.fullPath)).toEqual([
      '/english/listening',
      '/english/listening/courses/7',
    ])
    expect(after?.stacks.english?.index).toBe(0)
    expect(canSectionNavigateForward(after!)).toBe(true)
  })

  it('disables navigation when outside primary sections', () => {
    const state = createSectionNavigationHistoryState(entry('p', '/profile'), null)
    expect(canSectionNavigateBack(state)).toBe(false)
    expect(canSectionNavigateForward(state)).toBe(false)
  })
})
