import type {
  PalaceGroupedItem,
  PalaceGroupedListResponse,
} from '@/shared/api/contracts'
export {
  buildPalaceCatalogGroupedQueryKey,
  PALACE_CATALOG_GROUPED_QUERY_KEY,
} from '@/modules/content/domain/palace-entity/api'

type PalaceSearchableItem = PalaceGroupedItem & {
  tags?: unknown
}

export interface PalaceCatalogScope {
  search: string
  selectedSubjectId: string | null
  showUncategorizedOnly: boolean
}

export function createEmptyPalaceGroupedListResponse(): PalaceGroupedListResponse {
  return {
    groups: [],
    ungrouped: [],
    subjects: [],
  }
}

export function buildPalaceCatalogQuery(
  scope: Pick<PalaceCatalogScope, 'search' | 'selectedSubjectId'>,
) {
  const params: Record<string, string> = {}
  if (scope.search) params.search = scope.search
  if (scope.selectedSubjectId) params.subject_id = scope.selectedSubjectId
  return params
}

export function filterGroupedPalacesByScope(
  data: PalaceGroupedListResponse,
  scope: Pick<PalaceCatalogScope, 'selectedSubjectId' | 'showUncategorizedOnly'>,
): PalaceGroupedListResponse {
  if (scope.showUncategorizedOnly) {
    return {
      ...data,
      subjects: data.subjects.filter((subject) => subject.subject == null),
    }
  }

  if (scope.selectedSubjectId) {
    return {
      ...data,
      subjects: data.subjects.filter(
        (subject) => String(subject.subject?.id ?? '') === scope.selectedSubjectId,
      ),
    }
  }

  return data
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase()
}

function readTagLabel(tag: unknown): string | null {
  if (typeof tag === 'string' || typeof tag === 'number') return String(tag)
  if (!tag || typeof tag !== 'object') return null

  for (const key of ['name', 'title', 'label', 'value']) {
    const value = (tag as Record<string, unknown>)[key]
    if (typeof value === 'string' || typeof value === 'number') return String(value)
  }

  return null
}

export function getPalaceSearchTagLabels(palace: Partial<PalaceSearchableItem>): string[] {
  const tags = palace.tags
  if (Array.isArray(tags)) {
    return tags.map(readTagLabel).filter((tag): tag is string => Boolean(tag))
  }
  const tag = readTagLabel(tags)
  return tag ? [tag] : []
}

export function palaceMatchesSearch(palace: PalaceGroupedItem, search: string) {
  const normalizedSearch = normalizeSearch(search)
  if (!normalizedSearch) return true

  return [
    palace.resolved_title,
    palace.title,
    palace.description,
    palace.primary_chapter?.name,
    palace.resolved_parent_chapter?.name,
    palace.resolved_subject?.name,
    ...getPalaceSearchTagLabels(palace as PalaceSearchableItem),
  ].some((value) =>
    (typeof value === 'string' || typeof value === 'number') &&
    String(value).toLocaleLowerCase().includes(normalizedSearch),
  )
}

export function filterGroupedPalacesBySearch(
  data: PalaceGroupedListResponse,
  search: string,
): PalaceGroupedListResponse {
  if (!normalizeSearch(search)) return data

  return {
    ...data,
    groups: data.groups
      .map((group) => ({
        ...group,
        palaces: group.palaces.filter((palace) => palaceMatchesSearch(palace, search)),
      }))
      .filter((group) => group.palaces.length > 0),
    ungrouped: data.ungrouped.filter((palace) => palaceMatchesSearch(palace, search)),
    subjects: data.subjects
      .map((subject) => ({
        ...subject,
        chapter_groups: subject.chapter_groups
          .map((group) => ({
            ...group,
            palaces: group.palaces.filter((palace) => palaceMatchesSearch(palace, search)),
          }))
          .filter((group) => group.palaces.length > 0),
        ungrouped_palaces: subject.ungrouped_palaces.filter((palace) =>
          palaceMatchesSearch(palace, search),
        ),
      }))
      .filter((subject) => subject.chapter_groups.length > 0 || subject.ungrouped_palaces.length > 0),
  }
}

/**
 * 只保留给定宫殿 id 的内容（记忆档位筛选）。章节与学科空了就一起收起，
 * 但章节的 `question_total` 保持原书总额，筛选不改变进度口径。
 */
export function filterGroupedPalacesByPalaceIds(
  data: PalaceGroupedListResponse,
  palaceIds: ReadonlySet<number>,
): PalaceGroupedListResponse {
  const keep = <T extends { id: number }>(palace: T) => palaceIds.has(palace.id)
  return {
    ...data,
    groups: data.groups
      .map((group) => ({ ...group, palaces: group.palaces.filter(keep) }))
      .filter((group) => group.palaces.length > 0),
    ungrouped: data.ungrouped.filter(keep),
    subjects: data.subjects
      .map((subject) => ({
        ...subject,
        chapter_groups: subject.chapter_groups
          .map((group) => ({ ...group, palaces: group.palaces.filter(keep) }))
          .filter((group) => group.palaces.length > 0),
        ungrouped_palaces: subject.ungrouped_palaces.filter(keep),
      }))
      .filter((subject) => subject.chapter_groups.length > 0 || subject.ungrouped_palaces.length > 0),
  }
}

export function getPalaceCatalogScopeTitle(
  data: PalaceGroupedListResponse,
  scope: Pick<PalaceCatalogScope, 'selectedSubjectId' | 'showUncategorizedOnly'>,
) {
  if (scope.showUncategorizedOnly) return '未分类'
  return (
    data.subjects.find(
      (subject) => String(subject.subject?.id ?? '') === scope.selectedSubjectId,
    )?.subject?.name ?? null
  )
}

export function flattenGroupedPalaces(
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
