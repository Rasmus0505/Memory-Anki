import type {
  MindMapDoc,
  MindMapDocNode,
  MindMapEditorState,
} from '@/shared/api/contracts'

const HIGHLIGHT_STYLE = 'color:#dc2626;font-weight:700;'

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeHtmlForPlainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|blockquote|h[1-6]|tr|section|article)>/gi, '\n')
}

function toHtmlWithLineBreaks(value: string): string {
  if (typeof document === 'undefined') {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')
  }
  const element = document.createElement('div')
  element.textContent = value
  return element.innerHTML.replace(/\n/g, '<br>')
}

function buildHtmlContainer(source: string, richText: boolean): HTMLDivElement | null {
  if (typeof document === 'undefined') return null
  const container = document.createElement('div')
  container.innerHTML = richText ? source : toHtmlWithLineBreaks(source)
  return container
}

function replaceTextNodeWithHighlight(
  textNode: Text,
  matcher: RegExp,
): boolean {
  const source = textNode.nodeValue ?? ''
  if (!source) return false

  const fragment = document.createDocumentFragment()
  let lastIndex = 0
  let matched = false
  matcher.lastIndex = 0

  for (const match of source.matchAll(matcher)) {
    const matchedText = match[0]
    const matchIndex = match.index ?? -1
    if (!matchedText || matchIndex < 0) continue
    if (matchIndex > lastIndex) {
      fragment.appendChild(document.createTextNode(source.slice(lastIndex, matchIndex)))
    }
    const highlight = document.createElement('span')
    highlight.setAttribute('style', HIGHLIGHT_STYLE)
    highlight.textContent = matchedText
    fragment.appendChild(highlight)
    lastIndex = matchIndex + matchedText.length
    matched = true
  }

  if (!matched) return false
  if (lastIndex < source.length) {
    fragment.appendChild(document.createTextNode(source.slice(lastIndex)))
  }
  textNode.parentNode?.replaceChild(fragment, textNode)
  return true
}

function highlightHtmlValue(
  source: string,
  query: string,
  richText: boolean,
): { html: string; matched: boolean } {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return { html: source, matched: false }

  const container = buildHtmlContainer(source, richText)
  if (!container) {
    return { html: source, matched: false }
  }

  const escapedQuery = escapeRegExp(trimmedQuery)
  if (!escapedQuery) {
    return { html: source, matched: false }
  }

  const matcher = new RegExp(escapedQuery, 'giu')
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []

  let current = walker.nextNode()
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      textNodes.push(current as Text)
    }
    current = walker.nextNode()
  }

  let matched = false
  textNodes.forEach((textNode) => {
    matched = replaceTextNodeWithHighlight(textNode, matcher) || matched
  })
  return {
    html: container.innerHTML,
    matched,
  }
}

function normalizePlainTextWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim()
}

function parseEditorDoc(raw: MindMapEditorState['editor_doc']): MindMapDoc | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as MindMapDoc
    } catch {
      return null
    }
  }
  if (typeof raw === 'object') {
    return cloneValue(raw as MindMapDoc)
  }
  return null
}

function highlightDocNode(node: MindMapDocNode | undefined, query: string): MindMapDocNode | undefined {
  if (!node || typeof node !== 'object') return node
  const nextNode = cloneValue(node)
  const data = nextNode.data

  if (data && typeof data === 'object' && typeof data.text === 'string' && data.text) {
    const richText = Boolean(data.richText)
    const highlighted = highlightHtmlValue(data.text, query, richText)
    if (highlighted.matched) {
      data.text = highlighted.html
      data.richText = true
    }
  }

  if (Array.isArray(nextNode.children)) {
    nextNode.children = nextNode.children.map((child) => highlightDocNode(child, query) as MindMapDocNode)
  }

  return nextNode
}

export function sanitizeBilinkText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const normalizedHtml = normalizeHtmlForPlainText(value)

  if (typeof document === 'undefined') {
    return normalizePlainTextWhitespace(
      normalizedHtml
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'"),
    )
  }

  const element = document.createElement('div')
  element.innerHTML = normalizedHtml
  return normalizePlainTextWhitespace(element.textContent ?? '')
}

export function buildBilinkPreviewEditorState(
  editorState: MindMapEditorState | null,
  query: string | null | undefined,
): MindMapEditorState | null {
  if (!editorState) return null
  const trimmedQuery = query?.trim() ?? ''
  if (!trimmedQuery) return editorState

  const doc = parseEditorDoc(editorState.editor_doc)
  if (!doc?.root) return editorState

  const nextDoc = {
    ...doc,
    root: highlightDocNode(doc.root, trimmedQuery),
  }

  return {
    ...editorState,
    editor_doc: nextDoc,
  }
}
