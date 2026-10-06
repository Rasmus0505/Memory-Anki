import { describe, expect, it } from 'vitest'
import { resolveArticleStructureInput } from './articleStructureInput'
const input = { paragraphText: '#', offset: 1, topLevelParagraph: true, collapsed: true, composing: false, insertedText: ' ' }
describe('article structural typing intent', () => {
  it.each(['#', '##', '######'])('maps heading marker %s to sibling intent', (paragraphText) => {
    expect(resolveArticleStructureInput({ ...input, paragraphText, offset: paragraphText.length })).toEqual({ kind: 'heading', placement: 'sibling' })
  })
  it.each(['-', '+', '*', '1.', '42.'])('maps list marker %s to node intent', (paragraphText) => {
    expect(resolveArticleStructureInput({ ...input, paragraphText, offset: paragraphText.length })).toEqual({ kind: 'list', placement: 'sibling' })
  })
  it.each([{ composing: true }, { modified: true }, { collapsed: false }, { topLevelParagraph: false }, { offset: 0 }, { insertedText: 'x' }, { paragraphText: '# existing prose' }, { paragraphText: '#######', offset: 7 }])('does not consume unsafe or ambiguous input %j', (override) => {
    expect(resolveArticleStructureInput({ ...input, ...override })).toBeNull()
  })
})
