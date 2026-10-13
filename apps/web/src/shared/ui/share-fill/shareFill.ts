/**
 * Part ÷ whole as a 0–1 ratio. Unknown or empty wholes read as 0, and the result is clamped
 * so a part that briefly exceeds its whole never overflows the fill.
 */
export function shareRatio(part: number | null | undefined, whole: number | null | undefined): number {
  if (part == null || whole == null || whole <= 0) return 0
  return Math.min(1, Math.max(0, part / whole))
}

/**
 * The element's own background is the progress bar: the share is painted as a translucent tint from
 * the left edge and the rest keeps the element colour, so text on top keeps its contrast.
 * Returns null when there is nothing to fill.
 */
export function shareFillBackground(ratio: number, color: string): string | null {
  const percent = Math.round(Math.min(1, Math.max(0, ratio)) * 100)
  if (percent <= 0) return null
  const tint = `color-mix(in srgb, ${color} 30%, transparent)`
  return `linear-gradient(to right, ${tint} ${percent}%, transparent ${percent}%)`
}

/** Neutral fill for bookshelf palaces and chapters: no status colour. */
export const NEUTRAL_SHARE_FILL = 'var(--color-muted-foreground)'
