import { CARD_DOUBLE_CLICK_MS } from './nodeCardModel'

/**
 * Enter-edit is one gesture, owned here — not by whichever child happens to
 * receive `dblclick`.
 *
 * Yellow emphasis, article text, and `user-select: none` make Chrome drop the
 * second click of a double-click (or retarget it to the pane behind the card).
 * Only the empty padding, usually the bottom-right corner, used to produce a
 * real `dblclick`. Callers arm the card box on the first press and complete
 * the gesture from a window capture listener when the second press misses the
 * card but still lands inside that box.
 */

export const CARD_EDIT_CONTROL_SELECTOR = [
  '[data-mindmap-collapse-toggle]',
  '[data-quiz-count-badge]',
  '[data-extract-handle]',
  '[data-mindmap-card-control]',
].join(', ')

export interface CardEditPressRect {
  left: number
  top: number
  right: number
  bottom: number
}

const FELL_THROUGH_SLOP_PX = 4

type ArmedPress = { at: number; rect: CardEditPressRect }
type Completer = (point: { x: number; y: number }) => void

const armedPresses = new Map<string, ArmedPress>()
const completers = new Map<string, Completer>()
let listening = false
let editGestureEpoch = 0
let suppressPaneDblClickUntil = 0

export function isCardEditControlTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null
  return Boolean(element?.closest(CARD_EDIT_CONTROL_SELECTOR))
}

export function pointInsideCardRect(
  x: number,
  y: number,
  rect: CardEditPressRect,
  slop = FELL_THROUGH_SLOP_PX,
): boolean {
  return x >= rect.left - slop
    && x <= rect.right + slop
    && y >= rect.top - slop
    && y <= rect.bottom + slop
}

export function noteCardEditStarted() {
  editGestureEpoch += 1
}

/**
 * Editable English cards defer word lookup so a double-click can enter edit
 * instead of also opening the dictionary. Readonly review stays immediate.
 */
export function scheduleEditableWordClick(run: () => void) {
  const epoch = editGestureEpoch
  window.setTimeout(() => {
    if (epoch !== editGestureEpoch) return
    run()
  }, CARD_DOUBLE_CLICK_MS)
}

export function armCardEditPress(nodeId: string, rect: CardEditPressRect, now = Date.now()) {
  if (rect.right - rect.left < 1 || rect.bottom - rect.top < 1) return
  armedPresses.set(nodeId, { at: now, rect })
}

export function disarmCardEditPress(nodeId: string) {
  armedPresses.delete(nodeId)
}

export function registerCardEditCompleter(nodeId: string, completer: Completer) {
  completers.set(nodeId, completer)
  ensureFellThroughListener()
  return () => {
    completers.delete(nodeId)
    armedPresses.delete(nodeId)
    if (completers.size === 0) removeFellThroughListener()
  }
}

export function resetCardEditGestureState() {
  armedPresses.clear()
  editGestureEpoch += 1
  suppressPaneDblClickUntil = 0
}

function ensureFellThroughListener() {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('pointerdown', onWindowPointerDown, true)
  window.addEventListener('dblclick', onWindowDblClick, true)
}

function removeFellThroughListener() {
  if (!listening || typeof window === 'undefined') return
  listening = false
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
  window.removeEventListener('dblclick', onWindowDblClick, true)
}

function onWindowPointerDown(event: PointerEvent) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return
  if (!event.pointerType && event.clientX === 0 && event.clientY === 0) return
  if (isCardEditControlTarget(event.target)) return
  const target = event.target instanceof Element ? event.target : null
  // Presses that hit the card are owned by the card's capture listener.
  if (target?.closest('[data-mindmap-node-id]')) return
  const now = Date.now()
  for (const [nodeId, press] of armedPresses) {
    if (now - press.at > CARD_DOUBLE_CLICK_MS || now < press.at) {
      armedPresses.delete(nodeId)
      continue
    }
    if (!pointInsideCardRect(event.clientX, event.clientY, press.rect)) continue
    armedPresses.delete(nodeId)
    suppressPaneDblClickUntil = now + 80
    event.preventDefault()
    event.stopPropagation()
    completers.get(nodeId)?.({ x: event.clientX, y: event.clientY })
    return
  }
}

function onWindowDblClick(event: MouseEvent) {
  if (Date.now() > suppressPaneDblClickUntil) return
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('[data-mindmap-node-id]')) return
  event.preventDefault()
  event.stopPropagation()
}
