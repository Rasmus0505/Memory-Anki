import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

const DURATION_MS = 540
const EASE_RISE = 'cubic-bezier(0.2, 0.85, 0.25, 1)'
const GHOST_NODE_LIMIT = 12000
const SHEET_CLASS = 'ma-route-sheet'

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function findRoute(container: HTMLElement, pathname: string) {
  for (const child of Array.from(container.children)) {
    if (child instanceof HTMLElement && child.dataset.pageHistoryRoute === pathname) return child
  }
  return null
}

function buildGhost(previous: HTMLElement, current: HTMLElement, scrollY: number) {
  if (previous.getElementsByTagName('*').length > GHOST_NODE_LIMIT) return null
  const rect = current.getBoundingClientRect()
  const docTop = rect.top + window.scrollY
  const top = docTop - scrollY
  const clone = previous.cloneNode(true) as HTMLElement
  clone.removeAttribute('data-page-history-route')
  clone.style.display = 'flex'
  // A ghost that starts above the viewport is shifted so its visible part stays put.
  if (top < 0) clone.style.marginTop = `${top}px`
  for (const node of Array.from(clone.querySelectorAll('[id]'))) node.removeAttribute('id')
  const ghost = document.createElement('div')
  ghost.className = 'ma-route-ghost'
  ghost.setAttribute('aria-hidden', 'true')
  ghost.inert = true
  Object.assign(ghost.style, {
    top: `${Math.max(0, top)}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    // Only the visible slice matters; strict containment keeps layout of a big page cheap.
    height: `${Math.max(0, window.innerHeight - Math.max(0, top))}px`,
    transformOrigin: `50% ${window.innerHeight / 2 - top}px`,
  })
  ghost.appendChild(clone)
  return ghost
}

/**
 * Depth-stack route change: the previous page sinks back (scale, dim, blur)
 * while the new page rises over it as an opaque paper sheet.
 */
export function useRouteDepthTransition(args: {
  rootRef: RefObject<HTMLElement | null>
  contentRef: RefObject<HTMLElement | null>
  pathname: string
  enabled: boolean
  onTransition?: () => void
}) {
  const { rootRef, contentRef, pathname, enabled, onTransition } = args
  const previousPath = useRef(pathname)
  const previousEnabled = useRef(enabled)
  const lastScrollY = useRef(0)
  const cleanupRef = useRef<(() => void) | null>(null)
  const onTransitionRef = useRef(onTransition)
  onTransitionRef.current = onTransition

  useEffect(() => {
    lastScrollY.current = window.scrollY
    const onScroll = () => {
      lastScrollY.current = window.scrollY
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    const fromPath = previousPath.current
    const wasEnabled = previousEnabled.current
    const scrollBefore = lastScrollY.current
    previousPath.current = pathname
    previousEnabled.current = enabled
    if (fromPath === pathname) return
    onTransitionRef.current?.()
    cleanupRef.current?.()
    cleanupRef.current = null
    const root = rootRef.current
    const content = contentRef.current
    if (!enabled || !root || !content || typeof content.animate !== 'function' || reducedMotion()) return

    const current = findRoute(content, pathname)
    const previous = wasEnabled ? findRoute(content, fromPath) : null
    const ghost = previous && current ? buildGhost(previous, current, scrollBefore) : null
    if (ghost) root.appendChild(ghost)
    content.classList.add(SHEET_CLASS)

    const rise = Math.round(Math.min(170, window.innerHeight * 0.18))
    const animations: Animation[] = []
    if (ghost) {
      animations.push(ghost.animate(
        [
          { transform: 'scale(1)', filter: 'blur(0) brightness(1)', opacity: 1 },
          { transform: 'scale(0.95)', filter: 'blur(2px) brightness(0.7)', opacity: 1, offset: 0.45 },
          { transform: 'scale(0.92) translate3d(0, -1.5%, 0)', filter: 'blur(3px) brightness(0.6)', opacity: 0 },
        ],
        { duration: DURATION_MS, easing: EASE_RISE, fill: 'forwards' },
      ))
    }
    animations.push(content.animate(
      ghost
        ? [
            { transform: `translate3d(0, ${rise}px, 0)`, opacity: 0, boxShadow: '0 -4px 18px hsl(24 50% 20% / 0.10)' },
            { opacity: 1, offset: 0.42 },
            { transform: 'translate3d(0, 0, 0)', opacity: 1, boxShadow: '0 -24px 60px hsl(24 50% 20% / 0.18)' },
          ]
        : [
            { transform: 'translate3d(0, 14px, 0)', opacity: 0 },
            { transform: 'translate3d(0, 0, 0)', opacity: 1 },
          ],
      { duration: ghost ? DURATION_MS : 320, easing: ghost ? EASE_RISE : 'cubic-bezier(0.16, 1, 0.3, 1)' },
    ))

    // Hold on the first keyframe until frames flow again: the incoming page's own
    // mount work can block the main thread and would otherwise eat the motion.
    for (const animation of animations) animation.pause()
    let startFrame = window.requestAnimationFrame(() => {
      startFrame = window.requestAnimationFrame(() => {
        for (const animation of animations) animation.play()
      })
    })

    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      window.cancelAnimationFrame(startFrame)
      for (const animation of animations) animation.cancel()
      ghost?.remove()
      content.classList.remove(SHEET_CLASS)
      if (cleanupRef.current === finish) cleanupRef.current = null
    }
    cleanupRef.current = finish
    void Promise.all(animations.map((animation) => animation.finished)).then(finish, finish)
  }, [contentRef, enabled, pathname, rootRef])

  useEffect(() => () => cleanupRef.current?.(), [])
}
