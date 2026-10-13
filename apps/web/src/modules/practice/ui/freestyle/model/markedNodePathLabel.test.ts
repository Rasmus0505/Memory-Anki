import { describe, expect, it } from 'vitest'
import {
  formatMarkedNodePath,
  markedNodePathLabel,
  markedNodePathParts,
  markedNodePathTexts,
} from './markedNodePathLabel'

const doc = {
  root: {
    data: { uid: 'root', text: '古希腊的教育阶段' },
    children: [
      {
        data: { uid: 'section', text: '第二节' },
        children: [
          { data: { uid: 'mark', text: '古典时期' }, children: [] },
        ],
      },
    ],
  },
}

describe('markedNodePathLabel', () => {
  it('joins the root through the marked node', () => {
    expect(markedNodePathLabel(doc, 'mark')).toBe('古希腊的教育阶段-第二节-古典时期')
  })

  it('keeps a direct child as root hyphen mark', () => {
    expect(markedNodePathLabel({
      root: {
        data: { uid: 'root', text: '古希腊的教育阶段' },
        children: [{ data: { uid: 'mark', text: '古典时期' }, children: [] }],
      },
    }, 'mark')).toBe('古希腊的教育阶段-古典时期')
  })

  it('returns empty when the anchor is not in the document', () => {
    expect(markedNodePathLabel(doc, 'missing')).toBe('')
    expect(markedNodePathLabel(null, 'mark')).toBe('')
  })
})

describe('markedNodePathTexts', () => {
  it('returns the root-first texts through the anchor', () => {
    expect(markedNodePathTexts(doc, 'mark')).toEqual(['古希腊的教育阶段', '第二节', '古典时期'])
  })

  it('returns no texts for a missing document or anchor', () => {
    expect(markedNodePathTexts(doc, 'missing')).toEqual([])
    expect(markedNodePathTexts(null, 'mark')).toEqual([])
  })
})

describe('markedNodePathParts', () => {
  it('splits a multi-level path into root and anchor', () => {
    const parts = markedNodePathParts(['第四节 赫尔巴特的教育思想', '理论基础', '理论基础细分', '理论基础'])
    expect(parts.root).toBe('第四节 赫尔巴特的教育思想')
    expect(parts.anchor).toBe('理论基础')
    expect(parts.full).toBe('第四节 赫尔巴特的教育思想-理论基础-理论基础细分-理论基础')
  })

  it('shows a single-level path as the node alone, with no root', () => {
    const parts = markedNodePathParts(['古典时期'])
    expect(parts.root).toBeNull()
    expect(parts.anchor).toBe('古典时期')
    expect(formatMarkedNodePath(parts)).toBe('古典时期')
  })

  it('treats a missing context as an empty row', () => {
    const parts = markedNodePathParts([])
    expect(parts).toEqual({ root: null, anchor: '', full: '' })
    expect(formatMarkedNodePath(parts)).toBe('')
  })

  it('drops blank nodes before choosing root and anchor', () => {
    const parts = markedNodePathParts(['  ', '根', ' ', '标记 '])
    expect(parts.root).toBe('根')
    expect(parts.anchor).toBe('标记')
  })
})

describe('formatMarkedNodePath', () => {
  it('formats a multi-level path as root ⋯ anchor', () => {
    expect(formatMarkedNodePath(markedNodePathParts(['第四节 赫尔巴特的教育思想', '中间', '理论基础'])))
      .toBe('第四节 赫尔巴特的教育思想 ⋯ 理论基础')
  })

  it('formats a two-node path as root ⋯ anchor with no middle', () => {
    expect(formatMarkedNodePath(markedNodePathParts(['根', '标记']))).toBe('根 ⋯ 标记')
  })
})
