export interface SlotRect {
  node: HTMLElement
  left: number
  right: number
}

export function railSlots(rail: HTMLElement): HTMLElement[] {
  return Array.from(rail.querySelectorAll<HTMLElement>('[data-rail-slot]'))
}

/** Card ids can contain `:` and other selector syntax, so match on the dataset instead. */
export function railSlot(rail: HTMLElement, cardId: string): HTMLElement | null {
  return railSlots(rail).find((node) => node.dataset.railSlot === cardId) ?? null
}

export function measureRailSlots(rail: HTMLElement): Map<string, SlotRect> {
  const railLeft = rail.getBoundingClientRect().left
  const map = new Map<string, SlotRect>()
  for (const node of railSlots(rail)) {
    const id = node.dataset.railSlot
    if (!id) continue
    const rect = node.getBoundingClientRect()
    map.set(id, { node, left: rect.left - railLeft, right: rect.right - railLeft })
  }
  return map
}

/** Padding beside a tick still belongs to that tick; a wide miss opens 本轮安排. */
const RAIL_JUMP_SLACK_PX = 12

export function cardIdAtRailPointer(
  rail: HTMLElement,
  event: { target: EventTarget | null; clientX: number },
): string | null {
  const target = event.target instanceof Element ? event.target : null
  const direct = target?.closest<HTMLElement>('[data-rail-slot]')?.dataset.railSlot
  if (direct) return direct
  const x = event.clientX
  let nearestId: string | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const node of railSlots(rail)) {
    const id = node.dataset.railSlot
    if (!id) continue
    const rect = node.getBoundingClientRect()
    if (x >= rect.left && x <= rect.right) return id
    const distance = x < rect.left ? rect.left - x : x - rect.right
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestId = id
    }
  }
  return nearestId != null && nearestDistance <= RAIL_JUMP_SLACK_PX ? nearestId : null
}

/** One x-range per contiguous run of a just-cleared palace, relative to the rail. */
export function clearedPalaceRanges(
  rail: HTMLElement,
  cleared: ReadonlySet<string>,
): Array<{ left: number; width: number }> {
  const railLeft = rail.getBoundingClientRect().left
  const ranges: Array<{ left: number; width: number }> = []
  let runPalace: string | null = null
  let runLeft = 0
  let runRight = 0
  const flush = () => {
    if (runPalace != null) ranges.push({ left: runLeft, width: Math.max(4, runRight - runLeft) })
    runPalace = null
  }
  for (const node of railSlots(rail)) {
    const palace = node.dataset.railPalace ?? ''
    if (!palace || !cleared.has(palace)) {
      flush()
      continue
    }
    const rect = node.getBoundingClientRect()
    if (runPalace !== palace) {
      flush()
      runPalace = palace
      runLeft = rect.left - railLeft
    }
    runRight = rect.right - railLeft
  }
  flush()
  return ranges
}
