import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useLocation,
  useNavigate,
  useNavigationType,
  type NavigationType,
} from 'react-router-dom'
import {
  applyNavigationHistoryTransition,
  canNavigateHistoryBack,
  canNavigateHistoryForward,
  createNavigationHistoryState,
  type NavigationHistoryEntry,
  type NavigationHistoryState,
} from './navigationHistory'

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
  const [state, setState] = useState<NavigationHistoryState>(() =>
    createNavigationHistoryState(toEntry(location)),
  )
  const pendingDeltaRef = useRef(0)

  useEffect(() => {
    const entry = toEntry(location)
    setState((current) => {
      if (pendingDeltaRef.current !== 0) {
        const nextIndex = current.index + pendingDeltaRef.current
        pendingDeltaRef.current = 0
        if (
          nextIndex >= 0 &&
          nextIndex < current.entries.length &&
          current.entries[nextIndex]?.key === entry.key
        ) {
          return { entries: current.entries, index: nextIndex }
        }
      }
      return applyNavigationHistoryTransition(current, entry, toHistoryAction(navigationType))
    })
  }, [location, navigationType])

  return useMemo(
    () => ({
      canGoBack: canNavigateHistoryBack(state),
      canGoForward: canNavigateHistoryForward(state),
      goBack: () => {
        if (!canNavigateHistoryBack(state)) return
        pendingDeltaRef.current = -1
        navigate(-1)
      },
      goForward: () => {
        if (!canNavigateHistoryForward(state)) return
        pendingDeltaRef.current = 1
        navigate(1)
      },
      currentPath: state.entries[state.index]?.fullPath ?? null,
      stackSize: state.entries.length,
      index: state.index,
    }),
    [navigate, state],
  )
}
