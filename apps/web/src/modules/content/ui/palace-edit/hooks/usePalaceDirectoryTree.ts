import { useCallback, useEffect, useRef, useState } from 'react'
import { getPalacesGroupedApi } from '@/modules/content/domain/palace-entity/api'
import { getSubjectsApi, getSubjectTreeApi } from '@/modules/content/domain/knowledge-entity/api'
import { PALACE_CATALOG_INVALIDATED_EVENT } from '@/modules/content/domain/palace-entity/api/catalogQuery'
import { onAppEvent } from '@/shared/events/appEvents'
import {
  buildPalaceDirectoryTree,
  type DirectorySubjectTree,
  type PalaceDirectoryTree,
} from '../model/palaceDirectoryTree'

const EMPTY_TREE: PalaceDirectoryTree = { subjects: [], ungrouped: [] }

export interface UsePalaceDirectoryTreeResult {
  tree: PalaceDirectoryTree
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export interface UsePalaceDirectoryTreeOptions {
  /** Skip fetching while the host is closed; the tree loads on first open. */
  enabled?: boolean
}

/**
 * Loads the three reads that together describe 「学科 → 章节 → 宫殿」 and merges
 * them into one tree. A chapter tree that fails to load degrades to an empty
 * chapter list for that subject instead of hiding the whole directory.
 */
export function usePalaceDirectoryTree({
  enabled = true,
}: UsePalaceDirectoryTreeOptions = {}): UsePalaceDirectoryTreeResult {
  const [tree, setTree] = useState<PalaceDirectoryTree>(EMPTY_TREE)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    try {
      const [subjects, grouped] = await Promise.all([
        getSubjectsApi(),
        // The boot snapshot predates any binding change made in this editor, so
        // the directory always reads the live catalog.
        getPalacesGroupedApi(undefined, { fresh: true }).catch(() => null),
      ])
      const settled = await Promise.all(
        subjects.map((subject) => getSubjectTreeApi(subject.id)
          .then((chapterTree) => ({ ...chapterTree, subject: chapterTree.subject ?? subject }))
          .catch((): DirectorySubjectTree => ({ subject, chapters: [] }))),
      )
      if (requestIdRef.current !== requestId) return
      setTree(buildPalaceDirectoryTree({ subjects, chapterTrees: settled, grouped }))
      setError(null)
    } catch (nextError) {
      if (requestIdRef.current !== requestId) return
      setError(nextError instanceof Error ? nextError.message : '加载宫殿目录失败。')
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void load()
  }, [enabled, load])

  // Palace bindings and titles change from other surfaces too (knowledge page,
  // dragging here). The catalog event is the existing invalidation contract.
  useEffect(() => {
    if (!enabled) return
    return onAppEvent(PALACE_CATALOG_INVALIDATED_EVENT, () => { void load() })
  }, [enabled, load])

  return { tree, loading, error, refresh: load }
}
