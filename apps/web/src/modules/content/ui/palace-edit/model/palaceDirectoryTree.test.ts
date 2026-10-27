import { describe, expect, it } from 'vitest'
import type { PalaceGroupedItem, PalaceGroupedListResponse } from '@/shared/api/contracts'
import {
  buildPalaceDirectoryTree,
  collectDirectoryPalaceIds,
  expansionKeysForPalace,
  filterPalaceDirectoryTree,
  type DirectorySubjectTree,
} from './palaceDirectoryTree'

function palace(overrides: Partial<PalaceGroupedItem> & { id: number }): PalaceGroupedItem {
  return {
    title: `宫殿 ${overrides.id}`,
    description: '',
    created_at: null,
    next_review_at: null,
    has_due_review: false,
    review_status: 'scheduled',
    review_unit_count: 0,
    due_review_unit_count: 0,
    permanent_mark_count: 0,
    resolved_title: `宫殿 ${overrides.id}`,
    title_mode: 'sync',
    manual_title: '',
    grouping_mode: 'auto',
    manual_group_chapter_id: null,
    binding_status: 'bound',
    primary_chapter_id: null,
    primary_chapter: null,
    resolved_subject: null,
    resolved_parent_chapter: null,
    group_id: null,
    group_sort_order: 0,
    ...overrides,
  } as PalaceGroupedItem
}

function groupedResponse(overrides: Partial<PalaceGroupedListResponse>): PalaceGroupedListResponse {
  return { groups: [], ungrouped: [], subjects: [], ...overrides }
}

const subjects = [
  { id: 1, name: '中国教育史', color: '#6366f1', sort_order: 0 },
  { id: 2, name: '外国教育史', color: '#2563eb', sort_order: 1 },
]

const chapterTrees: DirectorySubjectTree[] = [
  {
    subject: subjects[0],
    chapters: [
      {
        id: 11,
        name: '第一节 原始社会',
        sort_order: 0,
        children: [
          { id: 111, name: '一、学校萌芽', sort_order: 0, children: [] },
        ],
      },
      { id: 12, name: '第二节 汉代', sort_order: 1, children: [] },
    ],
  },
  {
    subject: subjects[1],
    chapters: [{ id: 21, name: '第一章 古希腊', sort_order: 0, children: [] }],
  },
]

describe('buildPalaceDirectoryTree', () => {
  it('places every palace once under its primary chapter, even when the API repeats it', () => {
    const shared = palace({
      id: 100,
      resolved_title: '第二节 汉代的学校教育制度',
      primary_chapter_id: 12,
      primary_chapter: { id: 12, name: '第二节 汉代', subject_id: 1, parent_id: null },
    })
    const tree = buildPalaceDirectoryTree({
      subjects,
      chapterTrees,
      grouped: groupedResponse({
        groups: [{ id: 5, name: '汉代', color: '#000', sort_order: 0, source_chapter_id: 12, palaces: [shared] }],
        subjects: [
          {
            subject: subjects[0],
            chapter_groups: [{ source_chapter: { id: 11, name: '第一节 原始社会', subject_id: 1, parent_id: null }, palaces: [shared] }],
            ungrouped_palaces: [],
          },
        ],
      }),
    })

    expect(collectDirectoryPalaceIds(tree)).toEqual([100])
    const firstSubject = tree.subjects[0]
    expect(firstSubject.chapters[1].palaces.map((item) => item.id)).toEqual([100])
    expect(firstSubject.chapters[0].palaces).toEqual([])
  })

  it('keeps empty chapters so they stay available as drop targets', () => {
    const tree = buildPalaceDirectoryTree({
      subjects,
      chapterTrees,
      grouped: groupedResponse({}),
    })

    expect(tree.subjects[0].chapters.map((chapter) => chapter.name)).toEqual([
      '第一节 原始社会',
      '第二节 汉代',
    ])
    expect(tree.subjects[0].chapters[0].children.map((chapter) => chapter.name)).toEqual(['一、学校萌芽'])
  })

  it('falls back to the subject bucket, then to root ungrouped', () => {
    const homelessInSubject = palace({ id: 200, resolved_title: '未落地甲' })
    const homelessEverywhere = palace({ id: 300, resolved_title: '未落地乙' })
    const tree = buildPalaceDirectoryTree({
      subjects,
      chapterTrees,
      grouped: groupedResponse({
        subjects: [
          { subject: subjects[1], chapter_groups: [], ungrouped_palaces: [homelessInSubject] },
        ],
        ungrouped: [homelessEverywhere],
      }),
    })

    expect(tree.subjects[1].ungrouped.map((item) => item.id)).toEqual([200])
    expect(tree.ungrouped.map((item) => item.id)).toEqual([300])
  })

  it('sorts palaces inside a chapter by explicit order', () => {
    const late = palace({ id: 1, resolved_title: '乙', primary_chapter_id: 12, group_sort_order: 2 })
    const early = palace({ id: 2, resolved_title: '甲', primary_chapter_id: 12, group_sort_order: 1 })
    const tree = buildPalaceDirectoryTree({
      subjects,
      chapterTrees,
      grouped: groupedResponse({
        subjects: [{ subject: subjects[0], chapter_groups: [], ungrouped_palaces: [late, early] }],
      }),
    })

    expect(tree.subjects[0].chapters[1].palaces.map((item) => item.id)).toEqual([2, 1])
    expect(tree.subjects[0].ungrouped).toEqual([])
  })
})

describe('filterPalaceDirectoryTree', () => {
  it('keeps the ancestor path of a matched palace', () => {
    const target = palace({ id: 42, resolved_title: '汉代太学', primary_chapter_id: 12 })
    const tree = buildPalaceDirectoryTree({
      subjects,
      chapterTrees,
      grouped: groupedResponse({
        subjects: [{ subject: subjects[0], chapter_groups: [], ungrouped_palaces: [target] }],
      }),
    })

    const filtered = filterPalaceDirectoryTree(tree, '太学')
    expect(filtered.subjects).toHaveLength(1)
    expect(filtered.subjects[0].name).toBe('中国教育史')
    expect(filtered.subjects[0].chapters).toHaveLength(1)
    expect(filtered.subjects[0].chapters[0].name).toBe('第二节 汉代')
    expect(filtered.subjects[0].chapters[0].palaces.map((item) => item.id)).toEqual([42])
  })

  it('keeps an entire subject when its name matches', () => {
    const tree = buildPalaceDirectoryTree({ subjects, chapterTrees, grouped: groupedResponse({}) })
    const filtered = filterPalaceDirectoryTree(tree, '外国')
    expect(filtered.subjects.map((subject) => subject.id)).toEqual([2])
    expect(filtered.subjects[0].chapters).toHaveLength(1)
  })

  it('returns the original tree for a blank keyword', () => {
    const tree = buildPalaceDirectoryTree({ subjects, chapterTrees, grouped: groupedResponse({}) })
    expect(filterPalaceDirectoryTree(tree, '   ')).toBe(tree)
  })
})

describe('expansionKeysForPalace', () => {
  it('returns the subject and chapter path of the palace', () => {
    const target = palace({ id: 7, resolved_title: '学校萌芽', primary_chapter_id: 111 })
    const tree = buildPalaceDirectoryTree({
      subjects,
      chapterTrees,
      grouped: groupedResponse({
        subjects: [{ subject: subjects[0], chapter_groups: [], ungrouped_palaces: [target] }],
      }),
    })

    expect(expansionKeysForPalace(tree, 7)).toEqual(['subject:1', 'chapter:11', 'chapter:111'])
    expect(expansionKeysForPalace(tree, 999)).toEqual([])
  })

  it('opens the ungrouped bucket that actually holds the palace', () => {
    const inSubject = palace({ id: 8, resolved_title: '学科未分类' })
    const atRoot = palace({ id: 9, resolved_title: '根未分类' })
    const tree = buildPalaceDirectoryTree({
      subjects,
      chapterTrees,
      grouped: groupedResponse({
        subjects: [{ subject: subjects[1], chapter_groups: [], ungrouped_palaces: [inSubject] }],
        ungrouped: [atRoot],
      }),
    })

    expect(expansionKeysForPalace(tree, 8)).toEqual(['subject:2', 'subject:2:ungrouped'])
    expect(expansionKeysForPalace(tree, 9)).toEqual(['root:ungrouped'])
  })
})
