import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PalaceListCard } from '@/modules/content/ui/palace-catalog/components/palace-list/PalaceListCard'
import type { PalaceGroupedItem, PalaceSegmentSummary, ReviewStageSummary } from '@/shared/api/contracts'

function buildStage(reviewNumber: number, label: string, completed = false): ReviewStageSummary {
  return {
    review_number: reviewNumber,
    label,
    completed,
    completed_at: completed ? '2026-06-12T10:00:00+08:00' : null,
    scheduled_at: completed ? '2026-06-12T10:00:00+08:00' : '2026-06-13T10:00:00+08:00',
  }
}

function buildSegment(overrides: Partial<PalaceSegmentSummary> = {}): PalaceSegmentSummary {
  return {
    id: 101,
    palace_id: 1,
    name: '第 1 部分',
    display_name: '17—18世纪',
    color: '#60a5fa',
    created_at: '2026-06-12T10:00:00+08:00',
    sort_order: 0,
    node_uids: ['n1'],
    node_count: 22,
    estimated_review_seconds: 990,
    review_stage_total: 3,
    review_stage_completed: 1,
    review_stage_progress: 0.33,
    stage_labels: ['1小时', '1天', '2天'],
    review_stages: [buildStage(0, '1小时', true), buildStage(1, '1天'), buildStage(2, '2天')],
    next_review_at: '2026-06-13T10:00:00+08:00',
    has_due_review: true,
    current_review_schedule_id: 1001,
    current_review_type: 'normal',
    active_review_progress: 0.4,
    is_empty: false,
    is_virtual_default: false,
    ...overrides,
  }
}

function buildPalace(overrides: Partial<PalaceGroupedItem> = {}): PalaceGroupedItem {
  return {
    id: 1,
    title: '第二节法国教育的发展/143',
    resolved_title: '第二节法国教育的发展/143',
    title_mode: 'manual',
    manual_title: '第二节法国教育的发展/143',
    grouping_mode: 'chapter',
    manual_group_chapter_id: null,
    binding_status: 'bound',
    primary_chapter_id: 2,
    primary_chapter: { id: 2, name: '第8章欧美主要国家和日本的现代教育制度', subject_id: 5, parent_id: null },
    resolved_subject: { id: 5, name: '教育学', color: '#2563eb' },
    resolved_parent_chapter: null,
    group_id: null,
    group_sort_order: 0,
    description: '',
    mastered: false,
    needs_practice: false,
    created_at: '2026-06-12T10:00:00+08:00',
    next_review_at: '2026-06-13T10:00:00+08:00',
    has_due_review: true,
    current_review_schedule_id: 3001,
    review_stage_total: 3,
    review_stage_completed: 1,
    review_stage_progress: 0.33,
    stage_labels: ['1小时', '1天', '2天'],
    review_stages: [buildStage(0, '1小时', true), buildStage(1, '1天'), buildStage(2, '2天')],
    active_review_progress: 0.2,
    mastery_percent: 42,
    memory_health_percent: 76,
    memory_node_count: 22,
    mastered_node_count: 5,
    mastery_horizon_days: 60,
    due_node_count: 3,
    overdue_node_count: 1,
    memory_next_review_at: '2026-06-13T10:00:00+08:00',
    severe_weak_node_count: 0,
    segments: [buildSegment()],
    chapters: [{ id: 2, name: '第二节法国教育的发展' }],
    ...overrides,
  }
}

const defaultCardProps = {
  viewSettings: { layoutMode: 'chapter-double' as const, densityMode: 'comfortable' as const },
  onPalaceReview: vi.fn(),
  onSegmentReview: vi.fn(),
  onDelete: vi.fn(),
}

describe('PalaceListCard', () => {
  it('uses palace FSRS due_node_count rather than segment-only flags for the primary CTA', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-12T10:00:00+08:00'))

    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            due_node_count: 0,
            has_due_review: false,
            review_entry_mode: 'none',
            review_entry_label: null,
            memory_next_review_at: '2026-06-13T10:00:00+08:00',
            next_review_at: '2026-06-13T10:00:00+08:00',
            segments: [
              buildSegment({
                next_review_at: '2026-06-12T09:00:00+08:00',
                has_due_review: false,
              }),
            ],
          })}
          {...defaultCardProps}
        />
      </MemoryRouter>,
    )

    // Not due now → early-review label, not forced "开始复习" / practice.
    expect(screen.queryByRole('button', { name: '练习' })).toBeNull()
    expect(screen.queryByRole('button', { name: '开始复习' })).toBeNull()
    expect(screen.getByRole('button', { name: /提前复习/ })).toBeTruthy()
    vi.useRealTimers()
  })

  it('shows FSRS entry labels from palace card payloads even when segments are omitted', () => {
    const onPalaceReview = vi.fn()
    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            segments: undefined,
            due_node_count: 4,
            has_due_review: true,
            review_entry_mode: 'palace',
            review_entry_label: '开始复习',
            memory_next_review_at: '2026-06-12T09:00:00+08:00',
          })}
          {...defaultCardProps}
          onPalaceReview={onPalaceReview}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: '练习' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '开始复习' }))
    expect(onPalaceReview).toHaveBeenCalledTimes(1)
  })

  it('hides practice entry and keeps quiz as a plain side action when no review is scheduled', () => {
    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            needs_practice: true,
            memory_node_count: 0,
            memory_next_review_at: null,
            due_node_count: 0,
            has_due_review: false,
            review_entry_mode: 'none',
            segments: [
              buildSegment({
                has_due_review: false,
                current_review_schedule_id: null,
                next_review_at: null,
              }),
            ],
          })}
          {...defaultCardProps}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: '练习' })).toBeNull()
    expect(screen.getByRole('button', { name: '做题' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /编辑宫殿/ })).toBeTruthy()
  })

  it('shows active review progress for a resumed single-segment review', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T11:00:00+08:00'))

    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            segments: [buildSegment({ active_review_progress: 0.4 })],
          })}
          {...defaultCardProps}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('progressbar', { name: '复习进度 40%' })).toBeTruthy()
    expect(screen.getByTestId('review-action-progress-fill').style.width).toBe('40%')
    vi.useRealTimers()
  })

  it('shows FSRS memory progress for a single-segment palace without rendering the default segment card', () => {
    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            segments: [
              buildSegment({
                id: 0,
                display_name: '第 1 部分',
                is_virtual_default: true,
              }),
            ],
          })}
          {...defaultCardProps}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('progressbar', { name: '掌握度 42%' })).toBeTruthy()
    expect(screen.getByText('掌握 42%')).toBeTruthy()
    expect(screen.queryByText('到期 3')).toBeNull()
    expect(screen.getByText('22 个知识点')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '展开详情' })).toBeNull()
    expect(screen.queryByText('第 1 部分')).toBeNull()
  })

  it('keeps multi-segment details expandable while showing FSRS progress before expansion', () => {
    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            segments: [
              buildSegment({ id: 101, display_name: '17—18世纪' }),
              buildSegment({ id: 102, display_name: '19世纪', sort_order: 1 }),
            ],
          })}
          {...defaultCardProps}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('progressbar', { name: '掌握度 42%' })).toBeTruthy()
    expect(screen.queryByText('17—18世纪')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开详情' }))

    expect(screen.getByText('17—18世纪')).toBeTruthy()
    expect(screen.getByText('19世纪')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '练习' })).toBeNull()
  })

  it('opens formal FSRS review via the palace action and keeps resume progress fill', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T11:00:00+08:00'))
    const onPalaceReview = vi.fn()

    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            due_node_count: 3,
            has_due_review: true,
            review_entry_mode: 'palace',
            review_entry_label: '开始复习',
            segments: [
              buildSegment({
                id: 0,
                is_virtual_default: true,
                current_review_schedule_id: null,
                active_review_progress: 0.4,
              }),
            ],
          })}
          {...defaultCardProps}
          onPalaceReview={onPalaceReview}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /开始复习/ }))
    expect(screen.getByRole('progressbar', { name: '复习进度 40%' })).toBeTruthy()
    expect(screen.getByTestId('review-action-progress-fill').style.width).toBe('40%')
    expect(onPalaceReview).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('highlights title and description search matches without treating special characters as regex', () => {
    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            title: 'A.B 教育线索',
            resolved_title: 'A.B 教育线索',
            description: '描述里也有 A.B 这个关键词',
          })}
          {...defaultCardProps}
          searchQuery="A.B"
          defaultExpanded
        />
      </MemoryRouter>,
    )

    const highlights = screen.getAllByText('A.B')
    expect(highlights).toHaveLength(2)
    highlights.forEach((highlight) => expect(highlight.tagName).toBe('MARK'))
  })
})
