/**
 * Graded recall cues for a concealed (待回忆) card.
 *
 * Pure text model, no React and no fx: the canvas only renders the level the
 * host hands it. A cue reveals a growing prefix of the label and masks the rest,
 * so the learner always sees how many characters the answer has. Level 0 means
 * nothing is shown; the last level still leaves the tail to recall.
 */

const MASK = '□'
const CJK_PATTERN = /[㐀-鿿]/

/** Prefix lengths shown at levels 1..n. Strictly shorter than the label, so a cue never spells the whole answer. */
export function recallCuePrefixLengths(label: string): number[] {
  const chars = Array.from(label.trim())
  const total = chars.length
  if (total < 2) return []
  const steps = [1, Math.ceil(total / 3), Math.ceil((2 * total) / 3)]
  return [...new Set(steps)].filter((length) => length >= 1 && length < total)
}

export function recallCueMaxLevel(label: string): number {
  return recallCuePrefixLengths(label).length
}

/** Masked label for `level` (1-based). Whitespace stays put so the word shape survives. */
export function buildRecallCueText(label: string, level: number): string {
  const chars = Array.from(label.trim())
  const lengths = recallCuePrefixLengths(label)
  const clamped = Math.min(Math.max(level, 0), lengths.length)
  const shown = clamped > 0 ? lengths[clamped - 1] : 0
  const body = chars
    .map((char, index) => (index < shown || /\s/.test(char) ? char : MASK))
    .join('')
  return `${body}  ${lengthLabel(label, chars.length)}`
}

function lengthLabel(label: string, count: number) {
  return CJK_PATTERN.test(label) ? `${count}字` : `${count} 字符`
}
