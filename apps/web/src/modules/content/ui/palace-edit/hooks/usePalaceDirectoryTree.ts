import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPalacesGroupedApi } from '@/modules/content/domain/palace-entity/api'
import { getSubjectsApi, getSubjectTreeApi } from '@/modules/content/domain/knowledge-entity/api'
import { PALACE_CATALOG_GROUPED_QUERY_KEY } from '@/modules/content/domain/palace-entity/api/catalogQuery'
import {
  buildPalaceDirectoryTree,
  type DirectorySubjectTree,
  type PalaceDirectoryTree,
} from '../model/palaceDirectoryTree'

const EMPTY_TREE: PalaceDirectoryTree = { subjects: [], ungrouped: [] }

/**
 * Shared cache key for 「学科 → 章节 → 宫殿」.
 *
 * It lives under the catalog query prefix on purpose: the app-level
 * `PalaceCatalogQueryInvalidationBridge` already invalidates that prefix on
 * `PALACE_CATALOG_INVALIDATED_EVENT`, so a binding/title change from any
 * surface (knowledge page, drag here, unit reconcile) refreshes the directory
 * without this hook keeping its own event listener.
 */
export const PALACE_DIRECTORY_TREE_QUERY_KEY = [
  ...PALACE_CATALOG_GROUPED_QUERY_KEY,
  'directory-tree',
] as const

/**
 * Loads the three reads that together describe the tree. A chapter tree that
 * fails to load degrades to an empty chapter list for that subject instead of
 * hiding the whole directory.
 */
async function loadPalaceDirectoryTree(): Promise<PalaceDirectoryTree> {
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
  return buildPalaceDirectoryTree({ subjects, chapterTrees: settled, grouped })
}

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
 * Reads the palace directory from the shared query cache.
 *
 * Opening another palace swaps the editor route, which mounts a *new* editor
 * page instance — a hook with only local state therefore re-read the whole
 * catalog and flashed 「正在加载目录…」 on every chapter switch. The query cache
 * lets that new instance paint the directory it already has while the
 * revalidation runs in the background (default `staleTime` is 0, so freshness
 * is unchanged: every editor mount still re-reads the live catalog).
 */
export function usePalaceDirectoryTree({
  enabled = true,
}: UsePalaceDirectoryTreeOptions = {}): UsePalaceDirectoryTreeResult {
  const query = useQuery({
    queryKey: PALACE_DIRECTORY_TREE_QUERY_KEY,
    queryFn: loadPalaceDirectoryTree,
    enabled,
  })
  const { refetch } = query

  const refresh = useCallback(async () => {
    await refetch()
  }, [refetch])

  const error = query.error
    ? query.error instanceof Error
      ? query.error.message
      : '加载宫殿目录失败。'
    : null

  return {
    tree: query.data ?? EMPTY_TREE,
    // `isPending` (not `isFetching`) is the initial-load signal: once the cache
    // holds a tree, a background revalidation must not bring the spinner back.
    loading: enabled && query.isPending,
    error,
    refresh,
  }
}
