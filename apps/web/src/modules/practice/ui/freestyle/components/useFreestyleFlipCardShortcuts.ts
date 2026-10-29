import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MindMapSelection } from '@/modules/content/public'
import type { RevealState } from '@/modules/memory/public'
import {
  useMemoryAnkiShortcuts,
  type MemoryAnkiShortcutHandlers,
} from '@/modules/settings/public'
import { useRouteResidency } from '@/shared/routing/RouteResidency'

export interface FreestyleFlipRevealApi {
  revealMap: Record<string, RevealState>
  applyTargetRevealFrom: (
    baseMap: Record<string, RevealState>,
    nodes: MindMapSelection[],
  ) => { nextRevealMap: Record<string, RevealState>; changedIds: readonly string[] } | null
  retractTarget: (nodes: MindMapSelection[]) => boolean
  handleNodeContextMenu: (nodes: MindMapSelection[]) => void
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

/** A focused control keeps Enter/Backspace; the card must not steal them. */
function isKeyboardControlTarget(event: KeyboardEvent) {
  return (
    event.target instanceof Element
    && Boolean(event.target.closest('button, a, [role="button"], [role="menuitem"]'))
  )
}

export interface FreestyleFlipFollowState {
  nodeIds: string[]
  nonce: number
}

/**
 * Flip-card shortcuts for the 随心 card: 翻卡 (anchor reveal + optional camera
 * follow), 收卡 and Shift+H hide. Bindings come from the shared flip shortcut
 * map (翻卡设置 → 快捷键). W/A/S/D belong to the canvas view pan, never here.
 */
export function useFreestyleFlipCardShortcuts({
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
  revealApiRef: { readonly current: FreestyleFlipRevealApi }
  followEnabled?: boolean
}): FreestyleFlipFollowState {
  const trimmedAnchor = anchorUid.trim()
  const [revealFollow, setRevealFollow] = useState<FreestyleFlipFollowState>({
    nodeIds: [],
    nonce: 0,
  })
  const followNonceRef = useRef(0)

  useEffect(() => {
    if (!active) return
    releaseUnitSwitchFocus()
  }, [active])

  const followReveal = useCallback((changedIds: readonly string[]) => {
    if (!followEnabled || changedIds.length === 0) return
    followNonceRef.current += 1
    setRevealFollow({ nodeIds: [...changedIds], nonce: followNonceRef.current })
  }, [followEnabled])

  const handlers = useMemo<MemoryAnkiShortcutHandlers>(() => {
    const targetSelection = (): MindMapSelection => ({
      uid: trimmedAnchor,
      text: unitTitle || palaceTitle || '复习目标',
      note: '',
      memoryAnkiId: null,
      memoryAnkiNodeType: null,
      rawData: {},
    })

    return {
      flip_current_card: (event) => {
        if (isKeyboardControlTarget(event)) return false
        const plan = revealApiRef.current.applyTargetRevealFrom(
          revealApiRef.current.revealMap,
          [targetSelection()],
        )
        // Enter belongs to the card even when the flip was already complete.
        if (!plan || plan.changedIds.length === 0) return true
        followReveal(plan.changedIds)
        return true
      },
      retract_current_card: (event) => {
        if (isKeyboardControlTarget(event)) return false
        return revealApiRef.current.retractTarget([targetSelection()])
      },
      hide_child_cards: () => {
        revealApiRef.current.handleNodeContextMenu([targetSelection()])
        return true
      },
    }
  }, [followReveal, palaceTitle, revealApiRef, trimmedAnchor, unitTitle])

  // A resident page must not flip cards while the learner is on another route.
  const { isActive: routeActive } = useRouteResidency()
  useMemoryAnkiShortcuts(
    'flip',
    handlers,
    routeActive && active && !isEditMode && Boolean(trimmedAnchor),
  )

  return revealFollow
}
