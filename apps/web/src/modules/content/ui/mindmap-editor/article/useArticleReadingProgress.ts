import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getArticleReadingCursorApi,
  saveArticleReadingCursorApi,
  type ArticleReadingOwnerId,
} from '../../../api/articleReadingApi'

export interface ArticleResumeCursor {
  node_uid: string
  block_offset: number | null
}

interface ProgressOwner {
  ownerId: ArticleReadingOwnerId
  retired: boolean
  ready: boolean
  revision: number
  operation: number
  pending: ArticleResumeCursor | null
  saving: boolean
  timer: ReturnType<typeof setTimeout> | null
  abort: AbortController
  schedule: () => void
}

const clientKey = 'article.reading.client'
const sequenceKey = 'article.reading.sequence'
let memoryClient = ''
let memorySequence = 0
const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`

function nextIdentity() {
  if (!memoryClient) memoryClient = newId()
  try {
    memoryClient = sessionStorage.getItem(clientKey) || memoryClient
    sessionStorage.setItem(clientKey, memoryClient)
    memorySequence = Math.max(memorySequence, Number(sessionStorage.getItem(sequenceKey)) || 0)
  } catch { /* browser storage may be unavailable */ }
  memorySequence += 1
  try { sessionStorage.setItem(sequenceKey, String(memorySequence)) } catch { /* in-memory fallback */ }
  return { client_id: memoryClient, client_sequence: memorySequence, operation_id: newId() }
}

const localKey = (ownerId: ArticleReadingOwnerId) => `article.reading.local.${ownerId}`
function readLocal(ownerId: ArticleReadingOwnerId): ArticleResumeCursor | null {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(localKey(ownerId)) || 'null')
    if (!raw || typeof raw !== 'object') return null
    const value = raw as ArticleResumeCursor
    if (typeof value.node_uid !== 'string' || !/^\S{1,128}$/.test(value.node_uid)) return null
    if (value.block_offset !== null && !(typeof value.block_offset === 'number'
      && Number.isFinite(value.block_offset) && value.block_offset >= 0 && value.block_offset <= 1)) return null
    return value
  } catch { return null }
}

/** Optional resume offer only. Scrolling never mutates or invalidates an editor document. */
export function useArticleReadingProgress(ownerId: ArticleReadingOwnerId | null) {
  const active = useRef<ProgressOwner | null>(null)
  const [state, setState] = useState<{
    ownerId: ArticleReadingOwnerId | null
    resumeCursor: ArticleResumeCursor | null
    error: string | null
  }>({ ownerId: null, resumeCursor: null, error: null })

  useEffect(() => {
    if (!ownerId) return
    const context: ProgressOwner = {
      ownerId, retired: false, ready: false, revision: 0, operation: 0,
      pending: null, saving: false, timer: null, abort: new AbortController(), schedule: () => {},
    }
    active.current = context
    const current = () => !context.retired && active.current === context
    setState({ ownerId, resumeCursor: readLocal(ownerId), error: null })

    const load = async (offerResume: boolean) => {
      const operation = ++context.operation
      try {
        const response = await getArticleReadingCursorApi(ownerId, context.abort.signal)
        if (!current() || operation !== context.operation) return
        context.revision = response.cursor?.revision ?? 0
        context.ready = true
        if (response.cursor?.client_id === memoryClient) {
          memorySequence = Math.max(memorySequence, response.cursor.client_sequence)
        }
        setState(previous => previous.ownerId === ownerId ? {
          ...previous,
          resumeCursor: offerResume ? response.cursor ?? previous.resumeCursor : previous.resumeCursor,
        } : previous)
        context.schedule()
      } catch {
        if (!current() || operation !== context.operation) return
        setState(previous => previous.ownerId === ownerId ? { ...previous, error: '阅读进度暂时无法同步，已保留本机位置。' } : previous)
      }
    }

    const flush = async () => {
      context.timer = null
      if (!current() || !context.ready || context.saving || !context.pending) return
      const position = context.pending
      context.pending = null
      context.saving = true
      const operation = ++context.operation
      try {
        const response = await saveArticleReadingCursorApi(ownerId, {
          ...position, ...nextIdentity(), expected_revision: context.revision,
        }, context.abort.signal)
        if (!current() || operation !== context.operation) return
        context.revision = response.cursor?.revision ?? context.revision
        setState(previous => previous.ownerId === ownerId ? { ...previous, error: null } : previous)
      } catch {
        if (!current() || operation !== context.operation) return
        // A timed-out write may have committed. Re-read; never replay a stale position.
        context.ready = false
        context.pending = null
        setState(previous => previous.ownerId === ownerId ? { ...previous, error: '阅读进度同步未完成，已保留本机位置。' } : previous)
        await load(false)
      } finally {
        if (current()) {
          context.saving = false
          context.schedule()
        }
      }
    }
    context.schedule = () => {
      if (!current() || !context.ready || context.saving || !context.pending) return
      if (context.timer) clearTimeout(context.timer)
      context.timer = setTimeout(() => { void flush() }, 500)
    }
    void load(true)
    return () => {
      context.retired = true
      context.abort.abort()
      if (context.timer) clearTimeout(context.timer)
      if (active.current === context) active.current = null
    }
  }, [ownerId])

  const recordProgress = useCallback((uid: string, offset: number | null = null) => {
    const context = active.current
    if (!ownerId || !context || context.ownerId !== ownerId || context.retired || !/^\S{1,128}$/.test(uid)) return
    const position = { node_uid: uid, block_offset: offset === null ? null : Math.max(0, Math.min(1, offset)) }
    if (position.block_offset !== null && !Number.isFinite(position.block_offset)) return
    try { localStorage.setItem(localKey(ownerId), JSON.stringify(position)) } catch { /* optional local fallback */ }
    context.pending = position
    context.schedule()
  }, [ownerId])

  return {
    resumeCursor: state.ownerId === ownerId ? state.resumeCursor : null,
    recordProgress,
    error: state.ownerId === ownerId ? state.error : null,
  }
}
