import type { ReadingArticleGenerationConfig } from '@/shared/api/contracts'

export const DEFAULT_READING_GENERATION_CONFIG: ReadingArticleGenerationConfig = {
  cefr: 'B1',
  wordCount: 300,
  genre: 'argumentative',
  topic: '',
  wordRepetitions: 3,
  sentenceVariants: 3,
  syntaxDensity: 'normal',
}

export function sentenceBounds(content: string, start: number, end: number) {
  const left = Math.max(content.lastIndexOf('.', start - 1), content.lastIndexOf('!', start - 1), content.lastIndexOf('?', start - 1), content.lastIndexOf('\n', start - 1)) + 1
  const candidates = [content.indexOf('.', end), content.indexOf('!', end), content.indexOf('?', end), content.indexOf('\n', end)].filter((value) => value >= 0)
  const right = candidates.length ? Math.min(...candidates) + 1 : content.length
  let safeStart = left
  let safeEnd = right
  while (safeStart < safeEnd && /\s/.test(content[safeStart])) safeStart += 1
  while (safeEnd > safeStart && /\s/.test(content[safeEnd - 1])) safeEnd -= 1
  return { start: safeStart, end: safeEnd, quote: content.slice(safeStart, safeEnd) }
}

export function toggleReadingTarget(selection: number[], targetId: number, checked: boolean) {
  if (!checked) return selection.filter((id) => id !== targetId)
  return [...new Set([...selection, targetId])].slice(0, 12)
}
