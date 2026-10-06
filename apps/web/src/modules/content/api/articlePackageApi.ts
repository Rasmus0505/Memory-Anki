import { API_BASE, request } from '@/shared/api/http'
import type { MindMapDocumentV1, MindMapEditorSnapshot } from '../domain/mindmap-document-entity/model/document'

export const ARTICLE_QUIZ_FORMAT = 'memory-anki-article-quiz-v1'
export interface ArticleTransferAsset { source: string; path: string; bytes: Uint8Array; mediaType: string }
export interface ArticleTransferRequest {
  mode: 'create' | 'append' | 'replace' | 'update'
  owner_id: string
  operation_id: string
  document: MindMapDocumentV1
  expected_revision?: string
  source_owner?: string
  base_revision?: string | null
  parent_uid?: string
  confirm_replace?: boolean
  title?: string
  assets: { source: string; name: string; media_type: string; base64: string }[]
  quiz: Record<string, unknown> | null
}
export interface ArticleTransferResponse {
  palace_id: number
  owner_id: string
  operation_id: string
  uid_map: Record<string, string>
  editor_doc: MindMapDocumentV1
  editor_fingerprint: string
  snapshot: MindMapEditorSnapshot
}
export interface ArticlePackageSource {
  source_owner: string
  base_revision: string
  document: MindMapDocumentV1
  quiz: Record<string, unknown>
}
export function getArticlePackageSourceApi(palaceId: number) {
  return request<ArticlePackageSource>(`/palaces/${palaceId}/article-package`)
}
export function transferArticleApi(palaceId: number | null, command: ArticleTransferRequest) {
  // Never auto-replay destructive imports or an ambiguous create after lost acknowledgement.
  return request<ArticleTransferResponse>(palaceId === null ? '/content/article-transfer' : `/palaces/${palaceId}/article-transfer`, {
    method: 'POST', body: JSON.stringify(command), persistence: false,
  })
}
export async function fetchArticleAssetApi(source: string): Promise<{ bytes: Uint8Array; mediaType: string }> {
  // Package export must not fetch arbitrary external URLs, localhost services, or another API.
  const match = /^\/api\/v1\/attachments\/(\d+)$/.exec(source)
  if (!match) throw new Error(`不支持打包此外部资源：${source}`)
  const response = await fetch(`${API_BASE}/attachments/${match[1]}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`附件读取失败 (${response.status})`)
  const mediaType = response.headers.get('content-type')?.split(';')[0] ?? ''
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(mediaType)) throw new Error('文章包仅支持 PNG、JPEG、GIF 和 WebP；其他格式不会被静默忽略')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length > 8 * 1024 * 1024) throw new Error('文章附件超过 8 MiB')
  return { bytes, mediaType }
}
