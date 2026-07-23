import {
  applyNavigationHistoryTransition,
  createNavigationHistoryState,
  type NavigationHistoryAction,
  type NavigationHistoryEntry,
  type NavigationHistoryState,
} from './navigationHistory'
import {
  getNavigationSectionRoot,
  isNavigationSectionRootPath,
  readNavigationPathname,
  type NavigationSectionKey,
} from './navigationSection'
import {
  getSectionHierarchyChain,
  resolveSectionHierarchicalParent,
} from './sectionRouteHierarchy'

export interface SectionNavigationHistoryState {
  activeSection: NavigationSectionKey | null
  stacks: Partial<Record<NavigationSectionKey, NavigationHistoryState>>
}

function syntheticEntry(fullPath: string, kind: 'root' | 'level'): NavigationHistoryEntry {
  return {
    key: `section-${kind}:${fullPath}`,
    fullPath,
  }
}

/**
 * Deep landings (refresh, launch restore, direct link) often start with a
 * single-entry stack. Seed the full in-section hierarchy chain so 后退 can
 * walk one level at a time (e.g. course → listening → english hub).
 */
export function withSectionHierarchyAnchors(
  stack: NavigationHistoryState,
  section: NavigationSectionKey,
): NavigationHistoryState {
  if (stack.entries.length === 0) return stack
  const current = stack.entries[stack.index]
  if (!current) return stack
  if (isNavigationSectionRootPath(current.fullPath, section)) return stack

  const chain = getSectionHierarchyChain(current.fullPath)
  // Drop the current path from the chain — it already lives at stack.index.
  const ancestors = chain.slice(0, -1)
  if (ancestors.length === 0) return stack

  const existingPathsBefore = new Set(
    stack.entries.slice(0, stack.index).map((item) => item.fullPath),
  )
  const missingAncestors = ancestors.filter((path) => !existingPathsBefore.has(path))
  if (missingAncestors.length === 0) return stack

  const seeded = missingAncestors.map((path, index) =>
    syntheticEntry(path, index === 0 ? 'root' : 'level'),
  )
  return {
    entries: [...seeded, ...stack.entries],
    index: stack.index + seeded.length,
  }
}

/** @deprecated Use withSectionHierarchyAnchors; kept for transitional imports/tests. */
export function withSectionRootAnchor(
  stack: NavigationHistoryState,
  section: NavigationSectionKey,
): NavigationHistoryState {
  return withSectionHierarchyAnchors(stack, section)
}

function stackForSection(
  entry: NavigationHistoryEntry,
  section: NavigationSectionKey,
): NavigationHistoryState {
  return withSectionHierarchyAnchors(createNavigationHistoryState(entry), section)
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
    stacks: { [section]: stackForSection(entry, section) },
  }
}

function adoptEntryOnStack(
  stack: NavigationHistoryState,
  entry: NavigationHistoryEntry,
  section: NavigationSectionKey,
): NavigationHistoryState {
  const byKey = stack.entries.findIndex((item) => item.key === entry.key)
  if (byKey >= 0) {
    return withSectionHierarchyAnchors({ entries: stack.entries, index: byKey }, section)
  }
  const byPath = stack.entries.findIndex((item) => item.fullPath === entry.fullPath)
  if (byPath >= 0) {
    const entries = stack.entries.slice()
    entries[byPath] = entry
    return withSectionHierarchyAnchors({ entries, index: byPath }, section)
  }
  return stackForSection(entry, section)
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
      ? adoptEntryOnStack(existing, entry, section)
      : stackForSection(entry, section)
    return {
      activeSection: section,
      stacks: { ...state.stacks, [section]: nextStack },
    }
  }

  const current = state.stacks[section] ?? stackForSection(entry, section)
  const nextStack = withSectionHierarchyAnchors(
    applyNavigationHistoryTransition(current, entry, action),
    section,
  )
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

/**
 * Hierarchical fallback when the visit stack cannot step back:
 * land on the logical parent and rewrite the stack so 前进 can return.
 */
export function applySectionHierarchicalBack(
  state: SectionNavigationHistoryState,
  landedEntry: NavigationHistoryEntry,
  section: NavigationSectionKey,
): SectionNavigationHistoryState | null {
  const stack = state.stacks[section]
  if (!stack || state.activeSection !== section) return null
  const current = stack.entries[stack.index]
  if (!current) return null
  const parentPath = resolveSectionHierarchicalParent(current.fullPath)
  if (!parentPath || parentPath !== landedEntry.fullPath) return null

  // Drop forward entries; keep unique ancestors, then parent + current leaf.
  const before = stack.entries
    .slice(0, stack.index)
    .filter((item) => item.fullPath !== parentPath && item.fullPath !== current.fullPath)
  const entries = [...before, landedEntry, current]
  return {
    activeSection: section,
    stacks: {
      ...state.stacks,
      [section]: {
        entries,
        index: entries.length - 2,
      },
    },
  }
}

export function readActiveSectionStack(state: SectionNavigationHistoryState) {
  if (!state.activeSection) return null
  return state.stacks[state.activeSection] ?? null
}

export function canSectionNavigateBack(state: SectionNavigationHistoryState) {
  const stack = readActiveSectionStack(state)
  if (stack && stack.index > 0) return true
  const current = stack?.entries[stack.index]
  if (!current) return false
  return resolveSectionHierarchicalParent(current.fullPath) != null
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

/** Prefer stack history; fall back to hierarchical parent for 后退. */
export function peekSectionBackTarget(
  state: SectionNavigationHistoryState,
): { fullPath: string; mode: 'stack' | 'hierarchy' } | null {
  const stackTarget = peekSectionHistoryTarget(state, -1)
  if (stackTarget) return { fullPath: stackTarget.fullPath, mode: 'stack' }
  const stack = readActiveSectionStack(state)
  const current = stack?.entries[stack.index]
  if (!current) return null
  const parent = resolveSectionHierarchicalParent(current.fullPath)
  if (!parent) return null
  return { fullPath: parent, mode: 'hierarchy' }
}

export function getActiveSectionRootPath(state: SectionNavigationHistoryState): string | null {
  if (!state.activeSection) return null
  return getNavigationSectionRoot(state.activeSection)
}

export function getActiveSectionCurrentPath(state: SectionNavigationHistoryState): string | null {
  const stack = readActiveSectionStack(state)
  return stack?.entries[stack.index]?.fullPath ?? null
}
