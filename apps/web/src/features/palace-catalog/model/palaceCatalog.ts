import type {
  PalaceGroupedItem,
  PalaceGroupedListResponse,
} from '@/shared/api/contracts'

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
