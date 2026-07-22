export interface NavigationHistoryEntry {
  key: string
  fullPath: string
}

export interface NavigationHistoryState {
  entries: NavigationHistoryEntry[]
  index: number
}

export type NavigationHistoryAction = 'PUSH' | 'REPLACE' | 'POP'

export function createNavigationHistoryState(
  entry: NavigationHistoryEntry,
): NavigationHistoryState {
  return {
    entries: [entry],
    index: 0,
  }
}

export function applyNavigationHistoryTransition(
  state: NavigationHistoryState,
  entry: NavigationHistoryEntry,
  action: NavigationHistoryAction,
): NavigationHistoryState {
  if (action === 'POP') {
    const existingIndex = state.entries.findIndex((item) => item.key === entry.key)
    if (existingIndex >= 0) {
      return { entries: state.entries, index: existingIndex }
    }
    // Browser history can contain entries we never recorded (refresh mid-stack).
    return {
      entries: [...state.entries.slice(0, state.index + 1), entry],
      index: Math.min(state.index + 1, state.entries.length),
    }
  }

  if (action === 'REPLACE') {
    if (state.entries.length === 0) {
      return createNavigationHistoryState(entry)
    }
    const entries = state.entries.slice()
    entries[state.index] = entry
    return { entries, index: state.index }
  }

  const truncated = state.entries.slice(0, state.index + 1)
  // Ignore pure re-renders that re-report the same location key.
  if (truncated[truncated.length - 1]?.key === entry.key) {
    return { entries: truncated, index: truncated.length - 1 }
  }
  return {
    entries: [...truncated, entry],
    index: truncated.length,
  }
}

export function canNavigateHistoryBack(state: NavigationHistoryState) {
  return state.index > 0
}

export function canNavigateHistoryForward(state: NavigationHistoryState) {
  return state.index >= 0 && state.index < state.entries.length - 1
}
