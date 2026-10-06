import { useEffect, useRef, type RefObject } from 'react'
import {
  consumeFreestyleWheel,
  elementCanConsumeWheel,
  idleFreestyleWheelPaging,
} from '@/modules/practice/ui/freestyle/model/freestyleWheelPaging'

/**
 * One wheel notch pages the feed. Native snap must not see the delta, or a
 * partial notch is pulled back to the current page and the wheel feels stuck.
 */
export function useFreestyleWheelPaging(
  scrollRef: RefObject<HTMLElement | null>,
  attachKey: unknown,
  navigateNext: () => void,
  navigatePrevious: () => void,
) {
  const navigateNextRef = useRef(navigateNext)
  const navigatePreviousRef = useRef(navigatePrevious)
  navigateNextRef.current = navigateNext
  navigatePreviousRef.current = navigatePrevious

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    let paging = idleFreestyleWheelPaging()
    const onWheel = (event: WheelEvent) => {
      const target = event.target
      const inside = target instanceof Element && node.contains(target)
      // The review map pans on wheel and stops the event itself.
      if (inside && target.closest('.react-flow')) return
      let cursor: Element | null = inside ? target : null
      while (cursor && cursor !== node) {
        if (cursor instanceof HTMLElement && elementCanConsumeWheel(cursor, event.deltaY)) return
        cursor = cursor.parentElement
      }
      // An editor marked nowheel must not page the feed or let snap drift.
      if (inside && target.closest('.nowheel')) {
        event.preventDefault()
        return
      }
      const consumed = consumeFreestyleWheel(paging, event, performance.now())
      paging = consumed.next
      if (consumed.decision === 'ignore') return
      event.preventDefault()
      if (consumed.decision !== 'page') return
      if (consumed.direction > 0) navigateNextRef.current()
      else navigatePreviousRef.current()
    }
    node.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => node.removeEventListener('wheel', onWheel, true)
  }, [attachKey, scrollRef])
}
