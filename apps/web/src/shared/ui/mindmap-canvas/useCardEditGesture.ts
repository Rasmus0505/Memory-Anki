import { useEffect, useRef, type RefObject } from 'react'
import {
  armCardEditPress,
  disarmCardEditPress,
  isCardEditControlTarget,
  registerCardEditCompleter,
} from './cardEditGesture'
import { consumeCardDoubleClick } from './nodeCardModel'

interface UseCardEditGestureInput {
  nodeId: string
  shellRef: RefObject<HTMLElement | null>
  enabled: boolean
  /** English word lookup must keep the first press; only the second press edits. */
  blockNativeTextSelection: boolean
  onSecondPress: (point: { x: number; y: number }) => void
}

/**
 * Capture-phase owner for "double-click this card to edit".
 * Children, highlight markup, and React Flow drag cannot swallow the press
 * before it is counted. A second press that Chrome retargets off the card is
 * completed by the window listener in `cardEditGesture`.
 */
export function useCardEditGesture({
  nodeId,
  shellRef,
  enabled,
  blockNativeTextSelection,
  onSecondPress,
}: UseCardEditGestureInput) {
  const onSecondPressRef = useRef(onSecondPress)
  onSecondPressRef.current = onSecondPress

  useEffect(() => {
    if (!enabled) return undefined
    const shell = shellRef.current
    if (!shell) return undefined
    let lastCompleteAt = 0

    const complete = (point: { x: number; y: number }) => {
      const now = Date.now()
      if (now - lastCompleteAt < 80) return
      lastCompleteAt = now
      disarmCardEditPress(nodeId)
      onSecondPressRef.current(point)
    }

    const onPointerDown = (event: PointerEvent) => {
      const pointerType = event.pointerType || 'mouse'
      const button = event.button ?? 0
      if (button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return
      if (event.type === 'pointerdown' && !event.pointerType) return
      if (pointerType !== 'mouse' && pointerType !== 'pen') return
      if (isCardEditControlTarget(event.target)) {
        disarmCardEditPress(nodeId)
        return
      }
      const followUp = event.detail > 1 || consumeCardDoubleClick(nodeId)
      if (!followUp) {
        const rect = shell.getBoundingClientRect()
        armCardEditPress(nodeId, {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        })
        return
      }
      event.preventDefault()
      event.stopPropagation()
      complete({ x: event.clientX, y: event.clientY })
    }

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || isCardEditControlTarget(event.target)) return
      const target = event.target instanceof Element ? event.target : null
      const onText = Boolean(
        target?.closest('.mindmap-node-text, [data-emphasis="highlight"], .mindmap-rich-text'),
      )
      // Stop the native word-selection that makes Chrome drop dblclick on yellow text.
      if (blockNativeTextSelection && onText) event.preventDefault()
      if (event.detail > 1) {
        event.preventDefault()
        event.stopPropagation()
        complete({ x: event.clientX, y: event.clientY })
      }
    }

    shell.addEventListener('pointerdown', onPointerDown, true)
    shell.addEventListener('mousedown', onMouseDown, true)
    const unregister = registerCardEditCompleter(nodeId, complete)
    return () => {
      shell.removeEventListener('pointerdown', onPointerDown, true)
      shell.removeEventListener('mousedown', onMouseDown, true)
      unregister()
    }
  }, [blockNativeTextSelection, enabled, nodeId, shellRef])
}
