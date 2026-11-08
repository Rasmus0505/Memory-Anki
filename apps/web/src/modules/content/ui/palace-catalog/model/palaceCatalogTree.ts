import type { PalaceGroupedItem, PalaceGroupedListResponse } from '@/shared/api/contracts'
import type {
  DirectoryChapterNode,
  DirectoryPalaceNode,
  DirectorySubjectNode,
  PalaceDirectoryTree,
} from '@/modules/content/ui/palace-edit/model/palaceDirectoryTree'
import { shareRatio } from '@/shared/ui/share-fill/shareFill'

const DEFAULT_SUBJECT_COLOR = '#2f6b63'

/** Part ÷ whole as a share, or null when either side is unknown (no bar to draw). */
function shareOf(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (part == null || whole == null || whole <= 0) return null
  return shareRatio(part, whole)
}

function toPalaceNode(
  palace: PalaceGroupedItem,
  order: number,
  chapterId: number | null,
  subjectId: number | null,
  questionShare?: number | null,
): DirectoryPalaceNode {
  return {
    kind: 'palace',
    id: palace.id,
    title: (palace.resolved_title || palace.title || '').trim() || `宫殿 ${palace.id}`,
    chapterId,
    subjectId,
    sortOrder: order,
    ...(questionShare != null ? { questionShare } : {}),
  }
}

export interface PalaceCatalogTree {
  tree: PalaceDirectoryTree
  palacesById: Map<number, PalaceGroupedItem>
}

/**
 * Turns `/palaces/grouped` into the 学科 → 章节 → 宫殿 tree the directory view
 * renders. Palaces stay exactly where the grouped endpoint filed them (the
 * catalog's own grouping), chapters nest by `parent_id` when the parent is on
 * the shelf too, and every palace appears once even when it is bound to two
 * subjects. Built from the already-filtered response, so search, scope and
 * interval-band filters carry over without a second pass.
 */
export function buildPalaceCatalogTree(grouped: PalaceGroupedListResponse | null | undefined): PalaceCatalogTree {
  const palacesById = new Map<number, PalaceGroupedItem>()
  const subjects: DirectorySubjectNode[] = []
  const rootUngrouped: DirectoryPalaceNode[] = []
  if (!grouped) return { tree: { subjects, ungrouped: rootUngrouped }, palacesById }

  const take = (palace: PalaceGroupedItem) => {
    if (!palace || typeof palace.id !== 'number' || palacesById.has(palace.id)) return false
    palacesById.set(palace.id, palace)
    return true
  }

  // Question totals arrive on the grouped payload: one per subject and one per
  // chapter (distinct questions across that group's palaces). A row's bar is
  // its share of the level above it, so gather the denominators up front.
  const subjectQuestionTotals = new Map<number, number>()
  const chapterQuestionTotals = new Map<number, number>()
  for (const subjectGroup of grouped.subjects ?? []) {
    const subjectId = subjectGroup.subject?.id
    if (subjectId == null) continue
    if (subjectGroup.question_total != null) subjectQuestionTotals.set(subjectId, subjectGroup.question_total)
    for (const group of subjectGroup.chapter_groups ?? []) {
      const chapterId = group.source_chapter?.id
      if (chapterId != null && group.question_total != null) chapterQuestionTotals.set(chapterId, group.question_total)
    }
  }
  const shelfQuestionTotal = [...subjectQuestionTotals.values()].reduce((sum, value) => sum + value, 0)

  ;(grouped.subjects ?? []).forEach((subjectGroup, subjectOrder) => {
    const subjectId = subjectGroup.subject?.id ?? null
    const subjectTotal = subjectId != null ? subjectQuestionTotals.get(subjectId) : undefined
    const chapterIndex = new Map<number, DirectoryChapterNode>()
    const chapterNodes: DirectoryChapterNode[] = []
    ;(subjectGroup.chapter_groups ?? []).forEach((group, groupOrder) => {
      const chapter = group.source_chapter
      if (!chapter || typeof chapter.id !== 'number') return
      const chapterTotal = chapterQuestionTotals.get(chapter.id)
      const chapterShare = shareOf(chapterTotal, subjectTotal)
      const node: DirectoryChapterNode = {
        kind: 'chapter',
        id: chapter.id,
        name: chapter.name ?? '',
        subjectId: subjectId ?? 0,
        sortOrder: groupOrder,
        children: [],
        palaces: [],
        ...(chapterShare != null ? { questionShare: chapterShare } : {}),
      }
      ;(group.palaces ?? []).forEach((palace, palaceOrder) => {
        if (take(palace)) {
          node.palaces.push(toPalaceNode(
            palace,
            palaceOrder,
            chapter.id,
            subjectId,
            shareOf(palace.quiz_question_total, chapterTotal ?? subjectTotal),
          ))
        }
      })
      chapterIndex.set(chapter.id, node)
      chapterNodes.push(node)
    })
    const roots: DirectoryChapterNode[] = []
    for (const node of chapterNodes) {
      const parentId = (subjectGroup.chapter_groups ?? []).find((group) => group.source_chapter?.id === node.id)?.source_chapter?.parent_id
      const parent = parentId != null ? chapterIndex.get(parentId) : undefined
      if (parent && parent !== node) parent.children.push(node)
      else roots.push(node)
    }
    const ungrouped: DirectoryPalaceNode[] = []
    ;(subjectGroup.ungrouped_palaces ?? []).forEach((palace, palaceOrder) => {
      if (take(palace)) {
        ungrouped.push(toPalaceNode(
          palace,
          palaceOrder,
          null,
          subjectId,
          shareOf(palace.quiz_question_total, subjectTotal),
        ))
      }
    })

    if (subjectId == null) {
      // The 「未分类」 shelf: its chapters' palaces and its loose palaces share the root bucket.
      const collect = (chapter: DirectoryChapterNode) => {
        rootUngrouped.push(...chapter.palaces)
        chapter.children.forEach(collect)
      }
      roots.forEach(collect)
      rootUngrouped.push(...ungrouped)
      return
    }
    const subjectShare = shareOf(subjectTotal, shelfQuestionTotal)
    subjects.push({
      kind: 'subject',
      id: subjectId,
      name: subjectGroup.subject?.name ?? '',
      color: subjectGroup.subject?.color || DEFAULT_SUBJECT_COLOR,
      sortOrder: subjectOrder,
      chapters: roots,
      ungrouped,
      ...(subjectShare != null ? { questionShare: subjectShare } : {}),
    })
  })

  // Older payloads may only file a palace under the flat buckets.
  for (const group of grouped.groups ?? []) {
    for (const palace of group.palaces ?? []) {
      if (take(palace)) rootUngrouped.push(toPalaceNode(palace, rootUngrouped.length, null, null))
    }
  }
  for (const palace of grouped.ungrouped ?? []) {
    if (take(palace)) rootUngrouped.push(toPalaceNode(palace, rootUngrouped.length, null, null))
  }

  return { tree: { subjects, ungrouped: rootUngrouped }, palacesById }
}

/** Every palace under a chapter, including its sub-chapters. */
export function chapterPalaceIds(chapter: DirectoryChapterNode): number[] {
  const ids = chapter.palaces.map((palace) => palace.id)
  for (const child of chapter.children) ids.push(...chapterPalaceIds(child))
  return ids
}

/** Expansion keys that open every subject and chapter of a tree. */
export function allExpansionKeys(tree: PalaceDirectoryTree): string[] {
  const keys: string[] = []
  const walk = (chapter: DirectoryChapterNode) => {
    keys.push(`chapter:${chapter.id}`)
    chapter.children.forEach(walk)
  }
  for (const subject of tree.subjects) {
    keys.push(`subject:${subject.id}`, `subject:${subject.id}:ungrouped`)
    subject.chapters.forEach(walk)
  }
  keys.push('root:ungrouped')
  return keys
}
