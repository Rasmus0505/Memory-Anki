/** Yellow knowledge-emphasis markup shared by import + mind-map editor. */

export const HIGHLIGHT_BG = '#fef08c'
export const HIGHLIGHT_SPAN_ATTR = 'data-emphasis="highlight"'
export const HIGHLIGHT_SPAN_STYLE = `background-color:${HIGHLIGHT_BG};color:inherit`

const SCRIPT_OR_EVENT_RE =
  /<\s*script\b[^>]*>.*?<\s*\/\s*script\s*>|on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
const DISALLOWED_TAG_RE = /<\/?(?!\/?\s*(?:div|br|span|u|mark)\b)[a-zA-Z][^>]*>/gi

export function stripMindMapHtml(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim()
}

export function hasHighlightMarkup(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return (
    value.includes('data-emphasis="highlight"')
    || value.includes("data-emphasis='highlight'")
  )
}

export function sanitizeMindMapRichHtml(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  return raw.replace(SCRIPT_OR_EVENT_RE, '').replace(DISALLOWED_TAG_RE, '').trim()
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function wrapHighlightHtml(innerHtmlOrText: string, alreadyEscaped = false): string {
  const inner = alreadyEscaped ? innerHtmlOrText : escapeHtmlText(innerHtmlOrText)
  return `<span ${HIGHLIGHT_SPAN_ATTR} style="${HIGHLIGHT_SPAN_STYLE}">${inner}</span>`
}

/**
 * Mark every character of a card as yellow knowledge-emphasis.
 * Strips existing markup first so partial highlights become full-card highlight.
 * Returns empty string when there is no visible text.
 */
export function highlightEntireNodeText(value: unknown): string {
  const plain = stripMindMapHtml(value)
  if (!plain) return ''
  const inner = escapeHtmlText(plain).replace(/\n/g, '<br>')
  return `<div>${wrapHighlightHtml(inner, true)}</div>`
}

export function applyEmphasisMarksToHtml(
  text: string,
  marks: Array<{ kind?: string; text?: string }> | undefined | null,
): string {
  const plain = String(text || '').trim()
  if (!plain) return ''
  let html = escapeHtmlText(plain).replace(/\n/g, '<br>')
  const list = Array.isArray(marks) ? marks : []
  for (const mark of list) {
    const fragment = String(mark?.text || '').trim()
    if (!fragment) continue
    const escaped = escapeHtmlText(fragment)
    const index = html.indexOf(escaped)
    if (index < 0) continue
    html =
      html.slice(0, index)
      + wrapHighlightHtml(escaped, true)
      + html.slice(index + escaped.length)
  }
  if (!hasHighlightMarkup(html)) return ''
  return `<div>${html}</div>`
}

export function serializeContentEditable(root: HTMLElement): string {
  // Prefer structured HTML if highlights exist; otherwise plain text with newlines.
  const html = sanitizeMindMapRichHtml(root.innerHTML)
  if (hasHighlightMarkup(html)) {
    // Normalize to a single wrapper when possible
    const trimmed = html.replace(/^<div>/i, '').replace(/<\/div>$/i, '')
    return hasHighlightMarkup(trimmed) || /<br\s*\/?>/i.test(trimmed)
      ? `<div>${trimmed}</div>`
      : html
  }
  // innerText preserves visual line breaks better than textContent for contentEditable.
  return (root.innerText || root.textContent || '').replace(/\u00a0/g, ' ')
}

/** DOM toggle for contentEditable selection. Returns true if DOM changed. */
export function toggleHighlightOnDomSelection(root: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return false

  const range = selection.getRangeAt(0)
  const highlightAncestor = findHighlightAncestor(range.commonAncestorContainer, root)
  if (highlightAncestor) {
    unwrapElement(highlightAncestor)
    selection.removeAllRanges()
    return true
  }

  // If selection is fully covered by a highlight, unwrap it.
  const fullyHighlighted = selectionInsideHighlight(range, root)
  if (fullyHighlighted) {
    unwrapElement(fullyHighlighted)
    selection.removeAllRanges()
    return true
  }

  try {
    const span = document.createElement('span')
    span.setAttribute('data-emphasis', 'highlight')
    span.setAttribute('style', HIGHLIGHT_SPAN_STYLE)
    range.surroundContents(span)
  } catch {
    // Cross-node selection: extract and wrap
    const fragment = range.extractContents()
    const span = document.createElement('span')
    span.setAttribute('data-emphasis', 'highlight')
    span.setAttribute('style', HIGHLIGHT_SPAN_STYLE)
    span.appendChild(fragment)
    range.insertNode(span)
  }
  selection.removeAllRanges()
  return true
}

function findHighlightAncestor(node: Node | null, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.getAttribute('data-emphasis') === 'highlight') {
      return current
    }
    current = current.parentNode
  }
  return null
}

function selectionInsideHighlight(range: Range, root: HTMLElement): HTMLElement | null {
  const startHighlight = findHighlightAncestor(range.startContainer, root)
  const endHighlight = findHighlightAncestor(range.endContainer, root)
  if (startHighlight && startHighlight === endHighlight) return startHighlight
  return null
}

function unwrapElement(element: HTMLElement) {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element)
  }
  parent.removeChild(element)
  parent.normalize()
}

export function plainOffsetsFromContentEditable(
  root: HTMLElement,
): { start: number; end: number; plain: string } | null {
  const selection = window.getSelection()
  const plain = (root.innerText || root.textContent || '').replace(/\u00a0/g, ' ')
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  if (!root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null
  const range = selection.getRangeAt(0)
  const pre = range.cloneRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)
  const start = pre.toString().length
  const end = start + range.toString().length
  if (start === end) return null
  return { start: Math.min(start, end), end: Math.max(start, end), plain }
}
