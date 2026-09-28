import { useLayoutEffect, useRef, useState } from 'react'

export function fitPageSize(height: number, itemHeight: number, gap: number, fallback: number) {
  if (!(height > 0)) return fallback
  return Math.max(1, Math.floor((height + gap) / (itemHeight + gap)))
}

// 列表容器高度由 flex 父级决定，按实际可用高度算每页条数，保证整页不滚动。
export function useFitPageSize<T extends HTMLElement>(itemHeight: number, gap: number, fallback: number) {
  const ref = useRef<T>(null)
  const [pageSize, setPageSize] = useState(fallback)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setPageSize(fitPageSize(element.clientHeight, itemHeight, gap, fallback))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [itemHeight, gap, fallback])

  return { ref, pageSize }
}
