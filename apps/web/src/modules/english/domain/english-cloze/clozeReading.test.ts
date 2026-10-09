import { describe, expect, it } from 'vitest'
import {
  articleCopyText,
  buildHardKeys,
  collectVocabKeys,
  EMPTY_CLOZE_MARKS,
  filledParagraph,
  toggleVocabWord,
  tokenizeParagraph,
  type ClozeYear,
} from './clozeReading'

const sample: ClozeYear = {
  year: 2010,
  paragraphs: ['The outbreak was an __1__ of unusual __2__.'],
  blanks: [
    {
      n: 1,
      answer: 'A',
      options: [
        { key: 'A', text: 'epidemic' },
        { key: 'B', text: 'example' },
        { key: 'C', text: 'change' },
        { key: 'D', text: 'plan' },
      ],
    },
    {
      n: 2,
      answer: 'C',
      options: [
        { key: 'A', text: 'size' },
        { key: 'B', text: 'time' },
        { key: 'C', text: 'severity' },
        { key: 'D', text: 'number' },
      ],
    },
  ],
}

describe('cloze reading', () => {
  it('fills a blank as one clickable word and keeps the paragraph readable', () => {
    const tokens = tokenizeParagraph(sample.paragraphs[0], sample.blanks)
    expect(tokens.filter((token) => token.kind === 'blank').map((token) => token.text)).toEqual([
      'epidemic',
      'severity',
    ])
    expect(filledParagraph(sample.paragraphs[0], sample.blanks)).toBe(
      'The outbreak was an epidemic of unusual severity.',
    )
    expect(articleCopyText(sample)).toContain('epidemic of unusual severity')
  })

  it('suggests hard option words, then lets a click dismiss or restore them', () => {
    const hard = buildHardKeys([sample])
    expect(hard.has('epidemic')).toBe(true)
    expect(hard.has('example')).toBe(false)
    const dismissed = toggleVocabWord('epidemic', hard, EMPTY_CLOZE_MARKS)
    expect(dismissed.dismissed).toContain('epidemic')
    expect(collectVocabKeys([sample], hard, dismissed)).not.toContain('epidemic')
    const restored = toggleVocabWord('epidemic', hard, dismissed)
    expect(restored.marked).toContain('epidemic')
    expect(collectVocabKeys([sample], hard, restored)).toContain('epidemic')
  })
})
