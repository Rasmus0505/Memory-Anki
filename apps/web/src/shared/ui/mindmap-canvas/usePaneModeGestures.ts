import { useCallback, useEffect, useRef, type PointerEvent } from 'react'
import {
  createPaneModeGestureMachine,
  isMindMapPaneTarget,
} from './paneModeGestures'

interface UsePaneModeGesturesInput {
  onDoubleClick?: () => void
  onLongPress?: () => void
}

export function usePaneModeGestures({
  onDoubleClick,
  onLongPress,
}: UsePaneModeGesturesInput) {
  const onDoubleClickRef = useRef(onDoubleClick)
  const onLongPressRef = useRef(onLongPress)
  onDoubleClickRef.current = onDoubleClick
  onLongPressRef.current = onLongPress

  const machineRef = useRef<ReturnType<typeof createPaneModeGestureMachine> | null>(null)
  if (machineRef.current == null) {
    machineRef.current = createPaneModeGestureMachine({
      getOnDoubleClick: () => onDoubleClickRef.current,
      getOnLongPress: () => {
        const handler = onLongPressRef.current
        if (!handler) return undefined
        return () => {
          navigator.vibrate?.(35)
          handler()
        }
      },
    })
  }

  useEffect(() => {
    const machine = machineRef.current
    return () => {
      machine?.dispose()
    }
  }, [])

  const enabled = Boolean(onDoubleClick || onLongPress)

  const onPointerDownCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    machineRef.current?.pointerDown({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      isPrimary: event.isPrimary !== false,
      isPane: isMindMapPaneTarget(event.target),
    })
  }, [enabled])

  const onPointerMoveCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    machineRef.current?.pointerMove({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    })
  }, [enabled])

  const onPointerUpCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    machineRef.current?.pointerUp({
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      isPane: isMindMapPaneTarget(event.target),
    })
  }, [enabled])

  const onPointerCancelCapture = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    machineRef.current?.pointerCancel({ pointerId: event.pointerId })
  }, [enabled])

  if (!enabled) {
    return {
      onPointerDownCapture: undefined,
      onPointerMoveCapture: undefined,
      onPointerUpCapture: undefined,
      onPointerCancelCapture: undefined,
    }
  }

  return {
    onPointerDownCapture,
    onPointerMoveCapture,
    onPointerUpCapture,
    onPointerCancelCapture,
  }
}
