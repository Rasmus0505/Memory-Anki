/**
 * Per-page stream of the feed's continuous scroll position, so chrome outside the
 * scroller (progress rail) can follow the finger without React re-renders.
 * Scoped per page instance: freestyle and 随心 2 can both stay mounted.
 */
export interface FreestyleScrollFrame {
  /** Card id of the slot the viewport is leaving (top slot), null for the closing slot. */
  fromCardId: string | null
  /** Card id of the slot entering from below, null when none or the closing slot. */
  toCardId: string | null
  /** 0 = resting on `from`, 1 = resting on `to`. */
  t: number
  /** True once the gesture or animated scroll has settled. */
  settled: boolean
}

export interface FreestyleScrollChannel {
  publish(frame: FreestyleScrollFrame): void
  read(): FreestyleScrollFrame | null
  subscribe(listener: (frame: FreestyleScrollFrame) => void): () => void
}

export function createFreestyleScrollChannel(): FreestyleScrollChannel {
  let current: FreestyleScrollFrame | null = null
  const listeners = new Set<(frame: FreestyleScrollFrame) => void>()
  return {
    publish(frame) {
      current = frame
      listeners.forEach((listener) => listener(frame))
    },
    read() {
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** Maps a fractional slot position (scrollTop / pageHeight) onto card ids. */
export function scrollFrameFromPosition(
  position: number,
  cardIds: readonly string[],
  settled: boolean,
): FreestyleScrollFrame {
  const maxSlot = cardIds.length
  const clamped = Math.max(0, Math.min(maxSlot, position))
  const base = Math.floor(clamped)
  const t = clamped - base
  return {
    fromCardId: cardIds[base] ?? null,
    toCardId: t > 0 ? cardIds[base + 1] ?? null : null,
    t: t > 0 && cardIds[base + 1] == null ? 0 : t,
    settled,
  }
}
