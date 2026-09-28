import { useLayoutEffect, useRef, useState } from 'react'
import type { MindMapSelection } from '@/modules/content/public'
import type { RevealState } from '@/modules/session/public'
import { isFreestyleShortcutBlocked } from '@/modules/practice/ui/freestyle/model/freestyleKeyboard'

export interface FreestyleEnterRevealApi {
  revealMap: Record<string, RevealState>
  applyTargetRevealFrom: (
    baseMap: Record<string, RevealState>,
    nodes: MindMapSelection[],
  ) => { nextRevealMap: Record<string, RevealState>; changedIds: readonly string[] } | null
}

/**
 * Enter flips the unit anchor and asks the canvas to pan the newly revealed
 * cards into view. Shift hides descendants and does not move the camera.
 * Unprocessed rapid input coalesces to the latest intent, so latency cannot make
 * the cursor run ahead of the cards that were actually flipped.
 */
export function useFreestyleEnterRevealFollow({
  active,
  isEditMode,
  palaceTitle,
  unitTitle,
  anchorUid,
  rootId,
  rootText,
  handleNodeContextMenu,
  revealApiRef,
}: {
  active: boolean
  isEditMode: boolean
  palaceTitle: string
  unitTitle: string
  anchorUid: string
  rootId: string
  rootText: string
  handleNodeContextMenu: (nodes: MindMapSelection[]) => void
  revealApiRef: { readonly current: FreestyleEnterRevealApi }
}) {
  const revealFollowNonceRef = useRef(0)
  const [revealFollow, setRevealFollow] = useState<{ nodeIds: string[]; nonce: number }>({
    nodeIds: [],
    nonce: 0,
  })

  useLayoutEffect(() => {
    if (!active || isEditMode) return
    const trimmedAnchor = anchorUid.trim()
    if (!trimmedAnchor) return

    const targetSelection: MindMapSelection = {
      uid: trimmedAnchor,
      text: unitTitle || palaceTitle || '复习目标',
      note: '',
      memoryAnkiId: null,
      memoryAnkiNodeType: null,
      rawData: {},
    }
    const rootSelection: MindMapSelection = {
      ...targetSelection,
      uid: rootId,
      text: rootText || palaceTitle || '宫殿',
    }
    const handleTargetShortcut = (event: globalThis.KeyboardEvent) => {
      const isEnter = event.key === 'Enter'
      const isShift = event.key === 'Shift'
      if (
        event.defaultPrevented
        || (!isEnter && !isShift)
        || event.ctrlKey
        || event.altKey
        || event.metaKey
        || (isEnter && event.shiftKey)
        || (isShift && event.repeat)
        || isFreestyleShortcutBlocked(event.target)
      ) {
        return
      }
      if (event.target instanceof HTMLElement && event.target.closest('button, a')) return

      event.preventDefault()
      if (isShift) {
        // Right-clicking the root hides every descendant while retaining the
        // root card, which is the keyboard equivalent of returning to root.
        handleNodeContextMenu([rootSelection])
        return
      }
      const plan = revealApiRef.current.applyTargetRevealFrom(
        revealApiRef.current.revealMap,
        [targetSelection],
      )
      if (!plan || plan.changedIds.length === 0) return
      revealFollowNonceRef.current += 1
      setRevealFollow({
        nodeIds: [...plan.changedIds],
        nonce: revealFollowNonceRef.current,
      })
    }

    window.addEventListener('keydown', handleTargetShortcut, true)
    return () => window.removeEventListener('keydown', handleTargetShortcut, true)
  }, [
    active,
    anchorUid,
    handleNodeContextMenu,
    isEditMode,
    palaceTitle,
    revealApiRef,
    rootId,
    rootText,
    unitTitle,
  ])

  return revealFollow
}
