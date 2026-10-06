export interface ArticleStructureRequest {
  kind: 'heading' | 'list'
  placement: 'sibling' | 'child'
  text?: string
}

/** A standalone marker only; never consume existing prose or nested imported lists. */
export function resolveArticleStructureInput(input: {
  paragraphText: string
  offset: number
  topLevelParagraph: boolean
  collapsed: boolean
  composing: boolean
  modified?: boolean
  insertedText: string
}): ArticleStructureRequest | null {
  if (input.composing || input.modified || !input.collapsed || !input.topLevelParagraph || input.insertedText !== ' ') return null
  if (input.offset !== input.paragraphText.length) return null
  if (/^#{1,6}$/.test(input.paragraphText)) return { kind: 'heading', placement: 'sibling' }
  if (/^(?:[-+*]|\d{1,6}\.)$/.test(input.paragraphText)) return { kind: 'list', placement: 'sibling' }
  return null
}
