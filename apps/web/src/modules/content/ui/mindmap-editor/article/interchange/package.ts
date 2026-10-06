import { inflateSync, strFromU8, strToU8, zipSync } from 'fflate'
import { normalizeMindMapDocument, type MindMapDocumentInput, type MindMapDocumentV1, type MindMapNode } from '@/modules/content/domain/mindmap-document-entity/model/document'
import { validateArticleBody, type ArticleRichNode } from '@/modules/content/domain/mindmap-document-entity/model/articleDocument'
import { parseArticleMarkdown, renderArticleMarkdown, safeArticleUrl } from './markdown'
import { ARTICLE_PACKAGE_LIMITS as LIMIT, type ArticlePackageManifest, type ArticlePackageOptions, type ArticlePackagePreview, type ArticleInterchangeWarning } from './types'

const CORE_PATHS = new Set(['manifest.json', 'document.json', 'base-document.json', 'content.md', 'quiz.json'])
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
export function validateArticlePackagePath(path: string): void {
  let decoded: string
  try { decoded = decodeURIComponent(path) } catch { throw new Error('Invalid ZIP path encoding') }
  if (!path || path.length > 240 || Array.from(decoded).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '\\' || char === ':') || decoded.startsWith('/') || decoded.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe ZIP path: ${path}`)
}
/** Check the central AND local directories before fflate can allocate expanded buffers. */
interface ZipEntry { size: number; crc: number; start: number; compressed: number; method: number }
const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let crc = index
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  return crc >>> 0
})
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function preflightZip(bytes: Uint8Array): Map<string, ZipEntry> {
  if (bytes.byteLength > LIMIT.compressedBytes) throw new Error('ZIP compressed size limit exceeded')
  if (bytes.byteLength < 22) throw new Error('Invalid ZIP')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
    if (view.getUint32(index, true) === 0x06054b50 && index + 22 + view.getUint16(index + 20, true) === bytes.length) { end = index; break }
  }
  if (end < 0) throw new Error('ZIP end directory is missing')
  const count = view.getUint16(end + 10, true)
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count === 65535 || count > LIMIT.entries) throw new Error('ZIP entry count or disk format is unsupported')
  const directorySize = view.getUint32(end + 12, true)
  let offset = view.getUint32(end + 16, true)
  if (offset + directorySize !== end) throw new Error('Invalid ZIP central directory bounds')
  const files = new Map<string, ZipEntry>()
  const folded = new Set<string>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let expanded = 0
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP directory entry')
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressed = view.getUint32(offset + 20, true)
    const size = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const local = view.getUint32(offset + 42, true)
    const next = offset + 46 + nameLength + extraLength + commentLength
    if (next > end || flags & 1 || ![0, 8].includes(method) || size > LIMIT.entryBytes || compressed === 0xffffffff || local === 0xffffffff) throw new Error('Unsupported or oversized ZIP entry')
    expanded += size
    if (expanded > LIMIT.expandedBytes) throw new Error('ZIP expanded size limit exceeded')
    const path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    validateArticlePackagePath(path)
    if (files.has(path) || folded.has(path.toLowerCase())) throw new Error('Duplicate ZIP path')
    if (local + 30 > offset || view.getUint32(local, true) !== 0x04034b50) throw new Error('Invalid ZIP local header')
    const localNameLength = view.getUint16(local + 26, true)
    const localExtraLength = view.getUint16(local + 28, true)
    const dataOffset = local + 30 + localNameLength + localExtraLength
    if (dataOffset + compressed > offset || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) !== path || view.getUint16(local + 8, true) !== method) throw new Error('ZIP local directory mismatch')
    files.set(path, { size, crc: view.getUint32(offset + 16, true), start: dataOffset, compressed, method }); folded.add(path.toLowerCase()); offset = next
  }
  if (offset !== end) throw new Error('ZIP directory count mismatch')
  return files
}
function canonicalHtmlIsSafe(value: string): boolean {
  // Accept only the exact passive markup produced by mindmapRichText; unlike its
  // permissive legacy sanitizer, this never accepts arbitrary span attributes.
  const withoutKnownTags = value.replace(/<\/?(?:div|u|mark|span)>|<br\s*\/?>|<span data-emphasis="highlight" style="background-color:#fef08c;color:inherit">/g, '')
  return !/<[\s\S]*?>/.test(withoutKnownTags)
}
function validateDocument(value: unknown): MindMapDocumentV1 {
  if (!record(value) || value.schemaVersion !== 1 || !record(value.root)) throw new Error('Invalid canonical article document')
  let count = 0
  const uids = new Set<string>()
  const visit = (node: unknown, depth: number) => {
    if (!record(node) || !record(node.data) || typeof node.data.uid !== 'string' || !node.data.uid || typeof node.data.text !== 'string') throw new Error('Canonical node requires text and UID')
    if (++count > LIMIT.nodes || depth > LIMIT.depth) throw new Error('Canonical document exceeds limits')
    if (uids.has(node.data.uid)) throw new Error('Duplicate canonical UID')
    uids.add(node.data.uid)
    // Reject HTML in imported canonical strings instead of passing it to a browser sink.
    if (!canonicalHtmlIsSafe(node.data.text) || (typeof node.data.note === 'string' && !canonicalHtmlIsSafe(node.data.note))) throw new Error('Canonical HTML requires sanitization before packaging')
    if (node.data.articleBody !== undefined) {
      const body = validateArticleBody(node.data.articleBody)
      if (!body) throw new Error('Invalid or unsafe canonical rich body')
      const checkUrls = (rich: ArticleRichNode) => {
        if (rich.type === 'image' && !safeArticleUrl(String(rich.attrs?.src ?? ''))) throw new Error('Unsafe canonical image URL')
        if (rich.marks?.some((mark) => mark.type === 'link' && !safeArticleUrl(String(mark.attrs?.href ?? '')))) throw new Error('Unsafe canonical link URL')
        rich.content?.forEach(checkUrls)
      }
      checkUrls(body)
    }
    if (node.children !== undefined && !Array.isArray(node.children)) throw new Error('Invalid canonical children')
    for (const child of (node.children ?? []) as unknown[]) visit(child, depth + 1)
  }
  visit(value.root, 0)
  return normalizeMindMapDocument(value)
}
function validateManifest(value: unknown): ArticlePackageManifest {
  if (!record(value) || value.format !== 'memory-anki-article' || value.version !== 1) throw new Error('Unsupported article package version')
  if (typeof value.sourceOwner !== 'string' || !value.sourceOwner.trim() || value.sourceOwner.length > 500 || (value.baseRevision !== null && typeof value.baseRevision !== 'string')) throw new Error('Invalid package source owner/revision')
  if (value.document !== 'document.json' || value.baseDocument !== 'base-document.json' || value.content !== 'content.md' || !Array.isArray(value.assets)) throw new Error('Invalid article package manifest')
  const paths = new Set<string>()
  const sources = new Set<string>()
  for (const asset of value.assets) {
    if (!record(asset) || typeof asset.source !== 'string' || !asset.source || typeof asset.path !== 'string' || typeof asset.mediaType !== 'string' || !asset.mediaType) throw new Error('Invalid package asset declaration')
    validateArticlePackagePath(asset.path)
    if (!safeArticleUrl(asset.source) || !validateArticleBody({ type: 'doc', content: [{ type: 'image', attrs: { src: asset.source } }] })) throw new Error('Unsafe package asset source')
    if (!/^assets\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(asset.path) || asset.path.includes('..') || CORE_PATHS.has(asset.path) || paths.has(asset.path) || sources.has(asset.source)) throw new Error('Duplicate or invalid package asset')
    paths.add(asset.path); sources.add(asset.source)
  }
  if (value.quiz !== null && (!record(value.quiz) || value.quiz.path !== 'quiz.json' || typeof value.quiz.format !== 'string' || !value.quiz.format)) throw new Error('Invalid quiz package declaration')
  return value as unknown as ArticlePackageManifest
}
function mapImages(document: MindMapDocumentV1, references: Map<string, string>): Set<string> {
  const found = new Set<string>()
  const rich = (body: ArticleRichNode) => {
    if (body.type === 'image' && typeof body.attrs?.src === 'string') { found.add(body.attrs.src); if (references.has(body.attrs.src)) body.attrs.src = references.get(body.attrs.src)! }
    body.content?.forEach(rich)
  }
  const visit = (node: MindMapNode) => { if (node.data?.articleBody) rich(node.data.articleBody as ArticleRichNode); node.children?.forEach(visit) }
  visit(document.root)
  return found
}
function jsonBytes(value: unknown): Uint8Array { return strToU8(JSON.stringify(value, null, 2)) }
export function exportArticlePackage(input: MindMapDocumentInput, options: ArticlePackageOptions): { bytes: Uint8Array; manifest: ArticlePackageManifest; warnings: ArticleInterchangeWarning[] } {
  const canonical = validateDocument(normalizeMindMapDocument(input))
  const assets = options.assets ?? []
  const manifest = validateManifest({ format: 'memory-anki-article', version: 1, sourceOwner: options.sourceOwner, baseRevision: options.baseRevision ?? null, document: 'document.json', baseDocument: 'base-document.json', content: 'content.md', assets: assets.map(({ source, path, mediaType }) => ({ source, path, mediaType })), quiz: options.quiz ? { path: 'quiz.json', format: options.quiz.format } : null })
  const portable = structuredClone(canonical)
  const references = new Map(assets.map((asset) => [asset.source, asset.path]))
  const images = mapImages(portable, references)
  const missing = [...images].filter((source) => !references.has(source))
  // A package advertised as self-contained must never silently retain network image dependencies.
  if (missing.length) throw new Error(`Missing packaged image assets: ${missing.join(', ')}`)
  const result = renderArticleMarkdown(portable, true)
  const files: Record<string, Uint8Array> = { 'manifest.json': jsonBytes(manifest), 'document.json': jsonBytes(canonical), 'base-document.json': jsonBytes(canonical), 'content.md': strToU8(result.markdown) }
  for (const asset of assets) files[asset.path] = asset.bytes
  if (options.quiz) files['quiz.json'] = jsonBytes(options.quiz.data)
  if (Object.keys(files).length > LIMIT.entries || Object.values(files).some((bytes) => bytes.length > LIMIT.entryBytes) || Object.values(files).reduce((sum, bytes) => sum + bytes.length, 0) > LIMIT.expandedBytes) throw new Error('Article package exceeds size or entry limits')
  const bytes = zipSync(files, { level: 6 })
  preflightZip(bytes)
  const warnings = result.warnings
  if (!options.quiz) warnings.push({ code: 'quiz-not-packaged', message: 'Quiz records and backend bindings were not supplied; this package does not back them up.' })
  return { bytes, manifest, warnings }
}
export function importArticlePackage(bytes: Uint8Array, options: { expectedSourceOwner?: string; createUid?: () => string } = {}): ArticlePackagePreview {
  const entries = preflightZip(bytes)
  const files: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>
  for (const [path, entry] of entries) {
    const compressed = bytes.subarray(entry.start, entry.start + entry.compressed)
    // One sentinel byte detects forged smaller sizes; unzipSync's exact-size
    // output buffer otherwise silently truncates overflowing DEFLATE streams.
    const expanded = entry.method === 0 ? compressed.slice() : inflateSync(compressed, { out: new Uint8Array(entry.size + 1) })
    if (expanded.length !== entry.size) throw new Error('ZIP extracted size mismatch')
    if (crc32(expanded) !== entry.crc) throw new Error('ZIP entry checksum mismatch')
    files[path] = expanded
  }
  const readJson = (path: string): unknown => { if (!files[path]) throw new Error(`Missing package file: ${path}`); try { return JSON.parse(strFromU8(files[path])) as unknown } catch { throw new Error(`Invalid JSON in ${path}`) } }
  const manifest = validateManifest(readJson('manifest.json'))
  const declared = new Set(['manifest.json', manifest.document, manifest.baseDocument, manifest.content, ...manifest.assets.map((asset) => asset.path), ...(manifest.quiz ? [manifest.quiz.path] : [])])
  for (const path of entries.keys()) if (!declared.has(path)) throw new Error(`Undeclared package entry: ${path}`)
  for (const path of declared) if (!entries.has(path)) throw new Error(`Missing package file: ${path}`)
  const canonical = validateDocument(readJson(manifest.document))
  const baseDocument = validateDocument(readJson(manifest.baseDocument))
  const portable = structuredClone(canonical)
  mapImages(portable, new Map(manifest.assets.map((asset) => [asset.source, asset.path])))
  const markdown = strFromU8(files[manifest.content])
  const preview = parseArticleMarkdown(markdown, { createUid: options.createUid }, { baseDocument: portable })
  const importedImages = mapImages(preview.document, new Map(manifest.assets.map((asset) => [asset.path, asset.source])))
  const packagedReferences = new Set(manifest.assets.flatMap((asset) => [asset.path, asset.source]))
  if ([...importedImages].some((source) => !packagedReferences.has(source))) preview.warnings.push({ code: 'external-assets', message: 'Edited Markdown references images not contained in this package. Resolve and validate those assets before applying.' })
  if (options.expectedSourceOwner !== undefined && options.expectedSourceOwner !== manifest.sourceOwner) preview.warnings.push({ code: 'owner-mismatch', message: 'Package source owner differs from the current owner. Do not apply backend bindings without explicit reconciliation.' })
  if (!manifest.quiz) preview.warnings.push({ code: 'quiz-not-packaged', message: 'This package contains no quiz backup. Existing backend bindings require host reconciliation.' })
  return { ...preview, manifest, baseDocument, assets: manifest.assets.map((asset) => ({ ...asset, bytes: files[asset.path] })), quiz: manifest.quiz ? { format: manifest.quiz.format, data: readJson(manifest.quiz.path) } : null, requiresReconciliation: true }
}
