import {
  applyNavigationHistoryTransition,
  createNavigationHistoryState,
  type NavigationHistoryAction,
  type NavigationHistoryEntry,
  type NavigationHistoryState,
} from './navigationHistory'
import type { NavigationSectionKey } from './navigationSection'

export interface SectionNavigationHistoryState {
  activeSection: NavigationSectionKey | null
  stacks: Partial<Record<NavigationSectionKey, NavigationHistoryState>>
}

export function createSectionNavigationHistoryState(
  entry: NavigationHistoryEntry,
  section: NavigationSectionKey | null,
): SectionNavigationHistoryState {
  if (!section) {
    return { activeSection: null, stacks: {} }
  }
  return {
    activeSection: section,
    stacks: { [section]: createNavigationHistoryState(entry) },
  }
}

function adoptEntryOnStack(
  stack: NavigationHistoryState,
  entry: NavigationHistoryEntry,
): NavigationHistoryState {
  const byKey = stack.entries.findIndex((item) => item.key === entry.key)
  if (byKey >= 0) {
    return { entries: stack.entries, index: byKey }
  }
  const byPath = stack.entries.findIndex((item) => item.fullPath === entry.fullPath)
  if (byPath >= 0) {
    const entries = stack.entries.slice()
    entries[byPath] = entry
    return { entries, index: byPath }
  }
  return createNavigationHistoryState(entry)
}

/**
 * Apply a router transition against per-section stacks.
 * Cross-section navigations never push the previous section onto the new stack.
 */
export function applySectionNavigationTransition(
  state: SectionNavigationHistoryState,
  entry: NavigationHistoryEntry,
  section: NavigationSectionKey | null,
  action: NavigationHistoryAction,
): SectionNavigationHistoryState {
  if (!section) {
    return { activeSection: null, stacks: state.stacks }
  }

  if (state.activeSection !== section) {
    const existing = state.stacks[section]
    const nextStack = existing
      ? adoptEntryOnStack(existing, entry)
      : createNavigationHistoryState(entry)
    return {
      activeSection: section,
      stacks: { ...state.stacks, [section]: nextStack },
    }
  }

  const current = state.stacks[section] ?? createNavigationHistoryState(entry)
  const nextStack = applyNavigationHistoryTransition(current, entry, action)
  return {
    activeSection: section,
    stacks: { ...state.stacks, [section]: nextStack },
  }
}

/** Apply a programmatic in-section back/forward landing (new location key, same path). */
export function applySectionHistoryPointerMove(
  state: SectionNavigationHistoryState,
  entry: NavigationHistoryEntry,
  section: NavigationSectionKey,
  delta: -1 | 1,
): SectionNavigationHistoryState | null {
  const stack = state.stacks[section]
  if (!stack || state.activeSection !== section) return null
  const nextIndex = stack.index + delta
  if (nextIndex < 0 || nextIndex >= stack.entries.length) return null
  if (stack.entries[nextIndex]?.fullPath !== entry.fullPath) return null
  const entries = stack.entries.slice()
  entries[nextIndex] = entry
  return {
    activeSection: section,
    stacks: {
      ...state.stacks,
      [section]: { entries, index: nextIndex },
    },
  }
}

export function readActiveSectionStack(state: SectionNavigationHistoryState) {
  if (!state.activeSection) return null
  return state.stacks[state.activeSection] ?? null
}

export function canSectionNavigateBack(state: SectionNavigationHistoryState) {
  const stack = readActiveSectionStack(state)
  return Boolean(stack && stack.index > 0)
}

export function canSectionNavigateForward(state: SectionNavigationHistoryState) {
  const stack = readActiveSectionStack(state)
  return Boolean(stack && stack.index >= 0 && stack.index < stack.entries.length - 1)
}

export function peekSectionHistoryTarget(
  state: SectionNavigationHistoryState,
  delta: -1 | 1,
): NavigationHistoryEntry | null {
  const stack = readActiveSectionStack(state)
  if (!stack) return null
  const nextIndex = stack.index + delta
  if (nextIndex < 0 || nextIndex >= stack.entries.length) return null
  return stack.entries[nextIndex] ?? null
}
