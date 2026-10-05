import { describe, expect, it } from 'vitest'
import { markedNodePathLabel } from './markedNodePathLabel'

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
