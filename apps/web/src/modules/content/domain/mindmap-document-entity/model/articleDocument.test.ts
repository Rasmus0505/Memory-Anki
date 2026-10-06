import { describe, expect, it } from 'vitest'
import type { MindMapDocumentV1 } from './document'
import { addMindMapArticleNode, articleBodyToPlainText, createArticleBody, indentMindMapArticleNode, outdentMindMapArticleNode, projectMindMapArticle, updateMindMapArticleBody, validateArticleBody } from './articleDocument'

const source: MindMapDocumentV1 = {
  schemaVersion: 1,
  root: { data: { uid: 'root', text: 'Book', customRoot: 17 }, children: [
    { data: { uid: 'a', text: '<span data-emphasis="highlight">Title</span>', note: 'Legacy\nnotes', memoryAnkiId: 12, custom: { keep: true } }, children: [
      { data: { uid: 'a1', text: 'Child' }, children: [] },
    ] },
    { data: { uid: 'b', text: 'Second', memoryAnkiQuestionCard: true }, children: [
      { data: { uid: 'b1', text: 'Nested' }, children: [] },
    ] },
  ] },
}

describe('article document projection', () => {
  it('projects preorder with stable identity, title markup and legacy notes', () => {
    const blocks = projectMindMapArticle(source)
    expect(blocks.map(({ uid, parentUid, depth }) => [uid, parentUid, depth])).toEqual([
      ['root', null, 0], ['a', 'root', 1], ['a1', 'a', 2], ['b', 'root', 1], ['b1', 'b', 2],
    ])
    expect(blocks[1]?.storedText).toBe(source.root.children?.[0]?.data?.text)
    expect(blocks[1]?.text).toBe('Title')
    expect(articleBodyToPlainText(blocks[1]?.body)).toBe('Legacy\nnotes')
    expect(projectMindMapArticle(source, 'a').map((block) => block.uid)).toEqual(['root', 'a', 'a1'])
  })

  it('updates body without regenerating UIDs, deleting metadata, or replacing title and note', () => {
    const next = updateMindMapArticleBody(source, 'a', createArticleBody('Body'), 'list')
    expect(next.root.children?.[0]?.data).toEqual({ ...source.root.children?.[0]?.data, articleBody: createArticleBody('Body'), articleKind: 'list' })
    expect(source.root.children?.[0]?.data?.articleBody).toBeUndefined()
    expect(projectMindMapArticle(next)[1]?.kind).toBe('list')
    expect(next.root.children?.[1]).toEqual(source.root.children?.[1])
  })

  it('indents/outdents whole subtrees preserving metadata and identity', () => {
    const indented = indentMindMapArticleNode(source, 'b')
    expect(projectMindMapArticle(indented).find((item) => item.uid === 'b')?.parentUid).toBe('a')
    expect(projectMindMapArticle(indented).find((item) => item.uid === 'b1')?.parentUid).toBe('b')
    expect(outdentMindMapArticleNode(indented, 'b').root).toEqual(source.root)
    expect(projectMindMapArticle(indented).find((item) => item.uid === 'b')?.node.data?.memoryAnkiQuestionCard).toBe(true)
  })

  it('protects root, first sibling and scoped spine from structural edits', () => {
    const normalized = outdentMindMapArticleNode(source, 'root')
    expect(indentMindMapArticleNode(source, 'root')).toEqual(normalized)
    expect(indentMindMapArticleNode(source, 'a')).toEqual(normalized)
    expect(outdentMindMapArticleNode(source, 'a')).toEqual(normalized)
    expect(outdentMindMapArticleNode(source, 'a1', 'a')).toEqual(normalized)
    expect(indentMindMapArticleNode(source, 'b', 'b')).toEqual(normalized)
    expect(addMindMapArticleNode(source, 'root', 'child', 'a').nodeUid).toBeNull()
    expect(addMindMapArticleNode(source, 'a', 'sibling', 'a').nodeUid).toBeNull()
    const added = addMindMapArticleNode(source, 'a', 'child', 'a')
    expect(added.nodeUid).toBeTruthy()
    expect(projectMindMapArticle(added.document).find((item) => item.uid === added.nodeUid)?.parentUid).toBe('a')
    expect(addMindMapArticleNode(source, 'a', 'sibling').nodeUid).toBeTruthy()
  })
})

describe('bounded framework-free rich body validation', () => {
  it('accepts formatting, links and lists and clones input', () => {
    const body = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Hello', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com', target: '_blank', rel: 'noopener noreferrer nofollow', class: null } }] },
      { type: 'hardBreak' }, { type: 'text', text: 'world' },
    ] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] }] }] }
    expect(validateArticleBody(body)).toEqual(body)
    expect(validateArticleBody(body)).not.toBe(body)
    expect(articleBodyToPlainText(body)).toBe('Hello\nworld\nItem')
  })

  it.each(['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.test', 'java\nscript:x', ' https://example.com'])('rejects unsafe link %s', (href) => {
    expect(validateArticleBody({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }] }] })).toBeNull()
  })

  it('supports bounded tables, images and math without accepting executable attributes', () => {
    const body = { type: 'doc', content: [
      { type: 'table', content: [{ type: 'tableRow', content: [
        { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [120] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Header' }] }] },
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: 'x^2' } }] }] },
      ] }] },
      { type: 'image', attrs: { src: '/api/v1/assets/image.png', alt: 'Figure', title: null, width: 300, height: null } },
      { type: 'blockMath', attrs: { latex: 'E=mc^2' } },
    ] }
    expect(validateArticleBody(body)).toEqual(body)
    expect(articleBodyToPlainText(body)).toBe('Header\tx^2\nFigure\nE=mc^2')
    for (const attrs of [{ src: 'javascript:alert(1)' }, { src: 'data:image/svg+xml,evil' }, { src: '/safe.png', onerror: 'evil' }]) {
      expect(validateArticleBody({ type: 'doc', content: [{ type: 'image', attrs }] })).toBeNull()
    }
    expect(validateArticleBody({ type: 'doc', content: [{ type: 'tableCell', attrs: { colspan: 1_000 } }] })).toBeNull()
  })

  it('rejects unknown nodes, attributes, malformed text, oversize and cyclic bodies', () => {
    expect(validateArticleBody({ type: 'doc', content: [{ type: 'image', attrs: { src: 'x' } }] })).toBeNull()
    expect(validateArticleBody({ type: 'doc', attrs: { onclick: 'x' } })).toBeNull()
    expect(validateArticleBody({ type: 'doc', content: [{ type: 'text', text: '' }] })).toBeNull()
    expect(validateArticleBody(createArticleBody('x'.repeat(200_001)))).toBeNull()
    const cyclic: { type: string; content?: unknown[] } = { type: 'doc' }
    cyclic.content = [cyclic]
    expect(validateArticleBody(cyclic)).toBeNull()
    expect(() => updateMindMapArticleBody(source, 'a', { type: 'script' })).toThrow('Invalid article body')
    expect(articleBodyToPlainText(null)).toBe('')
  })
})
