/** Flip-card progress chip for freestyle unit header (revealed / total). */

export type FlipProgressTone = 'empty' | 'partial' | 'complete'

export type FlipProgress = {
  revealed: number
  total: number
}

export function normalizeFlipProgress(revealed: number, total: number): FlipProgress {
  const safeTotal = Math.max(0, Math.round(Number(total) || 0))
  const safeRevealed = Math.max(0, Math.min(safeTotal, Math.round(Number(revealed) || 0)))
  return { revealed: safeRevealed, total: safeTotal }
}

/** 0 flipped → red; partial → yellow; all flipped → green. */
export function flipProgressTone(revealed: number, total: number): FlipProgressTone {
  const progress = normalizeFlipProgress(revealed, total)
  if (progress.total <= 0 || progress.revealed >= progress.total) return 'complete'
  if (progress.revealed <= 0) return 'empty'
  return 'partial'
}

export function flipProgressLabel(revealed: number, total: number): string {
  const progress = normalizeFlipProgress(revealed, total)
  return `${progress.revealed}/${progress.total}`
}

/**
 * Tones read on the light unit-identity chip (white/88 over the card's #f7f5f2).
 * They used to be `text-*-100` from when the badge floated on the dark immersive
 * backdrop; over white that rendered as an empty coloured pill with no legible
 * digits. Text is now the dark end of each ramp with the fill kept light.
 */
export function flipProgressToneClass(tone: FlipProgressTone): string {
  switch (tone) {
    case 'complete':
      return 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700'
    case 'partial':
      return 'border-amber-500/40 bg-amber-400/18 text-amber-700'
    case 'empty':
    default:
      return 'border-rose-500/35 bg-rose-500/12 text-rose-700'
  }
}

export function flipProgressTitle(revealed: number, total: number): string {
  const progress = normalizeFlipProgress(revealed, total)
  if (progress.total <= 0) return '本单元无需翻卡'
  if (progress.revealed >= progress.total) return `翻卡完成 ${progress.revealed}/${progress.total}`
  if (progress.revealed <= 0) return `尚未翻卡 0/${progress.total}`
  return `已翻 ${progress.revealed} / 需翻 ${progress.total}`
}
