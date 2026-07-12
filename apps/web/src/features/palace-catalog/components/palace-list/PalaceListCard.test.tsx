import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PalaceListCard } from '@/features/palace-catalog/components/palace-list/PalaceListCard'
import type { MiniPalaceSummary, PalaceGroupedItem, PalaceSegmentSummary, ReviewStageSummary } from '@/shared/api/contracts'

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

function buildMiniPalace(overrides: Partial<MiniPalaceSummary> = {}): MiniPalaceSummary {
  return {
    id: 201,
    palace_id: 1,
    name: '迷你宫殿训练',
    node_uids: ['m1'],
    node_count: 22,
    sort_order: 0,
    created_at: '2026-06-12T10:00:00+08:00',
    updated_at: '2026-06-12T10:00:00+08:00',
    is_empty: false,
    needs_practice: false,
    estimated_review_seconds: 990,
    review_stage_total: 3,
    review_stage_completed: 1,
    review_stage_progress: 0.33,
    stage_labels: ['1小时', '1天', '2天'],
    review_stages: [buildStage(0, '1小时', true), buildStage(1, '1天'), buildStage(2, '2天')],
    next_review_at: '2026-06-13T10:00:00+08:00',
    has_due_review: true,
    current_review_schedule_id: 2001,
    current_review_type: 'normal',
    active_review_progress: 0.5,
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
    segments: [buildSegment()],
    mini_palaces: [buildMiniPalace()],
    chapters: [{ id: 2, name: '第二节法国教育的发展' }],
    ...overrides,
  }
}

describe('PalaceListCard', () => {
  it('does not render start review when due flag is false even if the timestamp is stale', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-12T10:00:00+08:00'))

    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            mini_palaces: [],
            segments: [
              buildSegment({
                next_review_at: '2026-06-12T09:00:00+08:00',
                has_due_review: false,
              }),
            ],
          })}
          viewSettings={{ layoutMode: 'chapter-double', densityMode: 'comfortable' }}
          onPalacePractice={vi.fn()}
          onSegmentPractice={vi.fn()}
          onMiniPalacePractice={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('button', { name: '开始复习' })).toBeNull()
    expect(screen.queryByRole('button', { name: '今日稍后' })).toBeNull()
    vi.useRealTimers()
  })

  it('uses the shared primary button for palace practice and keeps quiz as a plain entry', () => {
    const onPalacePractice = vi.fn()

    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            mini_palaces: [],
            needs_practice: true,
            segments: [
              buildSegment({
                has_due_review: false,
                current_review_schedule_id: null,
              }),
            ],
          })}
          viewSettings={{ layoutMode: 'chapter-double', densityMode: 'comfortable' }}
          onPalacePractice={onPalacePractice}
          onSegmentPractice={vi.fn()}
          onMiniPalacePractice={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    const sharedPracticeButton = screen.getByRole('button', { name: '练习' })
    expect(sharedPracticeButton.className).toContain('bg-success')
    expect(screen.getByRole('button', { name: '做题' }).className).not.toContain('bg-success')

    fireEvent.click(sharedPracticeButton)
    expect(onPalacePractice).toHaveBeenCalledTimes(1)
  })

  it('shows active review progress for a resumed single-segment review', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T11:00:00+08:00'))

    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            mini_palaces: [],
            segments: [buildSegment({ active_review_progress: 0.4 })],
          })}
          viewSettings={{ layoutMode: 'chapter-double', densityMode: 'comfortable' }}
          onPalacePractice={vi.fn()}
          onSegmentPractice={vi.fn()}
          onMiniPalacePractice={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('progressbar', { name: '复习进度 40%' })).toBeTruthy()
    expect(screen.getByTestId('review-action-progress-fill').style.width).toBe('40%')
    vi.useRealTimers()
  })

  it('always shows stage nodes for a single-segment palace without rendering the default segment card', () => {
    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            mini_palaces: [],
            segments: [
              buildSegment({
                id: 0,
                display_name: '第 1 部分',
                is_virtual_default: true,
              }),
            ],
          })}
          viewSettings={{ layoutMode: 'chapter-double', densityMode: 'comfortable' }}
          onPalacePractice={vi.fn()}
          onSegmentPractice={vi.fn()}
          onMiniPalacePractice={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('stage-track')).toBeTruthy()
    expect(screen.getByTestId('stage-node-0')).toBeTruthy()
    expect(screen.getByText('22 个知识点')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '展开详情' })).toBeNull()
    expect(screen.queryByText('第 1 部分')).toBeNull()
  })

  it('keeps multi-segment details expandable while showing stage nodes before expansion', () => {
    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            mini_palaces: [],
            segments: [
              buildSegment({ id: 101, display_name: '17—18世纪' }),
              buildSegment({ id: 102, display_name: '19世纪', sort_order: 1 }),
            ],
          })}
          viewSettings={{ layoutMode: 'chapter-double', densityMode: 'comfortable' }}
          onPalacePractice={vi.fn()}
          onSegmentPractice={vi.fn()}
          onMiniPalacePractice={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByTestId('stage-track')).toBeTruthy()
    expect(screen.queryByText('17—18世纪')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开详情' }))

    expect(screen.getByText('17—18世纪')).toBeTruthy()
    expect(screen.getByText('19世纪')).toBeTruthy()
  })

  it('passes virtual default review segments through with their schedule progress', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-13T11:00:00+08:00'))
    const onSegmentPractice = vi.fn()

    render(
      <MemoryRouter>
        <PalaceListCard
          palace={buildPalace({
            mini_palaces: [],
            segments: [
              buildSegment({
                id: 0,
                is_virtual_default: true,
                current_review_schedule_id: 1001,
                active_review_progress: 0.4,
              }),
            ],
          })}
          viewSettings={{ layoutMode: 'chapter-double', densityMode: 'comfortable' }}
          onPalacePractice={vi.fn()}
          onSegmentPractice={onSegmentPractice}
          onMiniPalacePractice={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /开始复习/ }))
    expect(screen.getByRole('progressbar', { name: '复习进度 40%' })).toBeTruthy()
    expect(screen.getByTestId('review-action-progress-fill').style.width).toBe('40%')
    expect(onSegmentPractice).toHaveBeenCalledWith(
      expect.objectContaining({
        is_virtual_default: true,
        current_review_schedule_id: 1001,
      }),
    )
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
          viewSettings={{ layoutMode: 'chapter-double', densityMode: 'comfortable' }}
          searchQuery="A.B"
          defaultExpanded
          onPalacePractice={vi.fn()}
          onSegmentPractice={vi.fn()}
          onMiniPalacePractice={vi.fn()}
          onDelete={vi.fn()}
        />
      </MemoryRouter>,
    )

    const highlights = screen.getAllByText('A.B')
    expect(highlights).toHaveLength(2)
    highlights.forEach((highlight) => expect(highlight.tagName).toBe('MARK'))
  })
})
