import type {
  PalaceGroupedItem,
  PalaceGroupedListResponse,
} from '@/shared/api/contracts'
export interface FreestyleSubjectTree {
  subject?: { id: number; name: string }
  chapters?: Array<{ id: number; name: string; parent_id?: number | null; children?: unknown[] }>
}

export interface FreestylePalaceScopeGroup {
  key: string
  title: string
  palaces: PalaceGroupedItem[]
  palaceIds: number[]
}

export interface FreestylePalaceScopeSection {
  key: string
  title: string
  groups: FreestylePalaceScopeGroup[]
}

export interface FreestylePalaceScopeChapter {
  key: string
  id: number
  title: string
  children: FreestylePalaceScopeChapter[]
  palaces: PalaceGroupedItem[]
  palaceIds: number[]
}

export interface FreestylePalaceScopeSubject {
  key: string
  id: number | null
  title: string
  chapters: FreestylePalaceScopeChapter[]
  ungrouped: FreestylePalaceScopeGroup | null
}

function createGroup(
  key: string,
  title: string,
  palaces: PalaceGroupedItem[],
): FreestylePalaceScopeGroup | null {
  if (!palaces.length) return null
  return {
    key,
    title,
    palaces,
    palaceIds: palaces.map((palace) => palace.id),
  }
}

export function buildFreestylePalaceScopeSections(
  data: PalaceGroupedListResponse | null,
): FreestylePalaceScopeSection[] {
  if (!data) return []

  return (data.subjects || [])
    .map((subject) => {
      const subjectKey = String(subject.subject?.id ?? 'ungrouped')
      const groups = subject.chapter_groups
        .map((group) =>
          createGroup(
            `${subjectKey}:chapter:${group.source_chapter.id}`,
            group.source_chapter.name,
            group.palaces,
          ),
        )
        .filter((group): group is FreestylePalaceScopeGroup => Boolean(group))
      const ungrouped = createGroup(
        `${subjectKey}:ungrouped`,
        '未分类宫殿',
        subject.ungrouped_palaces,
      )
      if (ungrouped) groups.push(ungrouped)
      if (!groups.length) return null
      return {
        key: `subject:${subjectKey}`,
        title: subject.subject?.name || '未分类学科',
        groups,
      }
    })
    .filter((section): section is FreestylePalaceScopeSection => Boolean(section))
}

type RawChapter = { id: number; name: string; parent_id?: number | null; children?: RawChapter[] }

function readLinkedChapterIds(palace: PalaceGroupedItem, fallbackId?: number) {
  const ids = Array.isArray(palace.chapters)
    ? palace.chapters.flatMap((chapter) => {
        if (!chapter || typeof chapter !== 'object') return []
        const id = Number((chapter as { id?: unknown }).id)
        return Number.isInteger(id) && id > 0 ? [id] : []
      })
    : []
  if (palace.primary_chapter_id && !ids.includes(palace.primary_chapter_id)) ids.push(palace.primary_chapter_id)
  if (!ids.length && fallbackId) ids.push(fallbackId)
  return ids
}

function chapterFromTree(
  chapter: RawChapter,
  palacesByChapter: Map<number, PalaceGroupedItem[]>,
): FreestylePalaceScopeChapter {
  const palaces = palacesByChapter.get(chapter.id) ?? []
  const children = ((chapter.children ?? []) as RawChapter[]).map((child) => chapterFromTree(child, palacesByChapter))
  const palaceIds = Array.from(new Set([
    ...palaces.map((palace) => palace.id),
    ...children.flatMap((child) => child.palaceIds),
  ]))
  return {
    key: `chapter:${chapter.id}`,
    id: chapter.id,
    title: chapter.name,
    children,
    palaces,
    palaceIds,
  }
}

export function buildFreestylePalaceScopeSubjects(
  data: PalaceGroupedListResponse | null,
  trees: FreestyleSubjectTree[] = [],
): FreestylePalaceScopeSubject[] {
  if (!data) return []
  return (data.subjects ?? []).map((bucket) => {
    const subjectId = bucket.subject?.id ?? null
    const subjectPalaces = [
      ...(bucket.chapter_groups ?? []).flatMap((group) => group.palaces ?? []),
      ...(bucket.ungrouped_palaces ?? []),
    ]
    const tree = trees.find((item) => item.subject?.id === subjectId)
    const fallbackChapterByPalace = new Map<number, number>()
    for (const group of bucket.chapter_groups ?? []) {
      for (const palace of group.palaces ?? []) fallbackChapterByPalace.set(palace.id, group.source_chapter.id)
    }
    const palacesByChapter = new Map<number, PalaceGroupedItem[]>()
    const groupedPalaces = (bucket.chapter_groups ?? []).flatMap((group) => group.palaces ?? [])
    for (const palace of groupedPalaces) {
      for (const chapterId of readLinkedChapterIds(palace, fallbackChapterByPalace.get(palace.id))) {
        const list = palacesByChapter.get(chapterId) ?? []
        if (!list.some((item) => item.id === palace.id)) list.push(palace)
        palacesByChapter.set(chapterId, list)
      }
    }
    const rawRoots = (tree?.chapters ?? []) as RawChapter[]
    const chapters = rawRoots.length
      ? rawRoots.map((chapter) => chapterFromTree(chapter, palacesByChapter))
      : (bucket.chapter_groups ?? []).map((group) => chapterFromTree({
          id: group.source_chapter.id,
          name: group.source_chapter.name,
          parent_id: group.source_chapter.parent_id,
        }, palacesByChapter))
    const groupedIds = new Set(chapters.flatMap((chapter) => chapter.palaceIds))
    const ungroupedPalaces = subjectPalaces.filter((palace) => !groupedIds.has(palace.id))
    return {
      key: `subject:${subjectId ?? 'ungrouped'}`,
      id: subjectId,
      title: bucket.subject?.name ?? '未分类学科',
      chapters,
      ungrouped: createGroup(`${subjectId ?? 'ungrouped'}:ungrouped`, '未归类宫殿', ungroupedPalaces),
    }
  }).filter((subject) => subject.chapters.length > 0 || Boolean(subject.ungrouped))
}

export function allFreestylePalaceIdsFromSubjects(subjects: FreestylePalaceScopeSubject[]) {
  return Array.from(new Set(subjects.flatMap((subject) => [
    ...subject.chapters.flatMap((chapter) => chapter.palaceIds),
    ...(subject.ungrouped?.palaceIds ?? []),
  ])))
}

export function allFreestylePalaceIds(sections: FreestylePalaceScopeSection[]) {
  return Array.from(new Set(sections.flatMap((section) => section.groups.flatMap((group) => group.palaceIds))))
}

export function getFreestylePalaceGroupSelection(
  palaceIds: number[],
  selectedIds: number[],
): 'checked' | 'indeterminate' | 'unchecked' {
  if (!palaceIds.length) return 'unchecked'
  const selected = new Set(selectedIds)
  const count = palaceIds.filter((id) => selected.has(id)).length
  if (count === 0) return 'unchecked'
  if (count === palaceIds.length) return 'checked'
  return 'indeterminate'
}

export function toggleFreestylePalaceGroup(
  selectedIds: number[],
  palaceIds: number[],
  checked: boolean,
) {
  const next = new Set(selectedIds)
  palaceIds.forEach((id) => {
    if (checked) next.add(id)
    else next.delete(id)
  })
  return Array.from(next)
}

export function getFreestyleChapterSelection(
  palaceIds: number[],
  selectedIds: number[],
): 'checked' | 'indeterminate' | 'unchecked' {
  return getFreestylePalaceGroupSelection(palaceIds, selectedIds)
}
