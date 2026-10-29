import { describe, expect, it } from 'vitest'
import {
  collectMindMapTextMetrics,
  countMindMapTextMetrics,
  countTextMetrics,
  type MindMapTextMetricsCache,
} from './textMetrics'

describe('countTextMetrics', () => {
  it('counts each CJK character as one word and punctuation as characters only', () => {
    expect(countTextMetrics('你好，世界')).toEqual({ words: 4, chars: 5 })
  })

  it('counts Latin and digit runs as words and ignores whitespace in characters', () => {
    expect(countTextMetrics('Hello  world\n2027')).toEqual({ words: 3, chars: 14 })
  })

  it('keeps counts at zero for empty or non-text input', () => {
    expect(countTextMetrics('')).toEqual({ words: 0, chars: 0 })
  })
})

describe('countMindMapTextMetrics', () => {
  it('strips yellow-emphasis markup before counting', () => {
    const stored =
      '<div><span data-emphasis="highlight" style="background-color:#fef08c;color:inherit">知识点</span></div>'
    expect(countMindMapTextMetrics(stored)).toEqual({ words: 3, chars: 3 })
  })

  it('keeps block boundaries so separate lines do not merge into one word', () => {
    expect(countMindMapTextMetrics('<div>alpha</div><div>beta</div>')).toEqual({
      words: 2,
      chars: 9,
    })
  })

  it('decodes entities once instead of counting markup characters', () => {
    expect(countMindMapTextMetrics('A &amp; B')).toEqual({ words: 2, chars: 3 })
  })
})

describe('collectMindMapTextMetrics', () => {
  const document = {
    root: {
      data: { text: '宫殿', uid: 'root' },
      children: [
        {
          data: { text: '知识点一', uid: 'a' },
          children: [{ data: { text: 'Child note', uid: 'b' }, children: [] }],
        },
      ],
    },
  }

  it('sums every card, root included, and exposes per-card counts', () => {
    const stats = collectMindMapTextMetrics(document)
    expect(stats.cards).toBe(3)
    expect(stats.words).toBe(2 + 4 + 2)
    expect(stats.byUid.get('b')).toMatchObject({ words: 2, chars: 9 })
  })

  it('reuses cached entries for untouched cards and recounts edited ones', () => {
    const cache: MindMapTextMetricsCache = new Map()
    const first = collectMindMapTextMetrics(document, cache)
    const firstChild = first.byUid.get('a')

    const edited = {
      root: {
        ...document.root,
        children: [
          {
            children: document.root.children[0].children,
            data: { text: '知识点一二三', uid: 'a' },
          },
        ],
      },
    }
    const second = collectMindMapTextMetrics(edited, cache)

    expect(second.byUid.get('a')).not.toBe(firstChild)
    expect(second.byUid.get('b')).toBe(first.byUid.get('b'))
    expect(second.words).toBe(2 + 6 + 2)
  })
})
