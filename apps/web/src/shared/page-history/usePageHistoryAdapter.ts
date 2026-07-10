import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { Location } from 'react-router-dom'
import { toast } from 'sonner'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { resolvePageHistoryKey, resolvePageHistorySection } from './pageHistoryRoute'
import {
  createPageHistorySnapshot,
  readPageHistorySnapshot,
  savePageHistorySnapshot,
} from './pageHistoryStore'
import type { PageHistoryCapture, PageHistorySnapshot } from './pageHistoryTypes'
import { getPageHistoryWorkspaceId } from './pageHistoryWorkspace'

export interface PageHistoryAdapterOptions {
  location: Location
  ready?: boolean
  capture?: () => PageHistoryCapture
  restore?: (snapshot: PageHistorySnapshot) => void
  validate?: (snapshot: PageHistorySnapshot) => boolean
}

function routeRoot(pathname: string) {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-page-history-route]'))
    .find((element) => element.dataset.pageHistoryRoute === pathname) ?? null
}

function captureMarkedScrollPositions(pathname: string, windowScrollY: number) {
  const positions: Record<string, number> = { window: windowScrollY }
  routeRoot(pathname)?.querySelectorAll<HTMLElement>('[data-page-history-scroll-key]').forEach((element) => {
    const key = element.dataset.pageHistoryScrollKey
    if (key) positions[key] = element.scrollTop
  })
  return positions
}

function restoreMarkedScrollPositions(pathname: string, positions: Record<string, number>) {
  requestAnimationFrame(() => {
    if (!navigator.userAgent.includes('jsdom')) {
      window.scrollTo({ top: positions.window ?? 0, behavior: 'auto' })
    }
    routeRoot(pathname)?.querySelectorAll<HTMLElement>('[data-page-history-scroll-key]').forEach((element) => {
      const key = element.dataset.pageHistoryScrollKey
      if (key && Number.isFinite(positions[key])) element.scrollTop = positions[key]
    })
  })
}

export function usePageHistoryAdapter({
  location,
  ready = true,
  capture,
  restore,
  validate,
}: PageHistoryAdapterOptions) {
  const { isActive } = useRouteResidency()
  const restoredKeyRef = useRef<string | null>(null)
  const activeWindowScrollRef = useRef(0)
  const captureRef = useRef(capture)
  const restoreRef = useRef(restore)
  const validateRef = useRef(validate)
  captureRef.current = capture
  restoreRef.current = restore
  validateRef.current = validate

  const pageKey = resolvePageHistoryKey(location.pathname)
  const sectionKey = resolvePageHistorySection(location.pathname)
  const fullPath = `${location.pathname}${location.search}${location.hash}`

  const save = useCallback(() => {
    const captured = captureRef.current?.() ?? {}
    savePageHistorySnapshot(createPageHistorySnapshot({
      pageKey,
      sectionKey,
      fullPath,
      locationKey: location.key,
      workspaceId: getPageHistoryWorkspaceId(),
      scrollPositions: {
        ...captureMarkedScrollPositions(location.pathname, activeWindowScrollRef.current),
        ...captured.scrollPositions,
      },
      uiState: captured.uiState ?? {},
      entityRevisions: captured.entityRevisions ?? {},
      completionState: captured.completionState ?? null,
    }))
  }, [fullPath, location.key, pageKey, sectionKey])

  useLayoutEffect(() => {
    if (!isActive || !ready || restoredKeyRef.current === location.key) return
    restoredKeyRef.current = location.key
    const snapshot = readPageHistorySnapshot(location.key, pageKey)
    if (!snapshot) return
    if (validateRef.current && !validateRef.current(snapshot)) {
      toast.info('部分历史状态未能恢复，已回到当前页面的有效位置。')
      return
    }
    restoreRef.current?.(snapshot)
    activeWindowScrollRef.current = snapshot.scrollPositions.window ?? 0
    restoreMarkedScrollPositions(location.pathname, snapshot.scrollPositions)
  }, [isActive, location.key, location.pathname, pageKey, ready])

  useEffect(() => {
    if (!isActive) {
      save()
      return
    }
    activeWindowScrollRef.current = window.scrollY
    const handleScroll = () => {
      activeWindowScrollRef.current = window.scrollY
    }
    const handlePageHide = () => save()
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') save()
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('pagehide', handlePageHide)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('pagehide', handlePageHide)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      save()
    }
  }, [isActive, save])

  return { save, pageKey }
}
