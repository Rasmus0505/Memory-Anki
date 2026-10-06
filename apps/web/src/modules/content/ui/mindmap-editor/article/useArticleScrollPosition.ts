import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { ArticleReadingOwnerId } from '@/shared/api/contracts/articleReading'

interface ArticleScrollPositionOptions {
  active: boolean
  rootRef: RefObject<HTMLElement | null>
  ownerId: ArticleReadingOwnerId | null
  selectedUid?: string | null
  recordProgress: (uid: string, offset: number | null) => void
  onSelect?: (uid: string) => void
  /** Unfold the target before the next animation frame. */
  onBeforeNavigate?: (uid: string) => void
}

const clamp = (value: number) => Math.max(0, Math.min(1, value))
const sections = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>('[data-article-uid]'))

/** Sample current DOM on every user scroll: folded/replaced sections need no observer registration. */
export function readArticleScrollPosition(root: HTMLElement): { node_uid: string; block_offset: number } | null {
  const bounds = root.getBoundingClientRect()
  const top = bounds.top + root.clientTop
  const bottom = top + root.clientHeight
  let nearest: { node_uid: string; block_offset: number; distance: number } | null = null
  for (const element of sections(root)) {
    const uid = element.dataset.articleUid
    const rect = element.getBoundingClientRect()
    if (!uid || rect.height <= 0 || rect.bottom <= top || rect.top >= bottom) continue
    const distance = rect.top <= top ? 0 : rect.top - top
    if (!nearest || distance < nearest.distance) {
      nearest = { node_uid: uid, block_offset: clamp((top - rect.top) / rect.height), distance }
    }
  }
  return nearest ? { node_uid: nearest.node_uid, block_offset: nearest.block_offset } : null
}

/** No mount/focus/layout writes. Only an armed user scroll or explicit navigation persists. */
export function useArticleScrollPosition(options: ArticleScrollPositionOptions) {
  const latest = useRef(options)
  latest.current = options
  const generation = useRef(0)
  const navigationFrame = useRef<number | null>(null)
  const suppressScroll = useRef<() => void>(() => {})

  const { rootRef, active, ownerId } = options
  useEffect(() => {
    const root = rootRef.current
    const version = ++generation.current
    if (!active || !ownerId || !root) return
    let intentUntil = 0
    let pointerDown = false
    let scrollFrame: number | null = null
    const current = () => generation.current === version && latest.current.active && latest.current.ownerId === ownerId
    const arm = () => { intentUntil = performance.now() + 1500 }
    const pointer = (event: PointerEvent) => {
      const bounds = root.getBoundingClientRect()
      const scrollbarLeft = bounds.left + root.clientLeft + root.clientWidth
      if (event.clientX >= scrollbarLeft && event.clientX <= bounds.right) { pointerDown = true; arm() }
    }
    const release = () => { pointerDown = false }
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,select,[contenteditable="true"]')) return
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) arm()
    }
    const scroll = () => {
      if (!current() || (!pointerDown && performance.now() > intentUntil) || intentUntil === 0) return
      arm() // Keep touch momentum and a continuous wheel gesture alive.
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null
        if (!current()) return
        const position = readArticleScrollPosition(root)
        if (position) latest.current.recordProgress(position.node_uid, position.block_offset)
      })
    }
    suppressScroll.current = () => {
      intentUntil = 0
      pointerDown = false
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      scrollFrame = null
    }
    root.addEventListener('wheel', arm, { passive: true })
    root.addEventListener('touchmove', arm, { passive: true })
    root.addEventListener('pointerdown', pointer, { passive: true })
    root.addEventListener('keydown', key)
    root.addEventListener('scroll', scroll, { passive: true })
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      generation.current += 1
      if (scrollFrame !== null) cancelAnimationFrame(scrollFrame)
      if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current)
      navigationFrame.current = null
      root.removeEventListener('wheel', arm)
      root.removeEventListener('touchmove', arm)
      root.removeEventListener('pointerdown', pointer)
      root.removeEventListener('keydown', key)
      root.removeEventListener('scroll', scroll)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      suppressScroll.current = () => {}
    }
  }, [active, ownerId, rootRef])

  const navigateTo = useCallback((uid: string, offset: number | null = 0) => {
    const snapshot = latest.current
    if (!snapshot.active || !uid || (offset !== null && !Number.isFinite(offset))) return
    const owner = snapshot.ownerId
    const version = generation.current
    suppressScroll.current()
    snapshot.onBeforeNavigate?.(uid)
    snapshot.onSelect?.(uid)
    if (navigationFrame.current !== null) cancelAnimationFrame(navigationFrame.current)
    navigationFrame.current = requestAnimationFrame(() => {
      navigationFrame.current = null
      const current = latest.current
      if (!current.active || current.ownerId !== owner || generation.current !== version) return
      const root = current.rootRef.current
      if (!root) return
      const target = sections(root).find(element => element.dataset.articleUid === uid)
      if (!target) return
      const rect = target.getBoundingClientRect()
      if (rect.height <= 0) return
      const fraction = clamp(offset ?? 0)
      const top = root.getBoundingClientRect().top + root.clientTop
      root.scrollTo({ top: Math.max(0, root.scrollTop + rect.top - top + rect.height * fraction), behavior: 'instant' })
      if (owner) current.recordProgress(uid, fraction)
    })
  }, [])

  const focusSelected = useCallback(() => {
    if (latest.current.selectedUid) navigateTo(latest.current.selectedUid)
  }, [navigateTo])
  return { navigateTo, focusSelected }
}
