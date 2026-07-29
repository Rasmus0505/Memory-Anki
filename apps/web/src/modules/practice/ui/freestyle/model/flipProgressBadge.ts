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

export function flipProgressToneClass(tone: FlipProgressTone): string {
  switch (tone) {
    case 'complete':
      return 'border-emerald-400/45 bg-emerald-400/18 text-emerald-100'
    case 'partial':
      return 'border-amber-300/45 bg-amber-300/18 text-amber-50'
    case 'empty':
    default:
      return 'border-rose-400/45 bg-rose-400/18 text-rose-100'
  }
}

export function flipProgressTitle(revealed: number, total: number): string {
  const progress = normalizeFlipProgress(revealed, total)
  if (progress.total <= 0) return '本单元无需翻卡'
  if (progress.revealed >= progress.total) return `翻卡完成 ${progress.revealed}/${progress.total}`
  if (progress.revealed <= 0) return `尚未翻卡 0/${progress.total}`
  return `已翻 ${progress.revealed} / 需翻 ${progress.total}`
}
