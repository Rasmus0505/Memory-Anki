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
