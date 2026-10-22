import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
 * The card is the keyboard surface. A unit-switch control keeps browser focus
 * after it was clicked, and while the next unit is still loading Enter would
 * activate that control again (one more unit) instead of flipping. Release the
 * focus as soon as the card owns the screen so Enter belongs to the card.
 */
function releaseUnitSwitchFocus() {
  const element = document.activeElement
  if (!(element instanceof HTMLElement) || element === document.body) return
  if (element.closest('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')) return
  if (!(element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement)) return
  element.blur()
}

/**
 * Enter flips the unit anchor and asks the canvas to pan the newly revealed
 * cards into view. Unprocessed rapid input coalesces to the latest intent, so latency cannot make
 * the cursor run ahead of the cards that were actually flipped.
 *
 * `followEnabled` only controls the camera: with it off the same flips happen and
 * the viewport stays where the learner left it.
 */
export function useFreestyleEnterRevealFollow({
  active,
  isEditMode,
  palaceTitle,
  unitTitle,
  anchorUid,
  revealApiRef,
  followEnabled = true,
}: {
  active: boolean
  isEditMode: boolean
  palaceTitle: string
  unitTitle: string
  anchorUid: string
  revealApiRef: { readonly current: FreestyleEnterRevealApi }
  followEnabled?: boolean
}) {
  const revealFollowNonceRef = useRef(0)
  const [revealFollow, setRevealFollow] = useState<{ nodeIds: string[]; nonce: number }>({
    nodeIds: [],
    nonce: 0,
  })

  useEffect(() => {
    if (!active) return
    releaseUnitSwitchFocus()
  }, [active])

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
      if (!followEnabled) return
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
    followEnabled,
    isEditMode,
    palaceTitle,
    revealApiRef,
    unitTitle,
  ])

  return revealFollow
}
