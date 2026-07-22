import { describe, expect, it } from 'vitest'
import {
  applyNavigationHistoryTransition,
  canNavigateHistoryBack,
  canNavigateHistoryForward,
  createNavigationHistoryState,
} from './navigationHistory'

const entry = (key: string, fullPath: string) => ({ key, fullPath })

describe('navigationHistory', () => {
  it('tracks push / back / forward like a browser stack', () => {
    let state = createNavigationHistoryState(entry('a', '/a'))
    state = applyNavigationHistoryTransition(state, entry('b', '/b'), 'PUSH')
    state = applyNavigationHistoryTransition(state, entry('c', '/c'), 'PUSH')

    expect(state.entries.map((item) => item.fullPath)).toEqual(['/a', '/b', '/c'])
    expect(state.index).toBe(2)
    expect(canNavigateHistoryBack(state)).toBe(true)
    expect(canNavigateHistoryForward(state)).toBe(false)

    state = applyNavigationHistoryTransition(state, entry('b', '/b'), 'POP')
    expect(state.index).toBe(1)
    expect(canNavigateHistoryForward(state)).toBe(true)

    state = applyNavigationHistoryTransition(state, entry('c', '/c'), 'POP')
    expect(state.index).toBe(2)
  })

  it('drops forward history after a new push from the middle', () => {
    let state = createNavigationHistoryState(entry('a', '/a'))
    state = applyNavigationHistoryTransition(state, entry('b', '/b'), 'PUSH')
    state = applyNavigationHistoryTransition(state, entry('c', '/c'), 'PUSH')
    state = applyNavigationHistoryTransition(state, entry('b', '/b'), 'POP')
    state = applyNavigationHistoryTransition(state, entry('d', '/d'), 'PUSH')

    expect(state.entries.map((item) => item.fullPath)).toEqual(['/a', '/b', '/d'])
    expect(state.index).toBe(2)
    expect(canNavigateHistoryForward(state)).toBe(false)
  })

  it('replaces the current entry without growing the stack', () => {
    let state = createNavigationHistoryState(entry('a', '/a'))
    state = applyNavigationHistoryTransition(state, entry('b', '/b'), 'PUSH')
    state = applyNavigationHistoryTransition(state, entry('b2', '/b?tab=2'), 'REPLACE')

    expect(state.entries).toEqual([entry('a', '/a'), entry('b2', '/b?tab=2')])
    expect(state.index).toBe(1)
    expect(canNavigateHistoryBack(state)).toBe(true)
  })
})
