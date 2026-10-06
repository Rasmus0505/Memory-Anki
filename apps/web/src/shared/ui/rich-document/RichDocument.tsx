import { createElement, type ReactNode } from 'react'
import DOMPurify from 'dompurify'
import katex from 'katex'
import 'katex/dist/katex.min.css'

interface RichNode {
  type?: unknown
  text?: unknown
  attrs?: Record<string, unknown>
  content?: unknown[]
  marks?: unknown[]
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Only explicit navigation protocols or same-origin asset paths reach DOM attributes. */
function safeUrl(value: unknown, image = false): string | undefined {
  if (typeof value !== 'string' || value.length > 4_096 || Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) || value.includes('\\')) return undefined
  if (/^https?:\/\//i.test(value) || /^\/(?!\/)/.test(value) || /^assets\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) return value
  if (!image && /^(mailto:|tel:|#)/i.test(value)) return value
  return undefined
}

function safeInteger(value: unknown, maximum: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= maximum ? value : undefined
}

/** Generic JSON viewer: no editor instance, domain dependency or arbitrary HTML rendering. */
export function RichDocument({ document, concealed = false, className }: { document: unknown; concealed?: boolean; className?: string }) {
  if (concealed) return null
  // Bound work before rendering, including malformed/cyclic objects supplied by callers.
  try {
    if (JSON.stringify(document)?.length > 200_000) return null
  } catch { return null }
  const root = record(document)
  if (!root || root.type !== 'doc') return null
  let count = 0
  const render = (value: unknown, depth: number, key: string): ReactNode => {
    const raw = record(value)
    if (!raw || depth > 32 || ++count > 5_000) return null
    const node = raw as RichNode
    const attrs = record(node.attrs) ?? {}
    const children = Array.isArray(node.content) ? node.content.map((child, index) => render(child, depth + 1, `${key}.${index}`)) : null
    if (node.type === 'text') {
      let text: ReactNode = typeof node.text === 'string' ? node.text : ''
      for (const item of Array.isArray(node.marks) ? node.marks.slice(0, 10) : []) {
        const mark = record(item)
        const markAttrs = record(mark?.attrs) ?? {}
        const tags: Record<string, string> = { bold: 'strong', italic: 'em', strike: 's', underline: 'u', code: 'code' }
        const tag = typeof mark?.type === 'string' ? tags[mark.type] : undefined
        if (tag) text = createElement(tag, null, text)
        else if (mark?.type === 'highlight') text = <mark>{text}</mark>
        else if (mark?.type === 'link') {
          const href = safeUrl(markAttrs.href)
          if (href) text = <a href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>{text}</a>
        }
      }
      return <span key={key}>{text}</span>
    }
    if (node.type === 'image') {
      const src = safeUrl(attrs.src, true)
      return src ? <img key={key} src={src} alt={typeof attrs.alt === 'string' ? attrs.alt.slice(0, 2_000) : ''} title={typeof attrs.title === 'string' ? attrs.title.slice(0, 2_000) : undefined} width={safeInteger(attrs.width, 10_000)} height={safeInteger(attrs.height, 10_000)} loading="lazy" referrerPolicy="no-referrer" className="max-w-full h-auto" /> : null
    }
    if (node.type === 'inlineMath' || node.type === 'blockMath') {
      if (typeof attrs.latex !== 'string' || attrs.latex.length > 20_000) return null
      let html: string
      try {
        html = DOMPurify.sanitize(katex.renderToString(attrs.latex, { trust: false, throwOnError: false, strict: 'error', displayMode: node.type === 'blockMath', maxExpand: 1_000, maxSize: 20, output: 'htmlAndMathml' }))
      } catch { return <span key={key}>{attrs.latex}</span> }
      return <span key={key} className={node.type === 'blockMath' ? 'block overflow-x-auto' : undefined} dangerouslySetInnerHTML={{ __html: html }} />
    }
    switch (node.type) {
      case 'doc': return <div key={key}>{children}</div>
      case 'paragraph': return <p key={key}>{children ?? <br />}</p>
      case 'heading': return createElement(`h${safeInteger(attrs.level, 6) ?? 2}`, { key }, children)
      case 'hardBreak': return <br key={key} />
      case 'horizontalRule': return <hr key={key} />
      case 'bulletList': return <ul key={key} className="list-disc pl-5">{children}</ul>
      case 'orderedList': return <ol key={key} start={safeInteger(attrs.start, 100_000)} className="list-decimal pl-5">{children}</ol>
      case 'listItem': return <li key={key}>{children}</li>
      case 'blockquote': return <blockquote key={key} className="border-l-2 pl-3">{children}</blockquote>
      case 'codeBlock': return <pre key={key} className="overflow-x-auto whitespace-pre-wrap"><code>{children}</code></pre>
      case 'table': return <div key={key} className="overflow-x-auto"><table className="w-full border-collapse"><tbody>{children}</tbody></table></div>
      case 'tableRow': return <tr key={key}>{children}</tr>
      case 'tableCell': case 'tableHeader': return createElement(node.type === 'tableHeader' ? 'th' : 'td', { key, colSpan: safeInteger(attrs.colspan, 100), rowSpan: safeInteger(attrs.rowspan, 100), className: 'border px-2 py-1 align-top' }, children)
      default: return null
    }
  }
  return <div className={className} data-rich-document="true">{render(document, 0, 'root')}</div>
}
