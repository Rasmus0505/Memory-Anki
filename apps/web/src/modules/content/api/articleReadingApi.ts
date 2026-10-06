import { request } from '@/shared/api/http'
import type { ArticleReadingOwnerId, ArticleReadingResponse, ArticleReadingWrite } from '@/shared/api/contracts/articleReading'
export type { ArticleReadingCursor, ArticleReadingOwnerId, ArticleReadingResponse, ArticleReadingWrite } from '@/shared/api/contracts/articleReading'

const validOwner = /^(palace|knowledge-subject):[1-9][0-9]{0,18}$/
const identity = (value: unknown): value is string => typeof value === 'string' && /^\S{1,128}$/.test(value)
const positiveInteger = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export function decodeArticleReadingResponse(value: unknown, ownerId: ArticleReadingOwnerId): ArticleReadingResponse {
  const fail = () => { throw new Error('阅读进度数据格式不兼容') }
  if (!value || typeof value !== 'object') return fail()
  const result = value as Record<string, unknown>
  if (result.owner_id !== ownerId) return fail()
  if (result.cursor === null) return value as ArticleReadingResponse
  if (!result.cursor || typeof result.cursor !== 'object') return fail()
  const cursor = result.cursor as Record<string, unknown>
  if (cursor.owner_id !== ownerId || !identity(cursor.node_uid) || !identity(cursor.client_id)
    || !identity(cursor.operation_id) || !positiveInteger(cursor.client_sequence) || !positiveInteger(cursor.revision)
    || typeof cursor.updated_at !== 'string' || !Number.isFinite(Date.parse(cursor.updated_at))
    || !(cursor.block_offset === null || (typeof cursor.block_offset === 'number'
      && Number.isFinite(cursor.block_offset) && cursor.block_offset >= 0 && cursor.block_offset <= 1))) return fail()
  return value as ArticleReadingResponse
}

function path(ownerId: ArticleReadingOwnerId) {
  if (!validOwner.test(ownerId)) throw new Error('Invalid article document owner')
  return `/content/article-reading/${encodeURIComponent(ownerId)}`
}

export async function getArticleReadingCursorApi(ownerId: ArticleReadingOwnerId, signal?: AbortSignal) {
  return decodeArticleReadingResponse(await request<unknown>(path(ownerId), { signal }), ownerId)
}

export async function saveArticleReadingCursorApi(ownerId: ArticleReadingOwnerId, payload: ArticleReadingWrite, signal?: AbortSignal) {
  return decodeArticleReadingResponse(await request<unknown>(path(ownerId), {
    method: 'PUT', body: JSON.stringify(payload), signal, persistence: false, timeoutMs: 10_000,
  }), ownerId)
}
