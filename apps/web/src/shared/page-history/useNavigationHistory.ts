import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useLocation,
  useNavigate,
  useNavigationType,
  type NavigationType,
} from 'react-router-dom'
import { resolveNavigationSection } from './navigationSection'
import {
  applySectionHierarchicalBack,
  applySectionHistoryPointerMove,
  applySectionNavigationTransition,
  canSectionNavigateBack,
  canSectionNavigateForward,
  createSectionNavigationHistoryState,
  peekSectionBackTarget,
  peekSectionHistoryTarget,
  type SectionNavigationHistoryState,
} from './sectionNavigationHistory'
import type { NavigationHistoryEntry } from './navigationHistory'
import {
  describeNavigationPath,
  getNavigationSectionLabel,
} from './sectionRouteHierarchy'

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
  const pendingHierarchicalBackRef = useRef(false)

  useEffect(() => {
    const entry = toEntry(location)
    const section = resolveNavigationSection(location.pathname)
    setState((current) => {
      if (pendingHierarchicalBackRef.current && section) {
        pendingHierarchicalBackRef.current = false
        pendingDeltaRef.current = 0
        const hierarchical = applySectionHierarchicalBack(current, entry, section)
        if (hierarchical) return hierarchical
      }
      if (pendingDeltaRef.current !== 0 && section) {
        const delta = pendingDeltaRef.current
        pendingDeltaRef.current = 0
        const moved = applySectionHistoryPointerMove(current, entry, section, delta)
        if (moved) return moved
      } else {
        pendingDeltaRef.current = 0
      }
      pendingHierarchicalBackRef.current = false
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
    const backTarget = peekSectionBackTarget(state)
    const forwardTarget = peekSectionHistoryTarget(state, 1)
    const sectionLabel = state.activeSection
      ? getNavigationSectionLabel(state.activeSection)
      : null
    const backTargetLabel = backTarget ? describeNavigationPath(backTarget.fullPath) : null
    const forwardTargetLabel = forwardTarget ? describeNavigationPath(forwardTarget.fullPath) : null

    return {
      canGoBack: canSectionNavigateBack(state),
      canGoForward: canSectionNavigateForward(state),
      goBack: () => {
        const target = peekSectionBackTarget(state)
        if (!target) return
        if (target.mode === 'stack') {
          pendingDeltaRef.current = -1
          pendingHierarchicalBackRef.current = false
        } else {
          pendingDeltaRef.current = 0
          pendingHierarchicalBackRef.current = true
        }
        navigate(target.fullPath)
      },
      goForward: () => {
        const target = peekSectionHistoryTarget(state, 1)
        if (!target) return
        pendingHierarchicalBackRef.current = false
        pendingDeltaRef.current = 1
        navigate(target.fullPath)
      },
      currentPath: activeStack?.entries[activeStack.index]?.fullPath ?? null,
      stackSize: activeStack?.entries.length ?? 0,
      index: activeStack?.index ?? -1,
      activeSection: state.activeSection,
      sectionLabel,
      backTargetPath: backTarget?.fullPath ?? null,
      backTargetLabel,
      /** @deprecated use backTargetLabel */
      backParentLabel: backTargetLabel,
      forwardTargetPath: forwardTarget?.fullPath ?? null,
      forwardTargetLabel,
    }
  }, [navigate, state])
}
