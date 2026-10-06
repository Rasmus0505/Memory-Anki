import DOMPurify from 'dompurify'
import TurndownService from 'turndown'
import { importArticleMarkdown } from './markdown'
import type { ArticlePreview, MarkdownImportOptions } from './types'

/** Browser-only adapter. No DOM APIs or unsafe HTML sinks exist in the pure codec. */
export function sanitizeArticleHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'b', 'em', 'i', 's', 'del', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'a', 'img', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'start'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'form', 'input'],
    FORBID_ATTR: ['style', 'srcset'],
  })
}
export function importArticleHtml(html: string, options: MarkdownImportOptions = {}): ArticlePreview {
  const sanitized = sanitizeArticleHtml(html)
  const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
  service.addRule('articleTable', {
    filter: 'table',
    replacement: (_content, node) => {
      const rows = Array.from((node as HTMLTableElement).rows).map((row) => Array.from(row.cells).map((cell) => service.turndown(cell.innerHTML).replace(/\|/g, '\\|').replace(/\n/g, ' ')))
      const width = Math.max(0, ...rows.map((row) => row.length))
      if (!width) return ''
      const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, index) => cells[index] ?? '').join(' | ')} |`
      return `\n\n${[line(rows[0]), line(Array(width).fill('---') as string[]), ...rows.slice(1).map(line)].join('\n')}\n\n`
    },
  })
  const result = importArticleMarkdown(service.turndown(sanitized), options)
  if (sanitized !== html) result.warnings.unshift({ code: 'html-removed', message: 'Untrusted HTML was sanitized before conversion; unsupported markup may have been removed.' })
  return result
}
