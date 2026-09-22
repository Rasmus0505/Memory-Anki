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
  const data = (node as { data?: { uid?: unknown; memoryAnkiId?: unknown } }).data
  for (const value of [data?.uid, data?.memoryAnkiId]) {
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return String(value)
  }
  return null
}

interface EditorNodeLocation {
  uid: string
  depth: number
  ancestorUids: string[]
}

function walkEditorNodeLocations(doc: unknown): EditorNodeLocation[] {
  const locations: EditorNodeLocation[] = []
  const visit = (node: unknown, depth: number, ancestorUids: string[]) => {
    if (!node || typeof node !== 'object') return
    const uid = editorNodeUid(node)
    if (uid) locations.push({ uid, depth, ancestorUids })
    const children = (node as { children?: unknown }).children
    if (!Array.isArray(children)) return
    const nextAncestors = uid ? [...ancestorUids, uid] : ancestorUids
    for (const child of children) visit(child, depth + 1, nextAncestors)
  }
  visit(editorDocRoot(doc), 0, [])
  return locations
}

export function normalizeMemoryLookupFocusNodeUids(
  requested?: string | null | readonly (string | null | undefined)[],
): string[] {
  const values = Array.isArray(requested) ? requested : [requested]
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const uid = typeof value === 'string' ? value.trim() : ''
    if (!uid || seen.has(uid)) continue
    seen.add(uid)
    result.push(uid)
  }
  return result
}

function pickDeepestEditorNodeUid(
  locations: readonly EditorNodeLocation[],
  requestedUids: readonly string[],
  preferredAncestorUid?: string | null,
): string | null {
  if (requestedUids.length === 0 || locations.length === 0) return null
  const requested = new Set(requestedUids)
  const matches = locations.filter((location) => requested.has(location.uid))
  if (matches.length === 0) return null
  const ancestor = typeof preferredAncestorUid === 'string' ? preferredAncestorUid.trim() : ''
  const scoped = ancestor
    ? matches.filter(
        (location) => location.uid === ancestor || location.ancestorUids.includes(ancestor),
      )
    : matches
  const pool = scoped.length > 0 ? scoped : matches
  const picked = [...pool].sort((left, right) => {
    if (right.depth !== left.depth) return right.depth - left.depth
    return left.uid.localeCompare(right.uid)
  })[0]
  return picked?.uid ?? null
}

/**
 * Prefer the deepest requested bound node that exists in the loaded tree.
 * Keeps the full palace; missing requests fall back to the palace root.
 */
export function resolveMemoryLookupFocusNodeUid(
  editorState: MindMapEditorState | null,
  requestedNodeUid?: string | null | readonly (string | null | undefined)[],
  preferredAncestorUid?: string | null,
): string | null {
  const rootUid = getRootNodeUid(editorState)
  const requested = normalizeMemoryLookupFocusNodeUids(requestedNodeUid)
  if (requested.length === 0) return rootUid
  if (!editorState?.editor_doc) return requested[requested.length - 1] ?? rootUid
  const locations = walkEditorNodeLocations(editorState.editor_doc)
  return pickDeepestEditorNodeUid(locations, requested, preferredAncestorUid) ?? rootUid
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

/** All bound node UIDs on the preferred palace (else every usable edge). */
export function collectMemoryLookupFocusNodeUids<T extends MemoryLookupBindingLike>(
  edges: readonly T[],
  preferredPalaceId?: number | null,
): string[] {
  const usable = edges.filter((edge) => typeof edge.node_uid === 'string' && edge.node_uid.trim())
  if (usable.length === 0) return []
  const preferred = positiveId(preferredPalaceId)
  const scoped = preferred != null
    ? usable.filter((edge) => {
        const target = positiveId(edge.target_palace_id) ?? positiveId(edge.palace_id)
        return target === preferred || positiveId(edge.palace_id) === preferred
      })
    : usable
  const source = scoped.length > 0 ? scoped : usable
  return normalizeMemoryLookupFocusNodeUids(source.map((edge) => edge.node_uid))
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
