import { useLayoutEffect, useRef, type RefObject } from 'react'

const ROUTE_ENTER_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: 'translate3d(0, 10px, 0)' },
  { opacity: 1, transform: 'translate3d(0, 0, 0)' },
]

// Replays on pathname change without remounting the route tree, so page state survives.
export function useRouteEnterAnimation(target: RefObject<HTMLElement | null>, routeKey: string, enabled: boolean) {
  const previousKey = useRef(routeKey)

  useLayoutEffect(() => {
    if (previousKey.current === routeKey) return
    previousKey.current = routeKey
    const element = target.current
    if (!enabled || !element || typeof element.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const animation = element.animate(ROUTE_ENTER_KEYFRAMES, {
      duration: 320,
      easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    })
    return () => animation.cancel()
  }, [enabled, routeKey, target])
}
