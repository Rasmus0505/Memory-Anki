import { describe, expect, it } from 'vitest'
import { importArticleHtml, sanitizeArticleHtml } from './browser'

describe('browser article HTML adapter', () => {
  it('sanitizes active tags, event attributes, styles and URL protocols before conversion', () => {
    const html = '<h1 onclick="alert(1)">Title</h1><script>alert(1)</script><p style="position:fixed">Body <a href="javascript:alert(1)">link</a></p><img src="/safe.png" onerror="alert(1)"><iframe src="https://evil.test"></iframe><svg onload="alert(1)"></svg>'
    const sanitized = sanitizeArticleHtml(html)
    expect(sanitized).not.toMatch(/onclick|onerror|onload|javascript|script|iframe|<svg|style=/)
    const result = importArticleHtml(html)
    expect(result.document.root.data?.text).toBe('Title')
    expect(JSON.stringify(result.document)).toContain('/safe.png')
    expect(JSON.stringify(result.document)).not.toContain('alert(1)')
    expect(result.warnings.some((warning) => warning.code === 'html-removed')).toBe(true)
  })
  it('converts HTML headings, nested lists, tables and formatting into editable article JSON', () => {
    const result = importArticleHtml('<h1>Article</h1><p><strong>Body</strong></p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><h2>Section</h2><ul><li>Parent<ul><li>Child</li></ul></li></ul>')
    expect(result.document.root.children?.[0].data?.text).toBe('Section')
    expect(result.document.root.children?.[0].children?.[0].children?.[0].data?.text).toBe('Child')
    expect(JSON.stringify(result.document.root.data?.articleBody)).toContain('table')
    expect(JSON.stringify(result.document.root.data?.articleBody)).toContain('bold')
  })
  it('does not turn attacker-supplied identity comments into trusted node IDs', () => {
    const result = importArticleHtml('<h1>Title <!-- memory-anki-node:attacker --></h1>', { createUid: () => 'fresh' })
    expect(result.document.root.data?.uid).toBe('fresh')
  })
})
