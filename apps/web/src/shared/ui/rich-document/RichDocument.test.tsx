import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RichDocument } from './RichDocument'
import { NodeCardTextFace } from '../mindmap-canvas/NodeCardChrome'

afterEach(cleanup)
const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Secret body', marks: [{ type: 'bold' }] }] }] }

describe('safe rich document viewer', () => {
  it('renders text as escaped React text and allowlisted marks', () => {
    const { container } = render(<RichDocument document={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '<img src=x onerror=alert(1)>', marks: [{ type: 'bold' }] }] }] }} />)
    expect(container.querySelector('strong')?.textContent).toContain('<img')
    expect(container.querySelector('img')).toBeNull()
  })

  it('rejects unsafe links, image sources and arbitrary attributes', () => {
    const { container } = render(<RichDocument document={{ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Unsafe', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
      { type: 'image', attrs: { src: 'data:image/svg+xml,evil', onerror: 'alert(1)' } },
      { type: 'image', attrs: { src: '/api/assets/test.png', alt: 'Safe', onerror: 'alert(1)' } },
      { type: 'script', text: 'alert(1)' },
    ] }} />)
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelectorAll('img')).toHaveLength(1)
    expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders tables and KaTeX without trusting executable math commands', () => {
    const { container } = render(<RichDocument document={{ type: 'doc', content: [
      { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell' }] }] }] }] },
      { type: 'blockMath', attrs: { latex: 'x^2' } },
      { type: 'inlineMath', attrs: { latex: '\\href{javascript:alert(1)}{unsafe}' } },
    ] }} />)
    expect(container.querySelector('td')?.textContent).toBe('Cell')
    expect(container.querySelector('.katex')).not.toBeNull()
    expect(container.querySelector('[href^="javascript:"]')).toBeNull()
  })

  it('does not render concealed bodies, even as hidden DOM', () => {
    const { container, rerender } = render(<RichDocument document={body} concealed />)
    expect(container.textContent).toBe('')
    rerender(<NodeCardTextFace textCls="" displayHtml="" label="Title" isRoot={false} concealed articleBody={body} onClick={vi.fn()} onDoubleClick={vi.fn()} onContextMenu={vi.fn()} />)
    expect(screen.queryByText('Secret body')).toBeNull()
    expect(screen.getByText('待回忆')).toBeTruthy()
    rerender(<NodeCardTextFace textCls="" displayHtml="" label="Title" isRoot={false} concealed={false} articleBody={body} onClick={vi.fn()} onDoubleClick={vi.fn()} onContextMenu={vi.fn()} />)
    expect(screen.getByText('Secret body')).toBeTruthy()
  })

  it('ignores malformed, oversized and cyclic input', () => {
    const cyclic: Record<string, unknown> = { type: 'doc' }
    cyclic.content = [cyclic]
    const { container, rerender } = render(<RichDocument document={cyclic} />)
    expect(container.textContent).toBe('')
    rerender(<RichDocument document={{ type: 'doc', content: [{ type: 'text', text: 'x'.repeat(200_001) }] }} />)
    expect(container.textContent).toBe('')
    rerender(<RichDocument document={null} />)
    expect(container.textContent).toBe('')
  })
})
