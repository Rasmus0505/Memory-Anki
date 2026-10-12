import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { useUpdateNodeInternals } from '@xyflow/react'
import type { NodeSize } from './layout'
import { MEASURE_DELTA_PX } from './nodeCardModel'

export function useNodeCardMeasure(options: {
  id: string
  shellRef: RefObject<HTMLDivElement | null>
  onMeasure?: (nodeId: string, size: NodeSize) => void
}) {
  const { id, shellRef, onMeasure } = options
  const lastMeasuredRef = useRef<NodeSize | null>(null)
  const updateNodeInternals = useUpdateNodeInternals()

  const reportMeasuredSize = useCallback(
    (width: number, height: number) => {
      if (width <= 0 || height <= 0) return

      const nextSize = { width, height }
      const previousSize = lastMeasuredRef.current
      if (
        previousSize &&
        Math.abs(previousSize.width - nextSize.width) <= MEASURE_DELTA_PX &&
        Math.abs(previousSize.height - nextSize.height) <= MEASURE_DELTA_PX
      ) {
        return
      }

      lastMeasuredRef.current = nextSize
      onMeasure?.(id, nextSize)
      updateNodeInternals(id)
    },
    [id, onMeasure, updateNodeInternals],
  )

  useLayoutEffect(() => {
    const element = shellRef.current
    if (!element) return undefined

    const measure = () => {
      // Prefer untransformed layout size. getBoundingClientRect() includes React Flow
      // viewport zoom and can thrash measure→layout→zoom loops during review.
      const width = element.offsetWidth
      const height = element.offsetHeight
      if (width > 0 && height > 0) {
        reportMeasuredSize(width, height)
        return
      }
      const rect = element.getBoundingClientRect()
      reportMeasuredSize(rect.width, rect.height)
    }

    measure()
    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [reportMeasuredSize, shellRef])
}
