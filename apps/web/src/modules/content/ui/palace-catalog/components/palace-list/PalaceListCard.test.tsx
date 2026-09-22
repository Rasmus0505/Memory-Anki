import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PalaceListCard } from './PalaceListCard'
import type { PalaceGroupedItem } from '@/shared/api/contracts'

function buildPalace(overrides: Partial<PalaceGroupedItem> = {}): PalaceGroupedItem {
  return {
    id: 1,
    title: '外国教育史',
    resolved_title: '外国教育史',
    title_mode: 'manual',
    manual_title: '外国教育史',
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
  }
}

const viewSettings = {
  layoutMode: 'chapter-double' as const,
  densityMode: 'comfortable' as const,
}

function renderCard(palace: PalaceGroupedItem, onPalaceReview = vi.fn()) {
  render(
    <MemoryRouter>
      <PalaceListCard
        palace={palace}
        viewSettings={viewSettings}
        onPalaceReview={onPalaceReview}
        onDelete={vi.fn()}
      />
    </MemoryRouter>,
  )
  return onPalaceReview
}

describe('PalaceListCard unit review entry', () => {
  it('uses a distinct start-marking action when no permanent mark exists', () => {
    const onPalaceReview = renderCard(buildPalace({ review_status: 'marking_required' }))

    const button = screen.getByRole('button', { name: '开始标记' })
    expect(button.className).toContain('border-violet-500')
    fireEvent.click(button)
    expect(onPalaceReview).toHaveBeenCalledTimes(1)
  })

  it('starts review only for a due palace', () => {
    const onPalaceReview = renderCard(buildPalace({ review_status: 'due' }))

    fireEvent.click(screen.getByRole('button', { name: '立即复习' }))
    expect(onPalaceReview).toHaveBeenCalledTimes(1)
  })

  it('shows the next local review date without allowing early review', () => {
    renderCard(buildPalace({ review_status: 'scheduled', next_review_date: '2026-07-30' }))

    expect(screen.getByRole('button', { name: '7月30日复习' }).hasAttribute('disabled')).toBe(true)
  })

  it('does not reconstruct an entry from legacy node or segment fields', () => {
    renderCard({
      ...buildPalace(),
      review_status: undefined,
      due_node_count: 4,
      has_due_review: true,
    } as unknown as PalaceGroupedItem)

    expect(screen.queryByRole('button', { name: /复习|标记/ })).toBeNull()
    expect(screen.queryByText(/掌握/)).toBeNull()
  })

  it('reuses the mind-map question corner badges outside the card', () => {
    const onPalaceReview = vi.fn()
    render(
      <MemoryRouter initialEntries={['/palaces/list']}>
        <Routes>
          <Route
            path="/palaces/list"
            element={
              <PalaceListCard
                palace={buildPalace({
                  id: 7,
                  quiz_count_badges: [
                    { text: '1', tone: 'info', title: '主观 1 道', kind: 'subjective' },
                    { text: '3', tone: 'rose', title: '客观 3 道，含标记题', kind: 'objective' },
                  ],
                })}
                viewSettings={viewSettings}
                onPalaceReview={onPalaceReview}
                onDelete={vi.fn()}
              />
            }
          />
          <Route path="/palaces/:id/quiz" element={<div>quiz-page</div>} />
        </Routes>
      </MemoryRouter>,
    )

    const subjective = screen.getByRole('button', { name: '主观 1 道' })
    const objective = screen.getByRole('button', { name: '客观 3 道，含标记题' })
    expect(subjective.className).toContain('bg-sky-600')
    expect(objective.className).toContain('bg-rose-600')
    expect(objective.getAttribute('data-quiz-count-badge')).toBe('objective')
    expect(subjective.closest('div')?.className).toContain('-bottom-2')
    fireEvent.click(objective)
    expect(onPalaceReview).not.toHaveBeenCalled()
    expect(screen.getByText('quiz-page')).toBeTruthy()
  })
})
