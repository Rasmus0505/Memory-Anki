import { describe, expect, it } from 'vitest'
import type { PalaceGroupedItem, PalaceGroupedListResponse } from '@/shared/api/contracts'
import {
  buildPalaceCatalogQuery,
  createEmptyPalaceGroupedListResponse,
  filterGroupedPalacesByScope,
  flattenGroupedPalaces,
  getPalaceCatalogScopeTitle,
} from './palaceCatalog'

function palace(id: number, title: string): PalaceGroupedItem {
  return {
    id,
    title,
    resolved_title: title,
    description: '',
    created_at: '2026-06-18T00:00:00',
    chapters: [],
    mastered: false,
    title_mode: 'sync',
    manual_title: '',
    grouping_mode: 'auto',
    manual_group_chapter_id: null,
    binding_status: 'ok',
    primary_chapter_id: null,
    primary_chapter: null,
    resolved_subject: null,
    resolved_parent_chapter: null,
    group_id: null,
    group_sort_order: 0,
    next_review_at: null,
    has_due_review: false,
    current_review_schedule_id: null,
    review_stage_total: 0,
    review_stage_completed: 0,
    review_stage_progress: 0,
    stage_labels: [],
    review_stages: [],
    segments: [],
  }
}

function groupedResponse(): PalaceGroupedListResponse {
  return {
    groups: [],
    ungrouped: [],
    subjects: [
      {
        subject: { id: 1, name: '中国近代史', color: '#6366f1' },
        chapter_groups: [
          {
            source_chapter: { id: 11, name: '第一章', subject_id: 1, parent_id: null },
            palaces: [palace(101, 'A')],
          },
        ],
        ungrouped_palaces: [palace(102, 'B')],
      },
      {
        subject: null,
        chapter_groups: [],
        ungrouped_palaces: [palace(201, 'C')],
      },
    ],
  }
}

describe('palaceCatalog model', () => {
  it('creates a fresh empty grouped response', () => {
    const first = createEmptyPalaceGroupedListResponse()
    const second = createEmptyPalaceGroupedListResponse()

    first.subjects.push({
      subject: null,
      chapter_groups: [],
      ungrouped_palaces: [],
    })

    expect(second.subjects).toEqual([])
  })

  it('builds only active catalog query params', () => {
    expect(buildPalaceCatalogQuery({ search: '', selectedSubjectId: null })).toEqual({})
    expect(buildPalaceCatalogQuery({ search: '历史', selectedSubjectId: '1' })).toEqual({
      search: '历史',
      subject_id: '1',
    })
  })

  it('filters grouped palaces by route scope and exposes scope title', () => {
    const data = groupedResponse()
    const subjectOnly = filterGroupedPalacesByScope(data, {
      selectedSubjectId: '1',
      showUncategorizedOnly: false,
    })
    const uncategorizedOnly = filterGroupedPalacesByScope(data, {
      selectedSubjectId: null,
      showUncategorizedOnly: true,
    })

    expect(subjectOnly.subjects).toHaveLength(1)
    expect(subjectOnly.subjects[0].subject?.name).toBe('中国近代史')
    expect(getPalaceCatalogScopeTitle(subjectOnly, {
      selectedSubjectId: '1',
      showUncategorizedOnly: false,
    })).toBe('中国近代史')

    expect(uncategorizedOnly.subjects).toHaveLength(1)
    expect(uncategorizedOnly.subjects[0].subject).toBeNull()
    expect(getPalaceCatalogScopeTitle(uncategorizedOnly, {
      selectedSubjectId: null,
      showUncategorizedOnly: true,
    })).toBe('未分类')
  })

  it('flattens chapter and ungrouped palaces in display order', () => {
    expect(flattenGroupedPalaces(groupedResponse()).map((item) => item.id)).toEqual([
      101,
      102,
      201,
    ])
  })
})
