import {
  addMindMapChildWithResult, addMindMapSiblingWithResult, getMindMapNodeStoredText,
  getMindMapNodeText, getMindMapNodeUid, normalizeMindMapDocument, relocateMindMapNode,
  type MindMapDocumentInput, type MindMapDocumentCreateResult, type MindMapDocumentV1, type MindMapNode,
} from './document'
import { canAddMindMapBranchChild, canMutateMindMapBranchStructure, canRelocateMindMapBranchNodes, collectMindMapBranchScope } from './subtree'

/** Persisted JSON only: no dependency on the rich editor implementation. */
export interface ArticleRichMark { type: string; attrs?: Record<string, unknown> }
export interface ArticleRichNode {
  type: string
  attrs?: Record<string, unknown>
  marks?: ArticleRichMark[]
  content?: ArticleRichNode[]
  text?: string
}
export type ArticleKind = 'heading' | 'list'
export interface ArticleBlock {
  uid: string
  parentUid: string | null
  depth: number
  text: string
  storedText: string
  note: string
  body: ArticleRichNode
  kind: ArticleKind
  node: MindMapNode
}

const NODE_TYPES = new Set(['doc', 'paragraph', 'heading', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader', 'image', 'inlineMath', 'blockMath'])
const MARK_TYPES = new Set(['bold', 'italic', 'strike', 'underline', 'code', 'link', 'highlight'])
const MAX_BODY_SIZE = 200_000
const MAX_NODES = 5_000
const MAX_DEPTH = 32

function safeUrl(value: unknown): boolean {
  if (typeof value !== 'string' || Array.from(value).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) return false
  return /^(https?:\/\/|mailto:|tel:|#|\/(?!\/))/i.test(value)
}

function validAttrs(type: string, value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const attrs = value as Record<string, unknown>
  return Object.entries(attrs).every(([key, item]) => {
    if (type === 'image' && key === 'src') return (typeof item === 'string' && /^assets\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(item) && !item.includes('..')) || (safeUrl(item) && /^(https?:\/\/|\/(?!\/))/i.test(String(item)))
    if (type === 'image' && (key === 'alt' || key === 'title')) return item === null || (typeof item === 'string' && item.length <= 2_000)
    if (type === 'image' && (key === 'width' || key === 'height')) return item === null || (Number.isInteger(item) && Number(item) > 0 && Number(item) <= 10_000)
    if ((type === 'inlineMath' || type === 'blockMath') && key === 'latex') return typeof item === 'string' && item.length <= 20_000
    if ((type === 'tableCell' || type === 'tableHeader') && (key === 'colspan' || key === 'rowspan')) return Number.isInteger(item) && Number(item) >= 1 && Number(item) <= 100
    if ((type === 'tableCell' || type === 'tableHeader') && key === 'align') return item === null || ['left', 'center', 'right', 'justify'].includes(String(item))
    if ((type === 'tableCell' || type === 'tableHeader') && key === 'colwidth') return item === null || (Array.isArray(item) && item.length <= 100 && item.every((width) => Number.isInteger(width) && Number(width) >= 0 && Number(width) <= 10_000))
    if (type === 'heading' && key === 'level') return Number.isInteger(item) && Number(item) >= 1 && Number(item) <= 6
    if (type === 'orderedList' && key === 'start') return Number.isSafeInteger(item) && Number(item) >= 1
    if (type === 'orderedList' && key === 'type') return item === null || ['1', 'a', 'A', 'i', 'I'].includes(String(item))
    if (type === 'codeBlock' && key === 'language') return item === null || (typeof item === 'string' && /^[\w+-]{0,40}$/.test(item))
    if (type === 'highlight' && key === 'color') return item === null || (typeof item === 'string' && /^#[0-9a-f]{3,8}$/i.test(item))
    if (type === 'link' && key === 'href') return safeUrl(item)
    if (type === 'link' && key === 'target') return item === null || item === '_blank' || item === '_self'
    if (type === 'link' && key === 'rel') return item === null || (typeof item === 'string' && /^(?:noopener|noreferrer|nofollow|\s)*$/.test(item))
    if (type === 'link' && key === 'class') return item === null
    if (type === 'link' && key === 'title') return item === null || (typeof item === 'string' && item.length <= 500)
    return false
  })
}

/** Strict bounded allowlist; reject unknown nodes, attributes and unsafe URL protocols. */
export function validateArticleBody(value: unknown): ArticleRichNode | null {
  let count = 0
  const ancestors = new Set<object>()
  const visit = (input: unknown, depth: number): boolean => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || depth > MAX_DEPTH || ++count > MAX_NODES || ancestors.has(input)) return false
    const node = input as ArticleRichNode
    if (!NODE_TYPES.has(node.type) || (depth === 0 ? node.type !== 'doc' : node.type === 'doc')) return false
    if (Object.keys(node).some((key) => !['type', 'attrs', 'marks', 'content', 'text'].includes(key))) return false
    if (!validAttrs(node.type, node.attrs)) return false
    if (node.type === 'text' ? typeof node.text !== 'string' || !node.text : node.text !== undefined) return false
    if (node.type === 'text' && node.content !== undefined) return false
    if (['hardBreak', 'horizontalRule', 'image', 'inlineMath', 'blockMath'].includes(node.type) && node.content !== undefined) return false
    if (node.type === 'image' && !node.attrs?.src) return false
    if (['inlineMath', 'blockMath'].includes(node.type) && typeof node.attrs?.latex !== 'string') return false
    if (node.marks !== undefined && (!Array.isArray(node.marks) || node.marks.length > 10 || node.marks.some((mark) =>
      !mark || typeof mark !== 'object' || !MARK_TYPES.has(mark.type)
      || Object.keys(mark).some((key) => key !== 'type' && key !== 'attrs')
      || !validAttrs(mark.type, mark.attrs)
      || (mark.type === 'link' && !safeUrl(mark.attrs?.href))))) return false
    if (node.content !== undefined && !Array.isArray(node.content)) return false
    ancestors.add(input)
    const valid = (node.content ?? []).every((child) => visit(child, depth + 1))
    ancestors.delete(input)
    return valid
  }
  try {
    if (!visit(value, 0)) return null
    const serialized = JSON.stringify(value)
    return serialized.length <= MAX_BODY_SIZE ? JSON.parse(serialized) as ArticleRichNode : null
  } catch { return null }
}

export function createArticleBody(text: string): ArticleRichNode {
  return { type: 'doc', content: text.split(/\r?\n/).map((line) => ({ type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}) })) }
}

export function articleBodyToPlainText(value: unknown): string {
  const body = validateArticleBody(value)
  if (!body) return ''
  const visit = (node: ArticleRichNode): string => {
    if (node.type === 'text') return node.text ?? ''
    if (node.type === 'hardBreak') return '\n'
    if (node.type === 'inlineMath' || node.type === 'blockMath') return String(node.attrs?.latex ?? '')
    if (node.type === 'image') return String(node.attrs?.alt ?? '')
    const separator = node.type === 'tableRow' ? '\t' : ['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'table', 'tableCell', 'tableHeader'].includes(node.type) ? '\n' : ''
    return (node.content ?? []).map(visit).join(separator)
  }
  return visit(body)
}

export function projectMindMapArticle(document: MindMapDocumentInput, scopeBranchUid?: string | null): ArticleBlock[] {
  const doc = normalizeMindMapDocument(document)
  const scope = scopeBranchUid ? collectMindMapBranchScope(doc, scopeBranchUid) : null
  const blocks: ArticleBlock[] = []
  const walk = (node: MindMapNode, parentUid: string | null, depth: number) => {
    const uid = getMindMapNodeUid(node, 'root')
    const note = typeof node.data?.note === 'string' ? node.data.note : ''
    if (!scope || scope.keepUids.has(uid)) blocks.push({
      uid, parentUid, depth, text: getMindMapNodeText(node), storedText: getMindMapNodeStoredText(node), note,
      body: validateArticleBody(node.data?.articleBody) ?? createArticleBody(note),
      kind: node.data?.articleKind === 'list' ? 'list' : 'heading', node,
    })
    node.children?.forEach((child) => walk(child, uid, depth + 1))
  }
  walk(doc.root, null, 0)
  return blocks
}

export function updateMindMapArticleBody(document: MindMapDocumentInput, uid: string, body: unknown, kind?: ArticleKind): MindMapDocumentV1 {
  const validated = validateArticleBody(body)
  if (!validated) throw new Error('Invalid article body')
  const doc = normalizeMindMapDocument(document)
  const walk = (node: MindMapNode) => {
    if (getMindMapNodeUid(node, '') === uid) {
      node.data = { ...node.data, articleBody: validated, ...(kind ? { articleKind: kind } : {}) }
      return
    }
    node.children?.forEach(walk)
  }
  walk(doc.root)
  return doc
}

export function indentMindMapArticleNode(document: MindMapDocumentInput, uid: string, scopeBranchUid?: string | null): MindMapDocumentV1 {
  const doc = normalizeMindMapDocument(document)
  const blocks = projectMindMapArticle(doc)
  const block = blocks.find((item) => item.uid === uid)
  if (!block?.parentUid) return doc
  const siblings = blocks.filter((item) => item.parentUid === block.parentUid)
  const previous = siblings[siblings.findIndex((item) => item.uid === uid) - 1]
  const scope = scopeBranchUid ? collectMindMapBranchScope(doc, scopeBranchUid) : null
  if (!previous || !canRelocateMindMapBranchNodes(scope, [uid], previous.uid, 'inside')) return doc
  return relocateMindMapNode(doc, uid, previous.uid, 'inside')
}

export function outdentMindMapArticleNode(document: MindMapDocumentInput, uid: string, scopeBranchUid?: string | null): MindMapDocumentV1 {
  const doc = normalizeMindMapDocument(document)
  const blocks = projectMindMapArticle(doc)
  const block = blocks.find((item) => item.uid === uid)
  const parent = blocks.find((item) => item.uid === block?.parentUid)
  const scope = scopeBranchUid ? collectMindMapBranchScope(doc, scopeBranchUid) : null
  if (!parent?.parentUid || !canRelocateMindMapBranchNodes(scope, [uid], parent.uid, 'after')) return doc
  return relocateMindMapNode(doc, uid, parent.uid, 'after')
}

export function addMindMapArticleNode(document: MindMapDocumentInput, uid: string, placement: 'child' | 'sibling', scopeBranchUid?: string | null): MindMapDocumentCreateResult {
  const doc = normalizeMindMapDocument(document)
  const scope = scopeBranchUid ? collectMindMapBranchScope(doc, scopeBranchUid) : null
  const allowed = placement === 'child' ? canAddMindMapBranchChild(scope, uid) : canMutateMindMapBranchStructure(scope, uid)
  if (!allowed) return { document: doc, nodeUid: null }
  return placement === 'child' ? addMindMapChildWithResult(doc, uid) : addMindMapSiblingWithResult(doc, uid)
}
