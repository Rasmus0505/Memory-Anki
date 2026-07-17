import { describe, expect, it } from 'vitest'
import {
  applyEmphasisMarksToHtml,
  hasHighlightMarkup,
  highlightEntireNodeText,
  sanitizeMindMapRichHtml,
  stripMindMapHtml,
  wrapHighlightHtml,
} from './mindmapRichText'

describe('mindmapRichText', () => {
  it('strips html tags for plain text', () => {
    expect(stripMindMapHtml('<div>细胞膜<br>结构</div>')).toBe('细胞膜\n结构')
  })

  it('detects highlight markup', () => {
    expect(hasHighlightMarkup(wrapHighlightHtml('重点'))).toBe(true)
    expect(hasHighlightMarkup('普通文字')).toBe(false)
  })

  it('applies emphasis marks as yellow highlight', () => {
    const html = applyEmphasisMarksToHtml('细胞膜由磷脂双分子层构成', [
      { kind: 'highlight', text: '磷脂双分子层' },
    ])
    expect(html).toContain('data-emphasis="highlight"')
    expect(html).toContain('background-color:#fef08c')
    expect(html).toContain('磷脂双分子层')
  })

  it('sanitizes scripts', () => {
    const cleaned = sanitizeMindMapRichHtml(
      '<div>安全<script>alert(1)</script><span data-emphasis="highlight">重点</span></div>',
    )
    expect(cleaned.toLowerCase()).not.toContain('script')
    expect(cleaned).toContain('重点')
  })

  it('highlights entire card text as yellow emphasis', () => {
    const full = highlightEntireNodeText('细胞膜\n结构')
    expect(full).toContain('data-emphasis="highlight"')
    expect(full).toContain('background-color:#fef08c')
    expect(full).toContain('细胞膜<br>结构')
    expect(stripMindMapHtml(full)).toBe('细胞膜\n结构')
  })

  it('re-wraps partial highlights into full-card highlight', () => {
    const partial = applyEmphasisMarksToHtml('细胞膜由磷脂构成', [
      { kind: 'highlight', text: '磷脂' },
    ])
    const full = highlightEntireNodeText(partial)
    expect(full).toContain('细胞膜由磷脂构成')
    expect(full).toContain('data-emphasis="highlight"')
    // Entire plain text becomes one highlight span (not only the previous fragment).
    expect(stripMindMapHtml(full)).toBe('细胞膜由磷脂构成')
  })
})
