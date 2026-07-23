import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useLocation,
  useNavigate,
  useNavigationType,
  type NavigationType,
} from 'react-router-dom'
import { resolveNavigationSection } from './navigationSection'
import {
  applySectionHistoryPointerMove,
  applySectionNavigationTransition,
  canSectionNavigateBack,
  canSectionNavigateForward,
  createSectionNavigationHistoryState,
  peekSectionHistoryTarget,
  type SectionNavigationHistoryState,
} from './sectionNavigationHistory'
import type { NavigationHistoryEntry } from './navigationHistory'

function toEntry(location: {
  key: string
  pathname: string
  search: string
  hash: string
}): NavigationHistoryEntry {
  return {
    key: location.key || 'default',
    fullPath: `${location.pathname}${location.search}${location.hash}`,
  }
}

function toHistoryAction(type: NavigationType) {
  if (type === 'POP') return 'POP' as const
  if (type === 'REPLACE') return 'REPLACE' as const
  return 'PUSH' as const
}

export function useNavigationHistory() {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const [state, setState] = useState<SectionNavigationHistoryState>(() =>
    createSectionNavigationHistoryState(
      toEntry(location),
      resolveNavigationSection(location.pathname),
    ),
  )
  const pendingDeltaRef = useRef<-1 | 1 | 0>(0)

  useEffect(() => {
    const entry = toEntry(location)
    const section = resolveNavigationSection(location.pathname)
    setState((current) => {
      if (pendingDeltaRef.current !== 0 && section) {
        const delta = pendingDeltaRef.current
        pendingDeltaRef.current = 0
        const moved = applySectionHistoryPointerMove(current, entry, section, delta)
        if (moved) return moved
      } else {
        pendingDeltaRef.current = 0
      }
      return applySectionNavigationTransition(
        current,
        entry,
        section,
        toHistoryAction(navigationType),
      )
    })
  }, [location, navigationType])

  return useMemo(() => {
    const activeStack = state.activeSection
      ? state.stacks[state.activeSection] ?? null
      : null
    return {
      canGoBack: canSectionNavigateBack(state),
      canGoForward: canSectionNavigateForward(state),
      goBack: () => {
        const target = peekSectionHistoryTarget(state, -1)
        if (!target) return
        pendingDeltaRef.current = -1
        navigate(target.fullPath)
      },
      goForward: () => {
        const target = peekSectionHistoryTarget(state, 1)
        if (!target) return
        pendingDeltaRef.current = 1
        navigate(target.fullPath)
      },
      currentPath: activeStack?.entries[activeStack.index]?.fullPath ?? null,
      stackSize: activeStack?.entries.length ?? 0,
      index: activeStack?.index ?? -1,
      activeSection: state.activeSection,
    }
  }, [navigate, state])
}
