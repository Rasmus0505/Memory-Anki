import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import {
  LONG_PRESS_DELAY_MS,
  LONG_PRESS_MOVE_TOLERANCE_PX,
  SYNTHETIC_CONTEXT_MENU_WINDOW_MS,
} from './nodeCardModel'

interface UseNodeCardLongPressInput {
  nodeId: string
  /**
   * When false, long-press is disabled (e.g. node is mid text-edit so native selection wins).
   * Parent also omits `onTouchLongPress` when the canvas scene does not support it.
   */
  enabled?: boolean
  onTouchLongPress?: (nodeId: string, point: { x: number; y: number }) => void
}

/**
 * Touch long-press → context action (practice hide / edit menu), with synthetic contextmenu suppression.
 * Desktop mouse uses native right-click; this path is for touch/pen (PWA).
 */
export function useNodeCardLongPress({
  nodeId,
  enabled = true,
  onTouchLongPress,
}: UseNodeCardLongPressInput) {
  const longPressTimerRef = useRef<number | null>(null)
  const longPressStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const longPressTriggeredRef = useRef(false)
  const suppressSyntheticContextMenuUntilRef = useRef(0)
  const [longPressPending, setLongPressPending] = useState(false)

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
    longPressStartRef.current = null
    setLongPressPending(false)
  }, [])

  const abortLongPress = useCallback(() => {
    clearLongPress()
    longPressTriggeredRef.current = false
  }, [clearLongPress])

  useEffect(() => {
    return () => {
      abortLongPress()
    }
  }, [abortLongPress])

  const triggerLongPress = useCallback(
    (point: { x: number; y: number }) => {
      longPressTriggeredRef.current = true
      suppressSyntheticContextMenuUntilRef.current = Date.now() + SYNTHETIC_CONTEXT_MENU_WINDOW_MS
      setLongPressPending(false)
      navigator.vibrate?.(35)
      onTouchLongPress?.(nodeId, point)
    },
    [nodeId, onTouchLongPress],
  )

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const pointerType = event.pointerType || 'touch'
      if (
        !enabled
        || !onTouchLongPress
        || pointerType === 'mouse'
        || event.isPrimary === false
      ) {
        return
      }
      clearLongPress()
      longPressTriggeredRef.current = false
      longPressStartRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setLongPressPending(true)
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null
        triggerLongPress({
          x: longPressStartRef.current?.x ?? event.clientX,
          y: longPressStartRef.current?.y ?? event.clientY,
        })
      }, LONG_PRESS_DELAY_MS)
    },
    [clearLongPress, enabled, onTouchLongPress, triggerLongPress],
  )

  const finishPointerInteraction = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      clearLongPress()
    },
    [clearLongPress],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (longPressTriggeredRef.current) return
      const start = longPressStartRef.current
      if (!start || event.pointerId !== start.pointerId) return
      const movedTooFar =
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_MOVE_TOLERANCE_PX
      if (movedTooFar) abortLongPress()
    },
    [abortLongPress],
  )

  const handleClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!longPressTriggeredRef.current) return
    event.preventDefault()
    event.stopPropagation()
    longPressTriggeredRef.current = false
  }, [])

  const handleContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    const nativeEvent = event.nativeEvent as globalThis.MouseEvent & {
      pointerType?: string
      sourceCapabilities?: { firesTouchEvents?: boolean } | null
    }
    const isSyntheticTouchContextMenu =
      nativeEvent.pointerType === 'touch' ||
      nativeEvent.sourceCapabilities?.firesTouchEvents === true
    const shouldSuppressSyntheticContextMenu =
      isSyntheticTouchContextMenu && Date.now() <= suppressSyntheticContextMenuUntilRef.current

    if (!shouldSuppressSyntheticContextMenu) return
    event.preventDefault()
    event.stopPropagation()
    suppressSyntheticContextMenuUntilRef.current = 0
  }, [])

  return {
    longPressPending,
    handlePointerDown,
    handlePointerMove,
    finishPointerInteraction,
    handleClick,
    handleContextMenu,
  }
}
