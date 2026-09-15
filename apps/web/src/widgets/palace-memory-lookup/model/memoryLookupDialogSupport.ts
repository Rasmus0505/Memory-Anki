import { useEffect, useState } from 'react'
import { getPalaceEditorApi } from '@/modules/content/public'
import type {
  MindMapEditorState,
  PalaceGroupedItem,
  PalaceGroupedListResponse,
} from '@/shared/api/contracts'


export function shouldBlockMemoryLookupClose(input: {
  nextOpen: boolean
  pinned: boolean
  mindMapFullscreenActive: boolean
}) {
  return !input.nextOpen && (input.pinned || input.mindMapFullscreenActive)
}

export type MemoryLookupPreviewMode = 'view' | 'flip'

export function createEmptyGroupedData(): PalaceGroupedListResponse {
  return {
    groups: [],
    ungrouped: [],
    subjects: [],
  }
}

export function flattenPalaces(
  data: Pick<PalaceGroupedListResponse, 'subjects'>,
): PalaceGroupedItem[] {
  const list: PalaceGroupedItem[] = []
  for (const subject of data.subjects) {
    for (const group of subject.chapter_groups) {
      list.push(...group.palaces)
    }
    list.push(...subject.ungrouped_palaces)
  }
  return list
}

export function getPalaceTitle(palace: PalaceGroupedItem) {
  return palace.resolved_title || palace.title || '未命名宫殿'
}

export function getPalaceContext(palace: PalaceGroupedItem) {
  const subjectName = palace.resolved_subject?.name
  const chapterName = palace.primary_chapter?.name || palace.resolved_parent_chapter?.name
  return [subjectName, chapterName].filter(Boolean).join(' / ') || '未分类'
}

export function buildEditorState(
  response: Awaited<ReturnType<typeof getPalaceEditorApi>>,
): MindMapEditorState {
  return {
    editor_doc: response.editor_doc,
    editor_config: response.editor_config,
    editor_local_config: response.editor_local_config,
    lang: response.lang,
    editor_fingerprint: response.editor_fingerprint,
  }
}

export function getRootNodeUid(editorState: MindMapEditorState | null) {
  const doc = editorState?.editor_doc
  if (!doc || typeof doc !== 'object') return null
  const root = (doc as { root?: { data?: { uid?: unknown } } }).root
  const uid = root?.data?.uid
  return typeof uid === 'string' && uid.trim() ? uid.trim() : null
}

function editorDocRoot(doc: unknown): unknown {
  if (!doc || typeof doc !== 'object') return null
  return (doc as { root?: unknown }).root
}

function editorNodeUid(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const uid = (node as { data?: { uid?: unknown } }).data?.uid
  return typeof uid === 'string' && uid.trim() ? uid.trim() : null
}

function findEditorNodeByUid(doc: unknown, nodeUid: string): unknown | null {
  if (!doc || typeof doc !== 'object') return null
  const stack: unknown[] = [editorDocRoot(doc)]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    if (editorNodeUid(node) === nodeUid) return node
    const children = (node as { children?: unknown }).children
    if (Array.isArray(children)) stack.push(...children)
  }
  return null
}

function editorDocHasNodeUid(doc: unknown, nodeUid: string): boolean {
  return findEditorNodeByUid(doc, nodeUid) != null
}

/** Prefer the requested node when it exists in the loaded tree; otherwise the palace root. */
export function resolveMemoryLookupFocusNodeUid(
  editorState: MindMapEditorState | null,
  requestedNodeUid?: string | null,
): string | null {
  const rootUid = getRootNodeUid(editorState)
  const requested = typeof requestedNodeUid === 'string' ? requestedNodeUid.trim() : ''
  if (!requested) return rootUid
  if (!editorState?.editor_doc) return requested
  return editorDocHasNodeUid(editorState.editor_doc, requested) ? requested : rootUid
}

export interface MemoryLookupBindingLike {
  node_uid?: string | null
  palace_id?: number | null
  target_palace_id?: number | null
}

function positiveId(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/** Prefer a binding that lives on the current question palace, else the first usable edge. */
export function pickMemoryLookupBinding<T extends MemoryLookupBindingLike>(
  edges: readonly T[],
  preferredPalaceId?: number | null,
): T | null {
  const usable = edges.filter((edge) => typeof edge.node_uid === 'string' && edge.node_uid.trim())
  if (usable.length === 0) return null
  const preferred = positiveId(preferredPalaceId)
  if (preferred != null) {
    const samePalace = usable.find((edge) => {
      const target = positiveId(edge.target_palace_id) ?? positiveId(edge.palace_id)
      return target === preferred || positiveId(edge.palace_id) === preferred
    })
    if (samePalace) return samePalace
  }
  return usable[0] ?? null
}

export function resolveMemoryLookupPalaceId(
  binding: MemoryLookupBindingLike | null | undefined,
  fallbackPalaceId?: number | null,
): number | null {
  return (
    positiveId(binding?.target_palace_id)
    ?? positiveId(binding?.palace_id)
    ?? positiveId(fallbackPalaceId)
  )
}

export function useMemoryLookupNarrowViewport() {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 1023px)')
    const sync = () => setMatches(query.matches)
    sync()
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', sync)
      return () => query.removeEventListener('change', sync)
    }
    query.addListener(sync)
    return () => query.removeListener(sync)
  }, [])

  return matches
}
