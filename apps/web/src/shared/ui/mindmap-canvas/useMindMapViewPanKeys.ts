import { useEffect } from 'react'
import {
  isEditableKeyboardTarget,
  isKeyboardOverlayTarget,
  isKeyboardShortcutSuspended,
} from '@/shared/keyboard/keyboardTargets'

/**
 * Keyboard pan for the review card: W/A/S/D move the camera, not the content.
 * The key direction is the direction the *view* travels, matching the wheel and
 * one-finger pan it sits next to (W looks further up the map).
 *
 * Speed is per second so a tap is a short step and a hold is a smooth glide;
 * browsers' own key-repeat rate never drives the motion, only the press/release
 * edges do.
 */
export const MINDMAP_KEYBOARD_PAN_SPEED_PX_PER_SEC = 600

/** A stalled tab must not teleport the camera when the frame finally lands. */
export const MINDMAP_KEYBOARD_PAN_MAX_FRAME_MS = 48

/** Screen-space camera delta per held key (`panViewportBy` adds it to the viewport). */
const PAN_KEY_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD'] as const
type PanKeyCode = (typeof PAN_KEY_CODES)[number]

const PAN_KEY_DIRECTION: Record<PanKeyCode, { x: number; y: number }> = {
  // Content moves down ⇒ the camera looks further up.
  KeyW: { x: 0, y: 1 },
  KeyS: { x: 0, y: -1 },
  // Content moves right ⇒ the camera looks further left.
  KeyA: { x: 1, y: 0 },
  KeyD: { x: -1, y: 0 },
}

export function isMindMapPanKeyCode(code: string): code is PanKeyCode {
  return (PAN_KEY_CODES as readonly string[]).includes(code)
}

/**
 * Camera delta for one frame. Opposing keys cancel, so W+S holds still.
 * Exported for tests: the frame loop stays a thin wrapper around this.
 */
export function resolveMindMapKeyboardPanDelta(
  pressed: Iterable<string>,
  elapsedMs: number,
): { x: number; y: number } {
  const clampedMs = Math.max(0, Math.min(elapsedMs, MINDMAP_KEYBOARD_PAN_MAX_FRAME_MS))
  if (clampedMs === 0) return { x: 0, y: 0 }
  let dx = 0
  let dy = 0
  for (const code of pressed) {
    if (!isMindMapPanKeyCode(code)) continue
    const direction = PAN_KEY_DIRECTION[code]
    dx += direction.x
    dy += direction.y
  }
  if (dx === 0 && dy === 0) return { x: 0, y: 0 }
  const distance = (MINDMAP_KEYBOARD_PAN_SPEED_PX_PER_SEC * clampedMs) / 1000
  return { x: dx * distance, y: dy * distance }
}

/** Some overlay owns the keys even when focus never landed inside it. */
function isAnyOverlayOpen() {
  if (typeof document === 'undefined') return false
  return Boolean(document.querySelector('[role="dialog"], [data-keyboard-shortcuts-suspended="true"]'))
}

function isPanKeyEvent(event: KeyboardEvent): event is KeyboardEvent & { code: PanKeyCode } {
  if (event.defaultPrevented || event.isComposing || event.key === 'Process') return false
  // Modifier chords belong to the browser or to tools, never to the camera.
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
  if (!isMindMapPanKeyCode(event.code)) return false
  // A focused node editor keeps its letters; so does every dialog and menu.
  if (isEditableKeyboardTarget(event.target) || isKeyboardOverlayTarget(event.target)) return false
  if (isKeyboardShortcutSuspended() || isAnyOverlayOpen()) return false
  return true
}

export interface MindMapViewPanKeysOptions {
  enabled: boolean
  /** Screen-space camera move; `useMindMapViewport().panViewportBy`. */
  panBy: (dx: number, dy: number) => void
  /** Closes the host-driven pan gesture once every key is released. */
  endPan: () => void
}

/**
 * Hold W/A/S/D to pan the mind map. Motion runs on animation frames so a hold
 * glides instead of stepping at the OS key-repeat rate, and the keyboard owner
 * is the same viewport the wheel/touch pan already moves.
 */
export function useMindMapViewPanKeys({ enabled, panBy, endPan }: MindMapViewPanKeysOptions) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined
    const pressed = new Set<PanKeyCode>()
    let frame: number | null = null
    let lastFrameAt = 0

    const stop = () => {
      pressed.clear()
      if (frame !== null) {
        window.cancelAnimationFrame(frame)
        frame = null
      }
      endPan()
    }

    const step = (now: number) => {
      frame = null
      const delta = resolveMindMapKeyboardPanDelta(pressed, now - lastFrameAt)
      lastFrameAt = now
      if (delta.x !== 0 || delta.y !== 0) panBy(delta.x, delta.y)
      if (pressed.size > 0) frame = window.requestAnimationFrame(step)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isPanKeyEvent(event)) return
      // The key belongs to the camera even when the pan is already running:
      // otherwise the browser turns it into caret/history navigation.
      event.preventDefault()
      // OS auto-repeat keeps arriving; the frame loop is the only clock.
      if (pressed.has(event.code)) return
      pressed.add(event.code)
      if (frame === null) {
        lastFrameAt = nowMs()
        frame = window.requestAnimationFrame(step)
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!isMindMapPanKeyCode(event.code)) return
      if (!pressed.delete(event.code)) return
      if (pressed.size === 0) stop()
    }

    const handleBlur = () => {
      if (pressed.size > 0) stop()
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)
    document.addEventListener('visibilitychange', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
      document.removeEventListener('visibilitychange', handleBlur)
      if (frame !== null) window.cancelAnimationFrame(frame)
      // Leaving the card mid-pan must close the gesture, or the canvas would keep
      // treating the next programmatic camera write as a user pan.
      if (pressed.size > 0) endPan()
      pressed.clear()
    }
  }, [enabled, endPan, panBy])
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
