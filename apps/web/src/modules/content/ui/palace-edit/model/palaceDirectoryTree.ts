import type { PalaceGroupedItem, PalaceGroupedListResponse } from '@/shared/api/contracts'

/**
 * View model for the palace editor's directory tree.
 *
 * The tree is assembled on the client from three read endpoints because none of
 * them returns the whole shape: `/subjects` has every subject (including empty
 * ones), `/subjects/{id}/tree` has the complete chapter tree (including empty
 * chapters, which are drag targets), and `/palaces/grouped` has every live
 * palace with its primary chapter. Keeping the merge pure makes the placement
 * rules testable without React or network.
 */

export interface DirectorySubjectSummary {
  id: number
  name: string
  color?: string | null
  sort_order?: number | null
}

export interface DirectoryChapterSummary {
  id: number
  name: string
  parent_id?: number | null
  subject_id?: number | null
  sort_order?: number | null
  children?: DirectoryChapterSummary[]
}

export interface DirectorySubjectTree {
  subject?: DirectorySubjectSummary | null
  chapters?: DirectoryChapterSummary[]
}

export interface DirectoryPalaceNode {
  kind: 'palace'
  id: number
  title: string
  chapterId: number | null
  subjectId: number | null
  sortOrder: number
}

export interface DirectoryChapterNode {
  kind: 'chapter'
  id: number
  name: string
  subjectId: number
  sortOrder: number
  children: DirectoryChapterNode[]
  palaces: DirectoryPalaceNode[]
}

export interface DirectorySubjectNode {
  kind: 'subject'
  id: number
  name: string
  color: string
  sortOrder: number
  chapters: DirectoryChapterNode[]
  /** Palaces of this subject that have no resolvable primary chapter. */
  ungrouped: DirectoryPalaceNode[]
}

export interface PalaceDirectoryTree {
  subjects: DirectorySubjectNode[]
  /** Palaces that belong to no known subject (or to no chapter and no subject). */
  ungrouped: DirectoryPalaceNode[]
}

export interface BuildPalaceDirectoryTreeInput {
  subjects: ReadonlyArray<DirectorySubjectSummary>
  chapterTrees: ReadonlyArray<DirectorySubjectTree>
  grouped: PalaceGroupedListResponse | null | undefined
}

const DEFAULT_SUBJECT_COLOR = '#6366f1'

function compareText(left: string, right: string) {
  return left.localeCompare(right, 'zh-Hans-CN')
}

function compareOrderThenName(
  left: { sortOrder: number; name: string; id: number },
  right: { sortOrder: number; name: string; id: number },
) {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
  const byName = compareText(left.name, right.name)
  if (byName !== 0) return byName
  return left.id - right.id
}

function comparePalaces(left: DirectoryPalaceNode, right: DirectoryPalaceNode) {
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
  const byTitle = compareText(left.title, right.title)
  if (byTitle !== 0) return byTitle
  return left.id - right.id
}

interface CollectedPalace {
  palace: PalaceGroupedItem
  /** Subject bucket the grouped endpoint filed this palace under, if any. */
  bucketSubjectId: number | null
}

/**
 * `/palaces/grouped` lists the same palace under `groups` (by display group) and
 * under `subjects` (by subject/chapter); a palace bound to two subjects appears
 * twice. The directory shows each palace exactly once, so collapse them by id,
 * preferring the subject bucket as the ownership hint.
 */
function collectPalaces(grouped: PalaceGroupedListResponse | null | undefined) {
  const byId = new Map<number, CollectedPalace>()
  if (!grouped) return byId
  const add = (palace: PalaceGroupedItem | undefined, bucketSubjectId: number | null) => {
    if (!palace || typeof palace.id !== 'number') return
    const existing = byId.get(palace.id)
    if (!existing) {
      byId.set(palace.id, { palace, bucketSubjectId })
      return
    }
    if (existing.bucketSubjectId == null && bucketSubjectId != null) {
      existing.bucketSubjectId = bucketSubjectId
    }
  }
  for (const subjectGroup of grouped.subjects ?? []) {
    const bucketSubjectId = subjectGroup.subject?.id ?? null
    for (const chapterGroup of subjectGroup.chapter_groups ?? []) {
      for (const palace of chapterGroup.palaces ?? []) add(palace, bucketSubjectId)
    }
    for (const palace of subjectGroup.ungrouped_palaces ?? []) add(palace, bucketSubjectId)
  }
  for (const group of grouped.groups ?? []) {
    for (const palace of group.palaces ?? []) add(palace, null)
  }
  for (const palace of grouped.ungrouped ?? []) add(palace, null)
  return byId
}

function buildChapterNodes(
  chapters: ReadonlyArray<DirectoryChapterSummary> | undefined,
  subjectId: number,
): { chapters: DirectoryChapterNode[]; index: Map<number, DirectoryChapterNode> } {
  const index = new Map<number, DirectoryChapterNode>()
  const walk = (nodes: ReadonlyArray<DirectoryChapterSummary> | undefined): DirectoryChapterNode[] => {
    const result: DirectoryChapterNode[] = []
    for (const chapter of nodes ?? []) {
      if (typeof chapter?.id !== 'number') continue
      const node: DirectoryChapterNode = {
        kind: 'chapter',
        id: chapter.id,
        name: chapter.name ?? '',
        subjectId,
        sortOrder: chapter.sort_order ?? 0,
        children: walk(chapter.children),
        palaces: [],
      }
      index.set(node.id, node)
      result.push(node)
    }
    result.sort(compareOrderThenName)
    return result
  }
  return { chapters: walk(chapters), index }
}

function toPalaceNode(
  palace: PalaceGroupedItem,
  chapterId: number | null,
  subjectId: number | null,
): DirectoryPalaceNode {
  const title = (palace.resolved_title || palace.title || '').trim() || `宫殿 ${palace.id}`
  return {
    kind: 'palace',
    id: palace.id,
    title,
    chapterId,
    subjectId,
    sortOrder: palace.group_sort_order ?? 0,
  }
}

/**
 * Place every palace exactly once, under its primary chapter. Palaces without a
 * resolvable primary chapter fall back to the subject's 「未分类」 bucket, and
 * palaces with no known subject to the root 「未分类」 bucket.
 */
export function buildPalaceDirectoryTree({
  subjects,
  chapterTrees,
  grouped,
}: BuildPalaceDirectoryTreeInput): PalaceDirectoryTree {
  const subjectNodes = new Map<number, DirectorySubjectNode>()
  const chapterIndex = new Map<number, DirectoryChapterNode>()

  const sortedSubjects = [...subjects]
    .filter((subject) => typeof subject?.id === 'number')
    .sort((left, right) => compareOrderThenName({
      sortOrder: left.sort_order ?? 0,
      name: left.name ?? '',
      id: left.id,
    }, {
      sortOrder: right.sort_order ?? 0,
      name: right.name ?? '',
      id: right.id,
    }))

  for (const subject of sortedSubjects) {
    const node: DirectorySubjectNode = {
      kind: 'subject',
      id: subject.id,
      name: subject.name ?? '',
      color: subject.color || DEFAULT_SUBJECT_COLOR,
      sortOrder: subject.sort_order ?? 0,
      chapters: [],
      ungrouped: [],
    }
    subjectNodes.set(subject.id, node)
  }

  // A chapter tree is authoritative for its subject: the token source may omit
  // `subject.id`, so fall back to the declared subject id.
  for (const tree of chapterTrees) {
    const subjectId = tree.subject?.id
    if (subjectId == null) continue
    const subjectNode = subjectNodes.get(subjectId)
    if (!subjectNode) continue
    const built = buildChapterNodes(tree.chapters, subjectId)
    subjectNode.chapters = built.chapters
    for (const [chapterId, chapterNode] of built.index) chapterIndex.set(chapterId, chapterNode)
  }

  const rootUngrouped: DirectoryPalaceNode[] = []
  for (const { palace, bucketSubjectId } of collectPalaces(grouped).values()) {
    const primaryChapterId = typeof palace.primary_chapter_id === 'number' ? palace.primary_chapter_id : null
    const primaryChapter = primaryChapterId != null ? chapterIndex.get(primaryChapterId) : undefined
    if (primaryChapter) {
      primaryChapter.palaces.push(toPalaceNode(palace, primaryChapter.id, primaryChapter.subjectId))
      continue
    }
    const subjectId =
      bucketSubjectId
      ?? palace.resolved_subject?.id
      ?? palace.primary_chapter?.subject_id
      ?? null
    const subjectNode = subjectId != null ? subjectNodes.get(subjectId) : undefined
    if (subjectNode) {
      subjectNode.ungrouped.push(toPalaceNode(palace, null, subjectNode.id))
      continue
    }
    rootUngrouped.push(toPalaceNode(palace, null, null))
  }

  for (const subjectNode of subjectNodes.values()) {
    subjectNode.ungrouped.sort(comparePalaces)
    sortChapterPalaces(subjectNode.chapters)
  }
  rootUngrouped.sort(comparePalaces)

  const treeSubjects = [...subjectNodes.values()].sort(compareOrderThenName)
  return { subjects: treeSubjects, ungrouped: rootUngrouped }
}

function sortChapterPalaces(chapters: DirectoryChapterNode[]) {
  for (const chapter of chapters) {
    chapter.palaces.sort(comparePalaces)
    sortChapterPalaces(chapter.children)
  }
}

/**
 * Case-insensitive name filter that keeps a palace's ancestor path visible.
 * A matching chapter keeps its whole subtree; a matching subject keeps the
 * whole subject.
 */
export function filterPalaceDirectoryTree(
  tree: PalaceDirectoryTree,
  keyword: string,
): PalaceDirectoryTree {
  const needle = keyword.trim().toLocaleLowerCase()
  if (!needle) return tree
  const matches = (value: string) => value.toLocaleLowerCase().includes(needle)

  const filterChapter = (chapter: DirectoryChapterNode): DirectoryChapterNode | null => {
    if (matches(chapter.name)) return chapter
    const children = chapter.children
      .map(filterChapter)
      .filter((child): child is DirectoryChapterNode => child != null)
    const palaces = chapter.palaces.filter((palace) => matches(palace.title))
    if (!children.length && !palaces.length) return null
    return { ...chapter, children, palaces }
  }

  const subjects: DirectorySubjectNode[] = []
  for (const subject of tree.subjects) {
    if (matches(subject.name)) {
      subjects.push(subject)
      continue
    }
    const chapters = subject.chapters
      .map(filterChapter)
      .filter((chapter): chapter is DirectoryChapterNode => chapter != null)
    const ungrouped = subject.ungrouped.filter((palace) => matches(palace.title))
    if (!chapters.length && !ungrouped.length) continue
    subjects.push({ ...subject, chapters, ungrouped })
  }

  return {
    subjects,
    ungrouped: tree.ungrouped.filter((palace) => matches(palace.title)),
  }
}

/** Ids of every palace the tree currently shows, in render order. */
export function collectDirectoryPalaceIds(tree: PalaceDirectoryTree): number[] {
  const ids: number[] = []
  const walkChapter = (chapter: DirectoryChapterNode) => {
    for (const palace of chapter.palaces) ids.push(palace.id)
    for (const child of chapter.children) walkChapter(child)
  }
  for (const subject of tree.subjects) {
    for (const chapter of subject.chapters) walkChapter(chapter)
    for (const palace of subject.ungrouped) ids.push(palace.id)
  }
  for (const palace of tree.ungrouped) ids.push(palace.id)
  return ids
}

/**
 * Expansion keys for the path leading to a palace, so the editor can reveal the
 * palace it opened on.
 */
export function expansionKeysForPalace(tree: PalaceDirectoryTree, palaceId: number): string[] {
  const keys: string[] = []

  const findInChapter = (chapter: DirectoryChapterNode, trail: string[]): boolean => {
    const nextTrail = [...trail, `chapter:${chapter.id}`]
    if (chapter.palaces.some((palace) => palace.id === palaceId)) {
      keys.push(...nextTrail)
      return true
    }
    return chapter.children.some((child) => findInChapter(child, nextTrail))
  }

  for (const subject of tree.subjects) {
    if (subject.ungrouped.some((palace) => palace.id === palaceId)) {
      // The 「未分类」 bucket is its own fold, so the path needs both keys.
      keys.push(`subject:${subject.id}`, `subject:${subject.id}:ungrouped`)
      return keys
    }
    for (const chapter of subject.chapters) {
      if (findInChapter(chapter, [`subject:${subject.id}`])) return keys
    }
  }
  if (tree.ungrouped.some((palace) => palace.id === palaceId)) {
    keys.push('root:ungrouped')
  }
  return keys
}
