import { ARTICLE_QUIZ_FORMAT, fetchArticleAssetApi, getArticlePackageSourceApi, transferArticleApi, type ArticleTransferAsset, type ArticleTransferRequest, type ArticleTransferResponse } from '../api/articlePackageApi'
import { invalidatePalaceCatalogCache } from '../domain/palace-entity/api/catalogApi'
import type { MindMapDocumentV1, MindMapNode } from '../domain/mindmap-document-entity/model/document'

export interface ArticleTransferInput {
  document: MindMapDocumentV1
  manifest?: { sourceOwner: string; baseRevision: string | null }
  baseDocument?: MindMapDocumentV1
  assets?: ArticleTransferAsset[]
  quiz?: { format: string; data: unknown } | null
}
export interface ArticleTransferHost {
  ownerId: string
  operationId: string
  palaceId: number | null
  revision: string | null
  document: MindMapDocumentV1
  dirty: boolean
}
export interface ArticleTransferComparison {
  added: string[]
  removed: string[]
  changed: string[]
  sourceOwnerMatches: boolean
  revisionMatches: boolean
  canUpdate: boolean
  hasQuiz: boolean
  assetCount: number
}
function nodes(document: MindMapDocumentV1): Map<string, MindMapNode> {
  const result = new Map<string, MindMapNode>()
  const visit = (node: MindMapNode) => {
    const uid = node.data?.uid
    if (!uid || result.has(uid)) throw new Error('文章节点 UID 缺失或重复')
    result.set(uid, node)
    for (const child of node.children ?? []) visit(child)
  }
  visit(document.root)
  return result
}
export function compareArticleTransfer(input: ArticleTransferInput, host: ArticleTransferHost): ArticleTransferComparison {
  const current = nodes(host.document), incoming = nodes(input.document)
  const sourceOwnerMatches = input.manifest?.sourceOwner === host.ownerId
  const revisionMatches = Boolean(host.revision && input.manifest?.baseRevision === host.revision)
  return {
    added: [...incoming.keys()].filter((uid) => !current.has(uid)),
    removed: [...current.keys()].filter((uid) => !incoming.has(uid)),
    changed: [...incoming.keys()].filter((uid) => current.has(uid) && (
      JSON.stringify(current.get(uid)?.data) !== JSON.stringify(incoming.get(uid)?.data)
      || JSON.stringify(current.get(uid)?.children?.map((node) => node.data?.uid) ?? []) !== JSON.stringify(incoming.get(uid)?.children?.map((node) => node.data?.uid) ?? [])
    )),
    sourceOwnerMatches, revisionMatches,
    canUpdate: sourceOwnerMatches && revisionMatches && !host.dirty,
    hasQuiz: Boolean(input.quiz), assetCount: input.assets?.length ?? 0,
  }
}
function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary)
}
export interface ArticleTransferOptions {
  mode: ArticleTransferRequest['mode']
  parentUid?: string
  confirmReplace?: boolean
  title?: string
}
/** Caller freezes or flushes the shared document session before invocation. Never mutates host state. */
export async function applyArticleTransfer(
  input: ArticleTransferInput,
  captured: ArticleTransferHost,
  options: ArticleTransferOptions,
  readHost: () => ArticleTransferHost,
): Promise<{ result: ArticleTransferResponse; stale: boolean }> {
  const stillCurrent = () => {
    const current = readHost()
    return current.ownerId === captured.ownerId && current.operationId === captured.operationId
      && current.revision === captured.revision && current.dirty === captured.dirty
      && JSON.stringify(current.document) === JSON.stringify(captured.document)
  }
  if (!stillCurrent()) throw new Error('文章传输操作已过期，请重新预览')
  if (options.mode !== 'create' && captured.dirty) throw new Error('请先保存当前编辑；导入不会丢弃共享草稿')
  if (options.mode !== 'create' && (!captured.palaceId || !captured.revision)) throw new Error('缺少目标宫殿或保存版本')
  if (options.mode === 'update' && !compareArticleTransfer(input, captured).canUpdate) throw new Error('文章包来源或版本不匹配，请另存为新宫殿')
  if (['replace', 'update'].includes(options.mode) && !options.confirmReplace) throw new Error('请比较变更并明确确认替换')
  if (options.mode === 'append' && !nodes(captured.document).has(options.parentUid ?? '')) throw new Error('请选择有效追加节点')
  if (input.quiz && (input.quiz.format !== ARTICLE_QUIZ_FORMAT || !input.quiz.data || typeof input.quiz.data !== 'object' || Array.isArray(input.quiz.data))) throw new Error('不支持的题目包格式；未忽略题目数据')
  const command: ArticleTransferRequest = {
    mode: options.mode, owner_id: captured.ownerId, operation_id: captured.operationId,
    document: input.document, expected_revision: captured.revision ?? undefined,
    source_owner: input.manifest?.sourceOwner, base_revision: input.manifest?.baseRevision,
    parent_uid: options.parentUid, confirm_replace: options.confirmReplace, title: options.title,
    assets: (input.assets ?? []).map((asset) => ({ source: asset.source, name: asset.path.split('/').at(-1) ?? 'image', media_type: asset.mediaType, base64: encodeBytes(asset.bytes) })),
    quiz: input.quiz?.data as Record<string, unknown> | null ?? null,
  }
  const result = await transferArticleApi(options.mode === 'create' ? null : captured.palaceId, command)
  invalidatePalaceCatalogCache()
  // A successful save may finish after navigation or a new edit. Never hydrate that newer owner/session.
  const stale = !stillCurrent() || result.owner_id !== captured.ownerId || result.operation_id !== captured.operationId
  return { result, stale }
}

function imageSources(value: unknown, result = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    // Quiz stems/analysis and legacy notes can embed attachment URLs in HTML/Markdown.
    for (const match of value.matchAll(/\/api\/v1\/attachments\/\d+/g)) result.add(match[0])
    if (/<img\b/i.test(value)) {
      for (const match of value.matchAll(/\bsrc=["']([^"']+)["']/gi)) result.add(match[1])
    }
    for (const match of value.matchAll(/!\[[^\]]*\]\(([^\s)]+)/g)) result.add(match[1])
  } else if (Array.isArray(value)) value.forEach((item) => imageSources(item, result))
  else if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    if (object.type === 'image' && object.attrs && typeof object.attrs === 'object') {
      const src = (object.attrs as Record<string, unknown>).src
      if (typeof src === 'string') result.add(src)
    }
    // Legacy mind-map images must also travel; unfamiliar references fail explicitly.
    if (typeof object.image === 'string' && object.image) result.add(object.image)
    Object.values(object).forEach((item) => imageSources(item, result))
  }
  return result
}
/** Pass returned document/options to interchange.exportArticlePackage; no UI/session coupling. */
export async function collectArticlePackageExport(palaceId: number, expectedRevision: string) {
  const source = await getArticlePackageSourceApi(palaceId)
  if (source.base_revision !== expectedRevision) throw new Error('宫殿版本已变化，请保存或刷新后重新导出')
  const assets: ArticleTransferAsset[] = []
  for (const reference of imageSources([source.document, source.quiz])) {
    const asset = await fetchArticleAssetApi(reference)
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[asset.mediaType]
    assets.push({ source: reference, path: `assets/image-${assets.length + 1}.${extension}`, ...asset })
  }
  return { document: source.document, options: { sourceOwner: source.source_owner, baseRevision: source.base_revision, assets, quiz: { format: ARTICLE_QUIZ_FORMAT, data: source.quiz } } }
}
