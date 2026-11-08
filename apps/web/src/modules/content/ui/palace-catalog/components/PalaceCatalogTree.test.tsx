import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PalaceGroupedItem, PalaceGroupedListResponse } from '@/shared/api/contracts'
import { resetPalaceDirectoryViewState } from '@/modules/content/ui/palace-edit/model/palaceDirectoryViewState'
import { PalaceCatalogTree } from './PalaceCatalogTree'
import { buildPalaceCatalogTree } from '../model/palaceCatalogTree'

vi.mock('@/modules/practice/public', () => ({
  PalaceReviewUnitsPanel: () => <div>复习进度面板</div>,
}))

vi.mock('@/modules/exam/public', () => ({
  ExamStarPicker: () => null,
}))

vi.mock('@/modules/content/ui/palace-favorite', () => ({
  PalaceFavoriteButton: () => null,
}))

function buildPalace(overrides: Partial<PalaceGroupedItem> = {}): PalaceGroupedItem {
  return {
    id: 1,
    title: '第一节 西周的教育制度',
    resolved_title: '第一节 西周的教育制度',
    title_mode: 'manual',
    manual_title: '',
    grouping_mode: 'chapter',
    manual_group_chapter_id: null,
    binding_status: 'bound',
    primary_chapter_id: null,
    primary_chapter: null,
    resolved_subject: null,
    resolved_parent_chapter: null,
    group_id: null,
    group_sort_order: 0,
    description: '',
    created_at: '2026-07-27T10:00:00+08:00',
    next_review_at: null,
    has_due_review: false,
    review_status: 'marking_required',
    review_unit_count: 0,
    due_review_unit_count: 0,
    permanent_mark_count: 0,
    segments: [],
    chapters: [],
    ...overrides,
  } as PalaceGroupedItem
}

const subject = { id: 3, name: '中国教育史', color: '#6366f1' }
const chapterOne = { id: 10, name: '第一章 官学制度', subject_id: 3, parent_id: null }
const sectionOne = { id: 11, name: '第一节 西周', subject_id: 3, parent_id: 10 }

function groupedWith(palaces: PalaceGroupedItem[], extra: PalaceGroupedItem[] = []): PalaceGroupedListResponse {
  return {
    groups: [],
    ungrouped: [],
    subjects: [{
      subject,
      chapter_groups: [
        { source_chapter: chapterOne, palaces: extra },
        { source_chapter: sectionOne, palaces },
      ],
      ungrouped_palaces: [],
    }],
  } as PalaceGroupedListResponse
}

function renderTree(grouped: PalaceGroupedListResponse, onPalaceReview = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/palaces']}>
      <Routes>
        <Route
          path="/palaces"
          element={(
            <PalaceCatalogTree
              grouped={grouped}
              onPalaceReview={onPalaceReview}
              onDelete={vi.fn()}
              defaultExpanded
              viewStateKey="test-tree"
            />
          )}
        />
        <Route path="/palaces/:id/edit" element={<div>editor-page</div>} />
        <Route path="/palaces/:id/quiz" element={<div>quiz-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
  return onPalaceReview
}

beforeEach(() => {
  resetPalaceDirectoryViewState()
})

function groupedWithQuestionTotals() {
  return {
    groups: [],
    ungrouped: [],
    subjects: [{
      subject,
      chapter_groups: [
        {
          source_chapter: chapterOne,
          palaces: [buildPalace({ id: 6, title: '官学', resolved_title: '官学', quiz_question_total: 5 })],
          question_total: 8,
        },
        { source_chapter: sectionOne, palaces: [buildPalace({ id: 7, title: '西周', resolved_title: '西周', quiz_question_total: 3 })], question_total: 3 },
      ],
      ungrouped_palaces: [],
      question_total: 10,
    }],
  } as PalaceGroupedListResponse
}

describe('buildPalaceCatalogTree', () => {
  it('gives each row its share of the level above it', () => {
    const { tree } = buildPalaceCatalogTree(groupedWithQuestionTotals())
    const subjectNode = tree.subjects[0]
    const chapterNode = subjectNode.chapters[0]
    const sectionNode = chapterNode.children[0]
    expect(subjectNode.questionShare).toBeCloseTo(1)
    expect(chapterNode.questionShare).toBeCloseTo(0.8)
    expect(sectionNode.questionShare).toBeCloseTo(0.3)
    expect(chapterNode.palaces[0].questionShare).toBeCloseTo(0.625)
    expect(sectionNode.palaces[0].questionShare).toBeCloseTo(1)
  })

  it('draws no share when the catalog has no question totals', () => {
    const { tree } = buildPalaceCatalogTree(groupedWith([buildPalace()]))
    expect(tree.subjects[0].questionShare).toBeUndefined()
    expect(tree.subjects[0].chapters[0].questionShare).toBeUndefined()
    expect(tree.subjects[0].chapters[0].children[0].palaces[0].questionShare).toBeUndefined()
  })

  it('nests chapters by parent and lists each palace once', () => {
    const palace = buildPalace({ id: 5 })
    const { tree, palacesById } = buildPalaceCatalogTree({
      ...groupedWith([palace]),
      ungrouped: [palace],
    })
    expect(tree.subjects).toHaveLength(1)
    expect(tree.subjects[0].chapters.map((chapter) => chapter.name)).toEqual(['第一章 官学制度'])
    expect(tree.subjects[0].chapters[0].children.map((chapter) => chapter.name)).toEqual(['第一节 西周'])
    expect(tree.ungrouped).toHaveLength(0)
    expect(palacesById.size).toBe(1)
  })
})

describe('PalaceCatalogTree rows', () => {
  it('shows subject → chapter → palace and opens the editor from the palace row', () => {
    renderTree(groupedWith([buildPalace({ id: 7, title: '学在官府', resolved_title: '学在官府' })]))
    expect(screen.getByText('中国教育史')).toBeTruthy()
    expect(screen.getByText('第一章 官学制度')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '学在官府' }))
    expect(screen.getByText('editor-page')).toBeTruthy()
  })

  it('uses a distinct start-marking action when no permanent mark exists', () => {
    const onPalaceReview = renderTree(groupedWith([buildPalace({ review_status: 'marking_required' })]))
    const button = screen.getByRole('button', { name: '开始标记' })
    expect(button.className).toContain('border-mark/25')
    fireEvent.click(button)
    expect(onPalaceReview).toHaveBeenCalledTimes(1)
  })

  it('starts review only for a due palace', () => {
    const onPalaceReview = renderTree(groupedWith([buildPalace({ review_status: 'due', review_unit_count: 3, due_review_unit_count: 2 })]))
    fireEvent.click(screen.getByRole('button', { name: '立即复习' }))
    expect(onPalaceReview).toHaveBeenCalledTimes(1)
  })

  it('shows the next review date, says why it is not today, and blocks early review', () => {
    renderTree(groupedWith([buildPalace({ review_status: 'scheduled', next_review_date: '2026-07-30' } as Partial<PalaceGroupedItem>)]))
    const chip = screen.getByRole('button', { name: '7月30日复习' })
    expect(chip.hasAttribute('disabled')).toBe(true)
    expect(chip.getAttribute('title')).toBe('还没到复习日（7月30日），今天不会出现')
  })

  it('does not reconstruct an entry from legacy node or segment fields', () => {
    renderTree(groupedWith([{
      ...buildPalace(),
      review_status: undefined,
      due_node_count: 4,
      has_due_review: true,
    } as unknown as PalaceGroupedItem]))
    expect(screen.queryByRole('button', { name: /复习|标记/ })).toBeNull()
  })

  it('draws a question-share line with its percentage on subject, chapter and palace rows', () => {
    renderTree(groupedWithQuestionTotals())
    expect(screen.getAllByLabelText('题目占比 100%')).toHaveLength(1)
    expect(screen.getByLabelText('题目占比 80%')).toBeTruthy()
    expect(screen.getByLabelText('题目占比 63%')).toBeTruthy()
    // The leaf chapter folds into its single palace row, so the row carries the chapter's 3/10, not 3/3.
    expect(screen.getByLabelText('题目占比 30%')).toBeTruthy()
    expect(screen.getByText('80%')).toBeTruthy()
  })

  it('keeps 做题 one click away and progress/delete in the row menu', () => {
    renderTree(groupedWith([buildPalace({ id: 9, quiz_question_total: 4 } as Partial<PalaceGroupedItem>)]))
    expect(screen.getByRole('link', { name: /做题/ }).textContent).toContain('4')
    fireEvent.keyDown(screen.getByRole('button', { name: /更多操作/ }), { key: 'Enter' })
    expect(screen.getByRole('menuitem', { name: '复习进度' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '删除' })).toBeTruthy()
  })

  it('rolls due units up to the chapter row', () => {
    renderTree(groupedWith([
      buildPalace({ id: 1, review_status: 'due', review_unit_count: 3, due_review_unit_count: 2 }),
      buildPalace({ id: 2, title: '乙', resolved_title: '乙', review_status: 'due', review_unit_count: 3, due_review_unit_count: 1 }),
    ]))
    expect(screen.getAllByTitle('3 个现在可以复习').length).toBeGreaterThan(0)
  })
})
