import * as React from 'react'
import {
  calculateResizedTimerOverlayLayout,
  TIMER_DRAG_CLICK_THRESHOLD_PX,
  type ResizeHandleDirection,
  type TimerResizeState,
} from '@/shared/components/session/globalTimerModel'
import type { TimerOverlayLayout } from '@/shared/components/session/timer-overlay-layout'

type PersistLayout = (nextLayout: TimerOverlayLayout | ((current: TimerOverlayLayout) => TimerOverlayLayout)) => void

export function useTimerOverlayDrag(layout: TimerOverlayLayout, persistLayout: PersistLayout) {
  const dragStateRef = React.useRef<{
    startX: number
    startY: number
    originX: number
    originY: number
  } | null>(null)
  const resizeStateRef = React.useRef<TimerResizeState | null>(null)
  const suppressCapsuleClickRef = React.useRef(false)

  const beginDrag = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('[data-timer-overlay-control="true"]')
    ) {
      return
    }
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: layout.x,
      originY: layout.y,
    }
    suppressCapsuleClickRef.current = false
    if ('setPointerCapture' in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }, [layout.x, layout.y])

  const beginResize = React.useCallback((direction: ResizeHandleDirection, event: React.PointerEvent<HTMLButtonElement>) => {
    resizeStateRef.current = {
      direction,
      startX: event.clientX,
      startY: event.clientY,
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    }
    if ('setPointerCapture' in event.currentTarget) {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    event.stopPropagation()
  }, [layout.height, layout.width, layout.x, layout.y])

  const handlePointerMove = React.useCallback((clientX: number, clientY: number) => {
    if (dragStateRef.current) {
      const deltaX = clientX - dragStateRef.current.startX
      const deltaY = clientY - dragStateRef.current.startY
      const dragState = dragStateRef.current
      if (Math.abs(deltaX) > TIMER_DRAG_CLICK_THRESHOLD_PX || Math.abs(deltaY) > TIMER_DRAG_CLICK_THRESHOLD_PX) {
        suppressCapsuleClickRef.current = true
      }
      persistLayout((current) => ({
        ...current,
        x: (dragState?.originX ?? current.x) + deltaX,
        y: (dragState?.originY ?? current.y) + deltaY,
      }))
    }

    if (resizeStateRef.current) {
      const nextLayout = calculateResizedTimerOverlayLayout(
        resizeStateRef.current,
        clientX,
        clientY,
        window.innerWidth,
        window.innerHeight,
      )

      persistLayout((current) => ({
        ...current,
        ...nextLayout,
      }))
    }
  }, [persistLayout])

  const handlePointerMoveEvent = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    handlePointerMove(event.clientX, event.clientY)
  }, [handlePointerMove])

  const stopPointerInteraction = React.useCallback(() => {
    dragStateRef.current = null
    resizeStateRef.current = null
  }, [])

  React.useEffect(() => {
    const handleWindowPointerMove = (event: PointerEvent) => {
      handlePointerMove(event.clientX, event.clientY)
    }
    const handleWindowPointerUp = () => {
      stopPointerInteraction()
    }

    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerUp)
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove)
      window.removeEventListener('pointerup', handleWindowPointerUp)
      window.removeEventListener('pointercancel', handleWindowPointerUp)
    }
  }, [handlePointerMove, stopPointerInteraction])

  const toggleCollapsed = React.useCallback(() => {
    persistLayout((current) => ({
      ...current,
      collapsed: !current.collapsed,
    }))
  }, [persistLayout])


  return {
    beginDrag,
    beginResize,
    handlePointerMoveEvent,
    stopPointerInteraction,
    toggleCollapsed,
    suppressCapsuleClickRef,
  }
}
