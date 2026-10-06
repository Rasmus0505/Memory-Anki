// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { validateArticleBody } from '@/modules/content/domain/mindmap-document-entity/model/articleDocument'
import type { MindMapDocumentV1 } from '@/modules/content/domain/mindmap-document-entity/model/document'
import { ARTICLE_PACKAGE_LIMITS, exportArticleMarkdown, exportArticlePackage, importArticleMarkdown, importArticlePackage, validateArticlePackagePath } from './index'

const ids = () => { let index = 0; return () => `new-${++index}` }
const sample = (): MindMapDocumentV1 => ({ schemaVersion: 1, config: { article: true }, root: { data: { uid: 'root-u', text: 'Article', note: 'Legacy note', memoryAnkiId: 7, articleBody: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A body', marks: [{ type: 'highlight', attrs: { color: '#ffff00' } }] }] }] } }, children: [
  { data: { uid: 'a-u', text: 'Repeated title', memoryAnkiId: 8, customMetadata: { preserve: true } }, children: [{ data: { uid: 'deep-u', text: 'Deep node' }, children: [] }] },
  { data: { uid: 'b-u', text: 'Repeated title', memoryAnkiId: 9 }, children: [] },
] } })
function editPackage(bytes: Uint8Array, edit: (files: Record<string, Uint8Array>) => void): Uint8Array { const files = unzipSync(bytes); edit(files); return zipSync(files) }
function editMarkdown(bytes: Uint8Array, edit: (text: string) => string): Uint8Array { return editPackage(bytes, (files) => { files['content.md'] = strToU8(edit(strFromU8(files['content.md']))) }) }

describe('article Markdown interchange', () => {
  it('maps headings and nested lists to nodes, with rich blocks owned by their section', () => {
    const result = importArticleMarkdown('# Title\n\nIntro **bold**.\n\n## Section\n\n- First\n\n  Detail *italic*.\n\n  - Nested\n- Second\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![Figure](/api/image.png)\n\n```ts\nconst a = 1\n```\n\n$$\nx^2\n$$\n', { createUid: ids() })
    expect(result.document.root.data?.text).toBe('Title')
    const section = result.document.root.children![0]
    expect(section.data?.text).toBe('Section')
    expect(section.children?.map((node) => node.data?.text)).toEqual(['First', 'Second'])
    expect(section.children?.[0].children?.[0].data?.text).toBe('Nested')
    expect(JSON.stringify(section.children?.[0].data?.articleBody)).toContain('Detail')
    const body = section.data?.articleBody as { content: { type: string }[] }
    expect(body.content.map((node) => node.type)).toEqual(['table', 'image', 'codeBlock', 'blockMath'])
    expect(validateArticleBody(body)).not.toBeNull()
  })
  it('supports plain prose without invented section title matches', () => {
    const result = importArticleMarkdown('Paragraph one.\n\nParagraph two.', { title: 'My file', createUid: ids() })
    expect(result.document.root.data?.text).toBe('My file')
    expect(result.document.root.children).toEqual([])
    expect(JSON.stringify(result.document.root.data?.articleBody)).toContain('Paragraph two.')
  })
  it('keeps inline math and link marks as editable JSON', () => {
    const result = importArticleMarkdown('# Root\n\nEnergy $E=mc^2$ and [link](https://example.com).')
    expect(JSON.stringify(result.document.root.data?.articleBody)).toContain('inlineMath')
    expect(JSON.stringify(result.document.root.data?.articleBody)).toContain('https://example.com')
  })
  it('does not trust raw HTML, unsafe URL schemes, or standalone UID comments', () => {
    const result = importArticleMarkdown('# Hello <!-- memory-anki-node:trusted -->\n\n<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) ![bad](data:text/html,hi)', { createUid: ids() })
    expect(result.document.root.data?.uid).toBe('new-1')
    expect(result.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining(['identity-unverified', 'html-removed', 'unsafe-url']))
    expect(JSON.stringify(result.document)).not.toContain('javascript:')
    expect(JSON.stringify(result.document)).not.toContain('<script>')
  })
  it('exports ordinary Markdown rather than the legacy Peg dialect', () => {
    const result = exportArticleMarkdown(sample())
    expect(result.markdown).toContain('# Article')
    expect(result.markdown).toContain('- Repeated title')
    expect(result.markdown).not.toContain('memory-anki-node:')
    expect(result.warnings.some((warning) => warning.code === 'plain-markdown-lossy')).toBe(true)
  })
  it('round trips tables, images, fenced code, and math in plain article Markdown', () => {
    const input = '# Root\n\n| A | B |\n| --- | --- |\n| X | Y |\n\n![Figure](/image.png)\n\n````js\n```\n````\n\n$$\nx+y\n$$\n'
    const first = importArticleMarkdown(input)
    const second = importArticleMarkdown(exportArticleMarkdown(first.document).markdown)
    expect(second.document.root.data?.articleBody).toEqual(first.document.root.data?.articleBody)
  })
  it('bounds Markdown input and refuses nonunique supplied UID factories', () => {
    expect(() => importArticleMarkdown('x'.repeat(ARTICLE_PACKAGE_LIMITS.markdownChars + 1))).toThrow(/size limit/)
    expect(() => importArticleMarkdown('# A\n## B', { createUid: () => 'same' })).toThrow(/unique UID/)
  })
})

describe('complete article package', () => {
  it('carries canonical, editable, base, owner, version, and exact unchanged rich metadata', () => {
    const original = sample()
    const result = exportArticlePackage(original, { sourceOwner: 'palace:7', baseRevision: 'r1' })
    const files = unzipSync(result.bytes)
    expect(Object.keys(files).sort()).toEqual(['base-document.json', 'content.md', 'document.json', 'manifest.json'])
    const preview = importArticlePackage(result.bytes)
    expect(preview.manifest).toMatchObject({ version: 1, sourceOwner: 'palace:7', baseRevision: 'r1' })
    expect(preview.document.root.data?.uid).toBe('root-u')
    expect(preview.document.root.data?.articleBody).toEqual(original.root.data?.articleBody)
    expect(preview.document.root.data?.note).toBe('Legacy note')
    expect(preview.document.root.children?.[0].data?.customMetadata).toEqual({ preserve: true })
    expect(preview.baseDocument.root).toEqual(original.root)
    expect(preview.requiresReconciliation).toBe(true)
    expect(original).toEqual(sample())
  })
  it('preserves canonical highlight titles and body-owned headings/lists when another node changes', () => {
    const document = sample()
    document.root.data!.text = '<div><span data-emphasis="highlight" style="background-color:#fef08c;color:inherit">Article</span></div>'
    document.root.data!.articleBody = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Body heading' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body list' }] }] }] },
    ] }
    const bytes = exportArticlePackage(document, { sourceOwner: 'palace:7' }).bytes
    const result = importArticlePackage(editMarkdown(bytes, (text) => text.replace('Deep node', 'Edited deep node')))
    expect(result.document.root.data?.text).toBe(document.root.data?.text)
    expect(result.document.root.data?.articleBody).toEqual(document.root.data?.articleBody)
    expect(result.document.root.children).toHaveLength(2)
  })
  it('retains UID and canonical metadata when an anchored node title/body is edited', () => {
    const bytes = exportArticlePackage(sample(), { sourceOwner: 'palace:7' }).bytes
    const edited = editMarkdown(bytes, (text) => text.replace('Repeated title <!-- memory-anki-node:a-u', 'Renamed <!-- memory-anki-node:a-u').replace('A body', 'Changed body'))
    const result = importArticlePackage(edited)
    expect(result.document.root.children?.[0].data).toMatchObject({ uid: 'a-u', text: 'Renamed', memoryAnkiId: 8 })
    expect(JSON.stringify(result.document.root.data?.articleBody)).toContain('Changed body')
    expect(result.document.root.children?.[1].data?.uid).toBe('b-u')
  })
  it('never guesses identity for duplicate anchors or repeated titles with missing anchors', () => {
    const bytes = exportArticlePackage(sample(), { sourceOwner: 'palace:7' }).bytes
    const duplicate = importArticlePackage(editMarkdown(bytes, (text) => text.replace('memory-anki-node:b-u', 'memory-anki-node:a-u')), { createUid: ids() })
    expect(duplicate.document.root.children?.map((node) => node.data?.uid)).toEqual(['new-1', 'new-2'])
    expect(duplicate.document.root.children?.map((node) => node.data?.memoryAnkiId)).toEqual([undefined, undefined])
    expect(duplicate.warnings.some((warning) => warning.code === 'identity-ambiguous')).toBe(true)
    const missing = importArticlePackage(editMarkdown(bytes, (text) => text.replace(' <!-- memory-anki-node:b-u -->', '')), { createUid: ids() })
    expect(missing.document.root.children?.[1].data?.uid).toBe('new-1')
    expect(missing.warnings.some((warning) => warning.code === 'identity-missing')).toBe(true)
  })
  it('keeps anchored IDs when reordered without title matching', () => {
    const bytes = exportArticlePackage(sample(), { sourceOwner: 'palace:7' }).bytes
    const moved = editMarkdown(bytes, (text) => text.replace('- Repeated title <!-- memory-anki-node:a-u -->\n\n  - Deep node <!-- memory-anki-node:deep-u -->\n\n- Repeated title <!-- memory-anki-node:b-u -->', '- Repeated title <!-- memory-anki-node:b-u -->\n\n- Repeated title <!-- memory-anki-node:a-u -->\n\n  - Deep node <!-- memory-anki-node:deep-u -->'))
    expect(importArticlePackage(moved).document.root.children?.map((node) => node.data?.uid)).toEqual(['b-u', 'a-u'])
  })
  it('bundles actual assets and opaque quiz data without claiming to restore backend bindings', () => {
    const document = sample()
    document.root.data!.articleBody = { type: 'doc', content: [{ type: 'image', attrs: { src: '/api/assets/1', alt: 'Test', title: null } }] }
    expect(() => exportArticlePackage(document, { sourceOwner: 'palace:7' })).toThrow(/Missing packaged image/)
    const result = exportArticlePackage(document, { sourceOwner: 'palace:7', assets: [{ source: '/api/assets/1', path: 'assets/image.png', mediaType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }], quiz: { format: 'host-test-v1', data: { bindings: [{ node_uid: 'a-u' }] } } })
    expect(strFromU8(unzipSync(result.bytes)['content.md'])).toContain('assets/image.png')
    const preview = importArticlePackage(result.bytes, { expectedSourceOwner: 'palace:other' })
    expect(preview.assets[0].bytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(preview.quiz?.data).toEqual({ bindings: [{ node_uid: 'a-u' }] })
    expect(JSON.stringify(preview.document.root.data?.articleBody)).toContain('/api/assets/1')
    expect(preview.warnings.some((warning) => warning.code === 'owner-mismatch')).toBe(true)
  })
  it.each(['../escape', '/absolute', 'C:/drive', 'assets\\escape', 'assets/../escape', 'assets/%2e%2e/escape', 'assets//empty', 'assets/end/'])('rejects unsafe ZIP path %s', (path) => {
    expect(() => validateArticlePackagePath(path)).toThrow()
    expect(() => importArticlePackage(zipSync({ [path]: strToU8('x') }))).toThrow()
  })
  it('detects forged small expanded sizes instead of silently truncating DEFLATE output', () => {
    const bytes = zipSync({ 'content.md': strToU8('a'.repeat(1000)) }, { level: 6 })
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < bytes.length - 46; index++) {
      if (view.getUint32(index, true) === 0x02014b50) { view.setUint32(index + 24, 10, true); break }
    }
    expect(() => importArticlePackage(bytes)).toThrow(/extracted size mismatch/)
  })
  it('rejects checksum corruption and unsafe asset remapping declarations', () => {
    const bytes = exportArticlePackage(sample(), { sourceOwner: 'palace:7' }).bytes
    const corrupt = bytes.slice()
    const view = new DataView(corrupt.buffer)
    for (let index = 0; index < corrupt.length - 46; index++) {
      if (view.getUint32(index, true) === 0x02014b50) { view.setUint32(index + 16, 123, true); break }
    }
    expect(() => importArticlePackage(corrupt)).toThrow(/checksum/)
    const unsafe = editPackage(bytes, (files) => {
      const manifest = JSON.parse(strFromU8(files['manifest.json']))
      manifest.assets = [{ source: 'javascript:alert(1)', path: 'assets/test.png', mediaType: 'image/png' }]
      files['assets/test.png'] = new Uint8Array([1])
      files['manifest.json'] = strToU8(JSON.stringify(manifest))
    })
    expect(() => importArticlePackage(unsafe)).toThrow(/Unsafe package asset source/)
  })
  it('warns when edited Markdown introduces unbundled images', () => {
    const bytes = exportArticlePackage(sample(), { sourceOwner: 'palace:7' }).bytes
    const result = importArticlePackage(editMarkdown(bytes, (text) => text.replace('A body', '![new](https://example.com/new.png)')))
    expect(result.warnings.some((warning) => warning.code === 'external-assets')).toBe(true)
  })
  it('never promotes escaped HTML titles into active canonical rich text', () => {
    const document = sample()
    document.root.data!.richText = true
    const bytes = exportArticlePackage(document, { sourceOwner: 'palace:7' }).bytes
    const result = importArticlePackage(editMarkdown(bytes, (text) => text.replace('# Article', '# \\<img src=x onerror=alert(1)\\>')))
    expect(result.document.root.data?.richText).toBeUndefined()
    expect(String(result.document.root.data?.text)).not.toContain('<img')
  })
  it('rejects oversized expanded entries before decompression', () => {
    const bytes = zipSync({ 'large.txt': new Uint8Array(ARTICLE_PACKAGE_LIMITS.entryBytes + 1) })
    expect(() => importArticlePackage(bytes)).toThrow(/oversized/)
  })
  it('rejects excessive ZIP entry counts and undeclared files', () => {
    const entries = Object.fromEntries(Array.from({ length: ARTICLE_PACKAGE_LIMITS.entries + 1 }, (_, index) => [`file-${index}`, new Uint8Array()]))
    expect(() => importArticlePackage(zipSync(entries))).toThrow(/entry count/)
    const bytes = exportArticlePackage(sample(), { sourceOwner: 'palace:7' }).bytes
    expect(() => importArticlePackage(editPackage(bytes, (files) => { files['surprise.txt'] = strToU8('hi') }))).toThrow(/Undeclared/)
  })
  it('rejects malformed or unsupported manifests, missing files, duplicate UID canonical data and unsafe rich content', () => {
    const bytes = exportArticlePackage(sample(), { sourceOwner: 'palace:7' }).bytes
    expect(() => importArticlePackage(editPackage(bytes, (files) => { files['manifest.json'] = strToU8('{') }))).toThrow(/Invalid JSON/)
    expect(() => importArticlePackage(editPackage(bytes, (files) => { const manifest = JSON.parse(strFromU8(files['manifest.json'])); manifest.version = 2; files['manifest.json'] = strToU8(JSON.stringify(manifest)) }))).toThrow(/version/)
    expect(() => importArticlePackage(editPackage(bytes, (files) => { delete files['content.md'] }))).toThrow(/Missing package/)
    expect(() => importArticlePackage(editPackage(bytes, (files) => { files['document.json'] = strToU8(strFromU8(files['document.json']).replace('"a-u"', '"root-u"')) }))).toThrow(/Duplicate canonical UID/)
    expect(() => importArticlePackage(editPackage(bytes, (files) => { files['document.json'] = strToU8(strFromU8(files['document.json']).replace('"Article"', '"<img src=x onerror=alert(1)>"')) }))).toThrow(/HTML requires sanitization/)
  })
})
