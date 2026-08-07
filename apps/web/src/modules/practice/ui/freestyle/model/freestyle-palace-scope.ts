import type {
  FreestyleFeedConfig,
  FreestyleSubjectScope,
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
type RawLinkedChapter = { id?: unknown; is_explicit?: unknown }

function readLinkedChapterIds(palace: PalaceGroupedItem, fallbackId?: number) {
  const linkedChapters = Array.isArray(palace.chapters)
    ? palace.chapters.filter(
        (chapter): chapter is RawLinkedChapter => Boolean(chapter && typeof chapter === 'object'),
      )
    : []
  const hasExplicitMarkers = linkedChapters.some((chapter) => typeof chapter.is_explicit === 'boolean')
  const ids = linkedChapters.flatMap((chapter) => {
    if (hasExplicitMarkers && chapter.is_explicit !== true) return []
    const id = Number(chapter.id)
    return Number.isInteger(id) && id > 0 ? [id] : []
  })
  if (!ids.length && palace.primary_chapter_id) ids.push(palace.primary_chapter_id)
  if (!ids.length && fallbackId) ids.push(fallbackId)
  return Array.from(new Set(ids))
}

function chapterFromTree(
  chapter: RawChapter,
  palacesByChapter: Map<number, PalaceGroupedItem[]>,
  displayPalacesByChapter: Map<number, PalaceGroupedItem[]>,
): FreestylePalaceScopeChapter {
  const palaces = displayPalacesByChapter.get(chapter.id) ?? []
  const directPalaceIds = (palacesByChapter.get(chapter.id) ?? []).map((palace) => palace.id)
  const children = ((chapter.children ?? []) as RawChapter[]).map((child) =>
    chapterFromTree(child, palacesByChapter, displayPalacesByChapter),
  )
  const palaceIds = Array.from(new Set([
    ...directPalaceIds,
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
    const displayPalacesByChapter = new Map<number, PalaceGroupedItem[]>()
    const displayedPalaceIds = new Set<number>()
    const groupedPalaces = (bucket.chapter_groups ?? []).flatMap((group) => group.palaces ?? [])
    for (const palace of groupedPalaces) {
      const linkedChapterIds = readLinkedChapterIds(palace, fallbackChapterByPalace.get(palace.id))
      for (const chapterId of linkedChapterIds) {
        const list = palacesByChapter.get(chapterId) ?? []
        if (!list.some((item) => item.id === palace.id)) list.push(palace)
        palacesByChapter.set(chapterId, list)
      }
      const displayChapterId =
        (palace.primary_chapter_id && linkedChapterIds.includes(palace.primary_chapter_id)
          ? palace.primary_chapter_id
          : linkedChapterIds[0]) ?? fallbackChapterByPalace.get(palace.id)
      if (displayChapterId && !displayedPalaceIds.has(palace.id)) {
        const list = displayPalacesByChapter.get(displayChapterId) ?? []
        list.push(palace)
        displayPalacesByChapter.set(displayChapterId, list)
        displayedPalaceIds.add(palace.id)
      }
    }
    const rawRoots = (tree?.chapters ?? []) as RawChapter[]
    const chapters = rawRoots.length
      ? rawRoots.map((chapter) => chapterFromTree(chapter, palacesByChapter, displayPalacesByChapter))
      : (bucket.chapter_groups ?? []).map((group) => chapterFromTree({
          id: group.source_chapter.id,
          name: group.source_chapter.name,
          parent_id: group.source_chapter.parent_id,
        }, palacesByChapter, displayPalacesByChapter))
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

export interface FreestylePalaceScopeSummary {
  subjectScope: FreestyleSubjectScope
  subjectScopeIds: number[]
  selectedIds: number[]
  extraIds: number[]
  effectiveIds: number[]
  isUnrestricted: boolean
}

function uniqueIds(ids: number[]) {
  return Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)))
}

function idsForSubjectScope(
  subjects: FreestylePalaceScopeSubject[],
  subjectScope: FreestyleSubjectScope,
) {
  if (subjectScope === 'all') return []
  const isEnglish = subjectScope === 'english'
  return allFreestylePalaceIdsFromSubjects(
    subjects.filter((subject) => (subject.title.trim() === '英语') === isEnglish),
  )
}

export function getFreestylePalaceScopeSummary(
  config: Pick<FreestyleFeedConfig, 'specific_palace_ids' | 'subject_scope'>,
  subjects: FreestylePalaceScopeSubject[],
): FreestylePalaceScopeSummary {
  const selectedIds = uniqueIds(config.specific_palace_ids)
  const subjectScopeIds = idsForSubjectScope(subjects, config.subject_scope)
  const subjectScopeSet = new Set(subjectScopeIds)
  const extraIds = config.subject_scope === 'all'
    ? selectedIds
    : selectedIds.filter((id) => !subjectScopeSet.has(id))
  const allIds = allFreestylePalaceIdsFromSubjects(subjects)
  const effectiveIds = config.subject_scope === 'all'
    ? selectedIds.length ? selectedIds : allIds
    : uniqueIds([...subjectScopeIds, ...selectedIds])
  return {
    subjectScope: config.subject_scope,
    subjectScopeIds,
    selectedIds,
    extraIds,
    effectiveIds,
    isUnrestricted: config.subject_scope === 'all' && selectedIds.length === 0,
  }
}

export function normalizeFreestylePalaceSelection(
  config: Pick<FreestyleFeedConfig, 'specific_palace_ids' | 'subject_scope'>,
  selectedIds: number[],
  subjects: FreestylePalaceScopeSubject[],
): Pick<FreestyleFeedConfig, 'specific_palace_ids' | 'subject_scope'> {
  const normalizedIds = uniqueIds(selectedIds)
  if (config.subject_scope === 'all') {
    return { specific_palace_ids: normalizedIds, subject_scope: 'all' }
  }

  const subjectScopeIds = idsForSubjectScope(subjects, config.subject_scope)
  if (!subjectScopeIds.length) {
    return { specific_palace_ids: normalizedIds, subject_scope: config.subject_scope }
  }

  const selected = new Set(normalizedIds)
  if (subjectScopeIds.every((id) => selected.has(id))) {
    const subjectScopeSet = new Set(subjectScopeIds)
    return {
      specific_palace_ids: normalizedIds.filter((id) => !subjectScopeSet.has(id)),
      subject_scope: config.subject_scope,
    }
  }

  return { specific_palace_ids: normalizedIds, subject_scope: 'all' }
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
