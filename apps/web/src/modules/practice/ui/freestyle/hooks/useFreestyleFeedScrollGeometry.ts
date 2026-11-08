import { useEffect, type RefObject } from 'react'

/** Keep depth-stack keyframes in the same geometry as the live feed viewport. */
export function useFreestyleFeedScrollGeometry({
  scrollRef,
  pageHeightRef,
  attachKey,
}: {
  scrollRef: RefObject<HTMLElement | null>
  pageHeightRef: RefObject<number>
  attachKey: unknown
}) {
  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    const updatePageHeight = () => {
      pageHeightRef.current = node.clientHeight
      node.style.setProperty('--fs-page-h', `${node.clientHeight}px`)
    }
    updatePageHeight()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePageHeight)
    observer?.observe(node)
    window.visualViewport?.addEventListener('resize', updatePageHeight)
    window.addEventListener('resize', updatePageHeight)
    return () => {
      observer?.disconnect()
      window.visualViewport?.removeEventListener('resize', updatePageHeight)
      window.removeEventListener('resize', updatePageHeight)
    }
  }, [attachKey, pageHeightRef, scrollRef])
}
