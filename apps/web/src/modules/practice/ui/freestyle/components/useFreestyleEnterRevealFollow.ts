import { useLayoutEffect, useRef, useState } from 'react'
import type { MindMapSelection } from '@/modules/content/public'
import type { RevealState } from '@/modules/memory/public'
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
 * cards into view. Unprocessed rapid input coalesces to the latest intent, so latency cannot make
 * the cursor run ahead of the cards that were actually flipped.
 */
export function useFreestyleEnterRevealFollow({
  active,
  isEditMode,
  palaceTitle,
  unitTitle,
  anchorUid,
  revealApiRef,
}: {
  active: boolean
  isEditMode: boolean
  palaceTitle: string
  unitTitle: string
  anchorUid: string
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
    const handleTargetShortcut = (event: globalThis.KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.key !== 'Enter'
        || event.ctrlKey
        || event.altKey
        || event.metaKey
        || event.shiftKey
        || isFreestyleShortcutBlocked(event.target)
      ) {
        return
      }
      if (event.target instanceof HTMLElement && event.target.closest('button, a')) return

      event.preventDefault()
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
    isEditMode,
    palaceTitle,
    revealApiRef,
    unitTitle,
  ])

  return revealFollow
}
