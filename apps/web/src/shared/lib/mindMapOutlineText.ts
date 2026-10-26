import { stripMindMapHtml } from './mindmapRichText'

export interface MindMapOutlineOptions {
  /** Palace title; shown above the tree when it is not already the root card. */
  title?: string | null
}

interface RawMindMapNode {
  data?: Record<string, unknown>
  children?: unknown
}

function readRootNode(document: unknown): RawMindMapNode | null {
  let value: unknown = document
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object') return null
  const root = (value as { root?: unknown }).root
  return root && typeof root === 'object' ? (root as RawMindMapNode) : null
}

function singleLine(value: unknown) {
  return stripMindMapHtml(value).replace(/\s*\n\s*/g, ' ').trim()
}

function splitNoteLines(value: unknown) {
  return stripMindMapHtml(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Plain-text outline of a mind map: one `- ` bullet per card, two spaces per
 * level, and each card's note (body) as an indented 备注 line.
 *
 * Built for pasting into an AI chat as study background, so it keeps only the
 * text hierarchy — no JSON, node ids, styling, or editor markup. A card with no
 * text is skipped and its children move up one level rather than inventing a
 * placeholder card.
 */
export function buildMindMapOutlineText(
  document: unknown,
  options: MindMapOutlineOptions = {},
): string {
  const root = readRootNode(document)
  if (!root) return ''
  const title = singleLine(options.title)
  const rootText = singleLine(root.data?.text) || title || '未命名导图'
  const lines: string[] = []
  if (title && title !== rootText) lines.push(`记忆宫殿：${title}`, '')

  const walk = (node: RawMindMapNode, depth: number, fallbackText: string) => {
    if (!node || typeof node !== 'object') return
    const children = Array.isArray(node.children)
      ? node.children.filter((child): child is RawMindMapNode => Boolean(child) && typeof child === 'object')
      : []
    const text = singleLine(node.data?.text) || fallbackText
    if (!text) {
      children.forEach((child) => walk(child, depth, ''))
      return
    }
    lines.push(`${'  '.repeat(depth)}- ${text}`)
    splitNoteLines(node.data?.note).forEach((line, index) => {
      lines.push(`${'  '.repeat(depth + 1)}${index === 0 ? '备注：' : ''}${line}`)
    })
    children.forEach((child) => walk(child, depth + 1, ''))
  }

  walk(root, 0, rootText)
  return lines.join('\n').trim()
}
