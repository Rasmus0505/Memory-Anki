import { describe, expect, it } from 'vitest'
import type { PalaceGroupedListResponse } from '@/shared/api/contracts'
import {
  allFreestylePalaceIds,
  buildFreestylePalaceScopeSections,
  buildFreestylePalaceScopeSubjects,
  allFreestylePalaceIdsFromSubjects,
  getFreestylePalaceScopeSummary,
  getFreestyleChapterSelection,
  getFreestylePalaceGroupSelection,
  normalizeFreestylePalaceSelection,
  toggleFreestylePalaceGroup,
} from './freestyle-palace-scope'

const palace = (id: number, title: string) => ({
  id,
  title,
  description: '',
  archived: false,
  created_at: null,
  next_review_at: null,
  has_due_review: true,
  review_status: 'due' as const,
  review_unit_count: 1,
  due_review_unit_count: 1,
  permanent_mark_count: 1,
  resolved_title: title,
  title_mode: 'sync',
  manual_title: '',
  grouping_mode: 'auto',
  manual_group_chapter_id: null,
  binding_status: 'ok',
  primary_chapter_id: 10,
  primary_chapter: { id: 10, name: '小节', subject_id: 1, parent_id: 9 },
  chapters: [
    { id: 9, name: '第一章', subject_id: 1, parent_id: null, is_explicit: false },
    { id: 10, name: '小节', subject_id: 1, parent_id: 9, is_explicit: true },
  ],
  resolved_subject: { id: 1, name: '教育学', color: '#6366f1' },
  resolved_parent_chapter: { id: 9, name: '第一章', subject_id: 1, parent_id: null },
  group_id: null,
  group_sort_order: id,
})

function grouped(): PalaceGroupedListResponse {
  return {
    groups: [],
    ungrouped: [],
    subjects: [{
      subject: { id: 1, name: '教育学', color: '#6366f1' },
      chapter_groups: [{
        source_chapter: { id: 9, name: '第一章', subject_id: 1, parent_id: null },
        palaces: [palace(40, '第一节'), palace(41, '第二节')],
      }],
      ungrouped_palaces: [palace(42, '未分类宫殿')],
    }],
  }
}

describe('freestyle palace scope model', () => {
  it('keeps chapter groups and ungrouped palaces selectable', () => {
    const sections = buildFreestylePalaceScopeSections(grouped())
    expect(sections[0].groups.map((group) => group.title)).toEqual(['第一章', '未分类宫殿'])
    expect(allFreestylePalaceIds(sections)).toEqual([40, 41, 42])
  })

  it('reports checked, indeterminate, and unchecked chapter states', () => {
    expect(getFreestylePalaceGroupSelection([40, 41], [])).toBe('unchecked')
    expect(getFreestylePalaceGroupSelection([40, 41], [40])).toBe('indeterminate')
    expect(getFreestylePalaceGroupSelection([40, 41], [40, 41])).toBe('checked')
  })

  it('toggles every palace in a chapter without touching other groups', () => {
    expect(toggleFreestylePalaceGroup([42], [40, 41], true)).toEqual([42, 40, 41])
    expect(toggleFreestylePalaceGroup([40, 41, 42], [40, 41], false)).toEqual([42])
  })

  it('builds a recursive subject tree and bubbles descendant palace ids to parents', () => {
    const subjects = buildFreestylePalaceScopeSubjects(grouped(), [{
      subject: { id: 1, name: '教育学' },
      chapters: [{
        id: 9,
        name: '第一章',
        parent_id: null,
        children: [{ id: 10, name: '第一节', parent_id: 9, children: [] }],
      }],
    }])
    const root = subjects[0].chapters[0]
    expect(root.palaceIds).toEqual([40, 41])
    expect(root.palaces).toEqual([])
    expect(root.children[0].palaceIds).toEqual([40, 41])
    expect(root.children[0].palaces.map((item) => item.id)).toEqual([40, 41])
    expect(subjects[0].ungrouped?.palaceIds).toEqual([42])
    expect(getFreestyleChapterSelection(root.palaceIds, [40])).toBe('indeterminate')
  })

  it('supports selecting and clearing the complete subject scope', () => {
    const subjects = buildFreestylePalaceScopeSubjects(grouped())
    expect(allFreestylePalaceIdsFromSubjects(subjects)).toEqual([40, 41, 42])
    expect(toggleFreestylePalaceGroup([], [40, 41, 42], true)).toEqual([40, 41, 42])
    expect(toggleFreestylePalaceGroup([40, 41, 42], [40, 41, 42], false)).toEqual([])
  })

  it('treats a subject preset as a broad scope plus explicit extra palaces', () => {
    const subjects = [
      {
        key: 'subject:english',
        id: 1,
        title: '英语',
        chapters: [],
        ungrouped: { key: 'english', title: '未归类宫殿', palaces: [palace(1, 'English')], palaceIds: [1] },
      },
      {
        key: 'subject:education',
        id: 2,
        title: '教育学',
        chapters: [],
        ungrouped: { key: 'education', title: '未归类宫殿', palaces: [palace(2, '卢梭')], palaceIds: [2] },
      },
    ]
    const config = { subject_scope: 'english' as const, specific_palace_ids: [1, 2] }
    const summary = getFreestylePalaceScopeSummary(config, subjects)
    expect(summary.extraIds).toEqual([2])
    expect(summary.effectiveIds).toEqual([1, 2])
    expect(normalizeFreestylePalaceSelection(config, [1, 2], subjects)).toEqual({
      subject_scope: 'english',
      specific_palace_ids: [2],
    })
    expect(normalizeFreestylePalaceSelection(config, [2], subjects)).toEqual({
      subject_scope: 'all',
      specific_palace_ids: [2],
    })
  })
})
