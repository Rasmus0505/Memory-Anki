import { Marked, type Token, type Tokens } from 'marked'
import { normalizeMindMapDocument, getMindMapNodeText, type MindMapDocumentInput, type MindMapDocumentV1, type MindMapNode } from '@/modules/content/domain/mindmap-document-entity/model/document'
import { createArticleBody, validateArticleBody, type ArticleRichMark, type ArticleRichNode } from '@/modules/content/domain/mindmap-document-entity/model/articleDocument'
import { ARTICLE_PACKAGE_LIMITS, type ArticlePreview, type MarkdownExport, type MarkdownImportOptions, type ArticleInterchangeWarning } from './types'

const ANCHOR = /<!--\s*memory-anki-node:([^\s<>]+)\s*-->/g
const parser = new Marked({ gfm: true, breaks: false, extensions: [
  { name: 'articleBody', level: 'block', start: (src) => src.indexOf('<!-- memory-anki-body:'), tokenizer(src) {
    const match = /^<!-- memory-anki-body:([a-zA-Z0-9_-]+) -->\n([\s\S]*?)\n<!-- \/memory-anki-body:\1 -->(?:\n|$)/.exec(src)
    if (match) return { type: 'articleBody', raw: match[0], text: match[2] }
  } },
  { name: 'blockMath', level: 'block', start: (src) => src.indexOf('$$'), tokenizer(src) {
    const match = /^\$\$\s*\n?([\s\S]*?)\n?\$\$(?:\n|$)/.exec(src)
    if (match) return { type: 'blockMath', raw: match[0], text: match[1].trim() }
  } },
  { name: 'inlineMath', level: 'inline', start: (src) => src.indexOf('$'), tokenizer(src) {
    const match = /^\$([^$\n]+)\$/.exec(src)
    if (match) return { type: 'inlineMath', raw: match[0], text: match[1] }
  } },
] })

export function safeArticleUrl(url: string): boolean {
  return !!url && !Array.from(url).some((char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === '\\') && !url.startsWith('//')
    && !/^(?:javascript|data|vbscript|file|blob):/i.test(url)
    && (!/^[a-z][a-z\d+.-]*:/i.test(url) || /^(?:https?:|mailto:|tel:)/i.test(url))
}
function stripAnchors(text: string): string { return text.replace(ANCHOR, '').trim() }
function tokenChildren(token: Token): Token[] { return 'tokens' in token ? (token.tokens as Token[] ?? []) : [] }
function tokenText(token: Token): string { return 'text' in token ? String(token.text) : '' }
function plain(tokens: Token[]): string {
  return tokens.map((token) => token.type === 'html' ? '' : tokenChildren(token).length ? plain(tokenChildren(token)) : tokenText(token)).join('').trim()
}
function warn(warnings: ArticleInterchangeWarning[], code: ArticleInterchangeWarning['code'], message: string) {
  if (!warnings.some((warning) => warning.code === code && warning.message === message)) warnings.push({ code, message })
}
function inline(tokens: Token[], warnings: ArticleInterchangeWarning[], marks: ArticleRichMark[] = []): ArticleRichNode[] {
  return tokens.flatMap((token): ArticleRichNode[] => {
    const text = tokenText(token)
    const mark = ({ strong: 'bold', em: 'italic', del: 'strike', codespan: 'code' } as Record<string, string>)[token.type]
    if (token.type === 'html') {
      if (!/^<!--\s*memory-anki-node:/.test(token.raw)) warn(warnings, 'html-removed', 'Raw HTML was removed; use the browser HTML import adapter to sanitize and convert HTML.')
      return []
    }
    if (token.type === 'inlineMath') return [{ type: 'inlineMath', attrs: { latex: text } }]
    if (token.type === 'br') return [{ type: 'hardBreak' }]
    if (token.type === 'image') {
      const image = token as Tokens.Image
      if (!safeArticleUrl(image.href)) { warn(warnings, 'unsafe-url', 'An unsafe image URL was removed.'); return [] }
      const node: ArticleRichNode = { type: 'image', attrs: { src: image.href, alt: image.text, title: image.title || null } }
      if (!validateArticleBody({ type: 'doc', content: [node] })) {
        warn(warnings, 'unsupported-content', `Image reference ${image.href} requires an asset resolver; preserved as text, not a working image.`)
        return [{ type: 'text', text: `${image.text} (${image.href})` }]
      }
      return [node]
    }
    if (token.type === 'link') {
      const link = token as Tokens.Link
      if (!safeArticleUrl(link.href)) { warn(warnings, 'unsafe-url', 'An unsafe link URL was removed.'); return inline(link.tokens, warnings, marks) }
      const mark: ArticleRichMark = { type: 'link', attrs: { href: link.href } }
      if (!validateArticleBody({ type: 'doc', content: [{ type: 'text', text: 'link', marks: [mark] }] })) {
        warn(warnings, 'unsupported-content', `Relative link ${link.href} needs a host resolver; its text was retained.`)
        return inline(link.tokens, warnings, marks)
      }
      return inline(link.tokens, warnings, [...marks, mark])
    }
    const nextMarks = mark ? [...marks, { type: mark }] : marks
    if (tokenChildren(token).length) return inline(tokenChildren(token), warnings, nextMarks)
    return text ? [{ type: 'text', text, ...(nextMarks.length ? { marks: nextMarks } : {}) }] : []
  })
}
function bodyBlocks(token: Token, warnings: ArticleInterchangeWarning[]): ArticleRichNode[] {
  if (token.type === 'space' || token.type === 'def') return []
  if (token.type === 'articleBody') return parser.lexer(tokenText(token)).flatMap((child) => bodyBlocks(child, warnings))
  if (token.type === 'heading') return [{ type: 'heading', attrs: { level: (token as Tokens.Heading).depth }, content: inline(tokenChildren(token), warnings) }]
  if (token.type === 'html') { warn(warnings, 'html-removed', 'Raw HTML was removed; use the browser HTML import adapter to sanitize and convert HTML.'); return [] }
  if (token.type === 'blockMath') return [{ type: 'blockMath', attrs: { latex: tokenText(token) } }]
  if (token.type === 'code') {
    const hint = (token as Tokens.Code).lang?.split(/\s/)[0] || null
    const language = hint && /^[\w+-]{1,40}$/.test(hint) ? hint : null
    if (hint && !language) warn(warnings, 'unsupported-content', 'An unsupported code-language hint was removed; code text was retained.')
    return [{ type: 'codeBlock', attrs: { language }, ...(tokenText(token) ? { content: [{ type: 'text', text: tokenText(token) }] } : {}) }]
  }
  if (token.type === 'hr') return [{ type: 'horizontalRule' }]
  if (token.type === 'blockquote') return [{ type: 'blockquote', content: tokenChildren(token).flatMap((child) => bodyBlocks(child, warnings)) }]
  if (token.type === 'table') {
    const table = token as Tokens.Table
    const row = (cells: Tokens.TableCell[], header: boolean): ArticleRichNode => ({ type: 'tableRow', content: cells.map((cell) => ({ type: header ? 'tableHeader' : 'tableCell', content: [{ type: 'paragraph', content: inline(cell.tokens, warnings) }] })) })
    return [{ type: 'table', content: [row(table.header, true), ...table.rows.map((cells) => row(cells, false))] }]
  }
  if (token.type === 'list') {
    const list = token as Tokens.List
    return [{ type: list.ordered ? 'orderedList' : 'bulletList', ...(list.ordered ? { attrs: { start: list.start } } : {}), content: list.items.map((item) => ({ type: 'listItem', content: item.tokens.flatMap((child) => bodyBlocks(child, warnings)) })) }]
  }
  const content = inline(tokenChildren(token).length ? tokenChildren(token) : parser.Lexer.lexInline(tokenText(token), parser.defaults), warnings)
  // Tiptap Image is a block node; split image-only runs out of paragraphs.
  const blocks: ArticleRichNode[] = []
  let paragraph: ArticleRichNode[] = []
  const flush = () => { if (paragraph.length) blocks.push({ type: 'paragraph', content: paragraph }); paragraph = [] }
  for (const node of content) { if (node.type === 'image') { flush(); blocks.push(node) } else paragraph.push(node) }
  flush()
  return blocks
}

/** Internal package identity context: never supplied for standalone Markdown. */
export interface PackageIdentityContext { baseDocument: MindMapDocumentV1 }
export function parseArticleMarkdown(markdown: string, options: MarkdownImportOptions = {}, identity?: PackageIdentityContext): ArticlePreview {
  if (markdown.length > ARTICLE_PACKAGE_LIMITS.markdownChars) throw new Error('Markdown exceeds size limit')
  const warnings: ArticleInterchangeWarning[] = []
  const baseNodes = new Map<string, MindMapNode>()
  const allIds = new Set<string>()
  const visit = (node: MindMapNode) => { const uid = String(node.data?.uid ?? ''); if (uid) { baseNodes.set(uid, node); allIds.add(uid) }; node.children?.forEach(visit) }
  if (identity) visit(identity.baseDocument.root)
  const anchorCounts = new Map<string, number>()
  for (const match of markdown.matchAll(ANCHOR)) { let uid: string; try { uid = decodeURIComponent(match[1]) } catch { uid = '' }; anchorCounts.set(uid, (anchorCounts.get(uid) ?? 0) + 1) }
  const used = new Set<string>()
  let count = 0
  const fresh = () => {
    for (let attempt = 0; attempt < 100; attempt++) { const uid = options.createUid?.() ?? crypto.randomUUID(); if (uid && !allIds.has(uid) && !used.has(uid)) { used.add(uid); return uid } }
    throw new Error('UID factory did not produce a unique UID')
  }
  const makeNode = (text: string, raw: string, kind: 'heading' | 'list'): MindMapNode => {
    if (++count > ARTICLE_PACKAGE_LIMITS.nodes) throw new Error('Too many article nodes')
    const matches = [...raw.matchAll(ANCHOR)]
    let anchor = ''; try { anchor = matches[0] ? decodeURIComponent(matches[0][1]) : '' } catch { /* malformed anchor remains untrusted */ }
    const original = identity && matches.length === 1 && anchorCounts.get(anchor) === 1 && !used.has(anchor) ? baseNodes.get(anchor) : undefined
    if (matches.length && !identity) warn(warnings, 'identity-unverified', 'UID anchors in plain Markdown are not trusted without a complete package.')
    if (identity && !original) warn(warnings, matches.length ? 'identity-ambiguous' : 'identity-missing', 'A missing, unknown, or duplicate UID anchor produced a new node; identity was not guessed.')
    const uid = original ? anchor : fresh()
    used.add(uid)
    const copy = original ? structuredClone(original) : {}
    const unchangedTitle = original && getMindMapNodeText(original) === text
    const storedText = unchangedTitle ? original.data?.text : text.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const data: NonNullable<MindMapNode['data']> = { ...copy.data, uid, text: storedText, articleKind: original?.data?.articleKind ?? kind, articleBody: { type: 'doc', content: [] } }
    if (!unchangedTitle) delete data.richText
    return { ...copy, data, children: [] }
  }
  let root: MindMapNode | undefined
  let current: MindMapNode | undefined
  const headings: { level: number; node: MindMapNode }[] = []
  const ensureRoot = () => { if (!root) { root = makeNode(options.title || 'Imported article', '', 'heading'); current = root }; return root }
  const addBody = (owner: MindMapNode, token: Token) => {
    const body = owner.data!.articleBody as ArticleRichNode
    body.content!.push(...bodyBlocks(token, warnings))
  }
  const addList = (list: Tokens.List, owner: MindMapNode, depth: number) => {
    if (depth > ARTICLE_PACKAGE_LIMITS.depth) throw new Error('Article nesting exceeds depth limit')
    for (const item of list.items) {
      const firstIndex = item.tokens.findIndex((token) => token.type !== 'space')
      const first = item.tokens[firstIndex]
      const title = first && first.type !== 'list' ? plain(parser.Lexer.lexInline(stripAnchors(tokenText(first)))) : ''
      const node = makeNode(title, first?.raw ?? '', 'list')
      owner.children!.push(node)
      item.tokens.forEach((token, index) => { if (index === firstIndex && first?.type !== 'list') return; if (token.type === 'list') addList(token as Tokens.List, node, depth + 1); else addBody(node, token) })
    }
  }
  for (const token of parser.lexer(markdown)) {
    if (token.type === 'space' || token.type === 'def') continue
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading
      const title = plain(parser.Lexer.lexInline(stripAnchors(heading.text)))
      const node = makeNode(title, heading.raw, 'heading')
      if (!root && heading.depth === 1) root = node
      else { ensureRoot(); while (headings.length && headings.at(-1)!.level >= heading.depth) headings.pop(); (headings.at(-1)?.node ?? root!).children!.push(node) }
      headings.push({ level: heading.depth, node }); current = node
    } else if (token.type === 'list') addList(token as Tokens.List, current ?? ensureRoot(), 1)
    else addBody(current ?? ensureRoot(), token)
  }
  ensureRoot()
  // The canonical body remains authoritative when its editable Markdown projection did
  // not change (Markdown cannot represent all editor marks/attributes).
  const restoreUnchangedBody = (node: MindMapNode) => {
    const original = baseNodes.get(String(node.data?.uid ?? ''))
    const oldBody = validateArticleBody(original?.data?.articleBody)
    const newBody = node.data?.articleBody as ArticleRichNode
    if (oldBody && richMarkdown(oldBody, []) === richMarkdown(newBody, [])) node.data!.articleBody = oldBody
    node.children?.forEach(restoreUnchangedBody)
  }
  if (identity) restoreUnchangedBody(root!)
  const validateBodies = (node: MindMapNode, depth: number) => {
    if (depth > ARTICLE_PACKAGE_LIMITS.depth) throw new Error('Article nesting exceeds depth limit')
    if (!validateArticleBody(node.data?.articleBody)) throw new Error('Imported article body exceeds supported rich-content limits')
    node.children?.forEach((child) => validateBodies(child, depth + 1))
  }
  validateBodies(root!, 0)
  return { document: normalizeMindMapDocument({ ...(identity ? structuredClone(identity.baseDocument) : {}), schemaVersion: 1, root: root! }), warnings }
}
export function importArticleMarkdown(markdown: string, options: MarkdownImportOptions = {}): ArticlePreview { return parseArticleMarkdown(markdown, options) }

const escapeText = (text: string) => text.replace(/([\\`*_[\]<>{}()#+.!|>~$-])/g, '\\$1').replace(/\r?\n/g, ' ')
function richMarkdown(node: ArticleRichNode, warnings: ArticleInterchangeWarning[]): string {
  const children = () => (node.content ?? []).map((child) => richMarkdown(child, warnings)).join('')
  if (node.type === 'text') {
    let text = escapeText(node.text ?? '')
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = `**${text}**`
      else if (mark.type === 'italic') text = `*${text}*`
      else if (mark.type === 'strike') text = `~~${text}~~`
      else if (mark.type === 'code') { const fence = '`'.repeat(Math.max(1, ...((node.text ?? '').match(/`+/g) ?? []).map((run) => run.length + 1))); text = `${fence} ${node.text} ${fence}` }
      else if (mark.type === 'link' && safeArticleUrl(String(mark.attrs?.href ?? ''))) text = `[${text}](<${String(mark.attrs?.href).replace(/>/g, '%3E')}>)`
      else warn(warnings, 'unsupported-content', `Markdown does not preserve the ${mark.type} mark; canonical package JSON retains it.`)
    }
    return text
  }
  if (node.type === 'doc') return (node.content ?? []).map((child) => richMarkdown(child, warnings).trimEnd()).filter(Boolean).join('\n\n')
  if (node.type === 'paragraph') return children()
  if (node.type === 'heading') return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${children()}`
  if (node.type === 'hardBreak') return '  \n'
  if (node.type === 'horizontalRule') return '---'
  if (node.type === 'image') { const src = String(node.attrs?.src ?? ''); return safeArticleUrl(src) ? `![${escapeText(String(node.attrs?.alt ?? ''))}](<${src.replace(/>/g, '%3E')}>)` : '' }
  if (node.type === 'inlineMath') return `$${String(node.attrs?.latex ?? '')}$`
  if (node.type === 'blockMath') return `$$\n${String(node.attrs?.latex ?? '')}\n$$`
  if (node.type === 'codeBlock') { const text = (node.content ?? []).map((child) => child.text ?? '').join(''); const fence = '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1))); return `${fence}${String(node.attrs?.language ?? '')}\n${text}\n${fence}` }
  if (node.type === 'blockquote') return (node.content ?? []).map((child) => richMarkdown(child, warnings)).join('\n\n').split('\n').map((line) => `> ${line}`).join('\n')
  if (node.type === 'table') {
    const rows = (node.content ?? []).map((row) => `| ${(row.content ?? []).map((cell) => (cell.content ?? []).map((child) => richMarkdown(child, warnings)).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`)
    if (rows.length) rows.splice(1, 0, `| ${(node.content?.[0]?.content ?? []).map(() => '---').join(' | ')} |`)
    return rows.join('\n')
  }
  if (node.type === 'bulletList' || node.type === 'orderedList') return (node.content ?? []).map((child, index) => `${node.type === 'orderedList' ? `${Number(node.attrs?.start ?? 1) + index}.` : '-'} ${richMarkdown(child, warnings).replace(/\n/g, '\n  ')}`).join('\n')
  if (node.type === 'listItem') return (node.content ?? []).map((child) => richMarkdown(child, warnings)).join('\n\n')
  warn(warnings, 'unsupported-content', `Unsupported rich node ${node.type} was omitted from Markdown.`)
  return ''
}
export function renderArticleMarkdown(input: MindMapDocumentInput, anchors: boolean): MarkdownExport {
  const document = normalizeMindMapDocument(input)
  const warnings: ArticleInterchangeWarning[] = []
  const lines: string[] = []
  const walk = (node: MindMapNode, depth: number) => {
    if (depth > ARTICLE_PACKAGE_LIMITS.depth) throw new Error('Article nesting exceeds depth limit')
    const indent = depth ? '  '.repeat(depth - 1) : ''
    const anchor = anchors ? ` <!-- memory-anki-node:${encodeURIComponent(String(node.data?.uid))} -->` : ''
    lines.push(`${indent}${depth ? '- ' : '# '}${escapeText(getMindMapNodeText(node))}${anchor}`, '')
    const validated = validateArticleBody(node.data?.articleBody)
    if (node.data?.articleBody !== undefined && !validated) warn(warnings, 'unsupported-content', 'An invalid rich body was omitted; only its legacy note fallback was exported.')
    const body = validated ?? createArticleBody(typeof node.data?.note === 'string' ? node.data.note : '')
    let content = richMarkdown(body, warnings)
    if (content && anchors) {
      let marker = 'body'
      while (content.includes(`memory-anki-body:${marker}`)) marker += '_'
      content = `<!-- memory-anki-body:${marker} -->\n${content}\n<!-- /memory-anki-body:${marker} -->`
    }
    if (content) lines.push(...content.split('\n').map((line) => `${depth ? `${indent}  ` : ''}${line}`), '')
    node.children?.forEach((child) => walk(child, depth + 1))
  }
  walk(document.root, 0)
  return { markdown: `${lines.join('\n').trimEnd()}\n`, warnings }
}
export function exportArticleMarkdown(input: MindMapDocumentInput): MarkdownExport {
  const result = renderArticleMarkdown(input, false)
  result.warnings.unshift({ code: 'plain-markdown-lossy', message: 'Plain Markdown contains article text only, not stable UIDs, backend bindings, or bundled assets. Use a complete package for identity-preserving reimport.' })
  return result
}
