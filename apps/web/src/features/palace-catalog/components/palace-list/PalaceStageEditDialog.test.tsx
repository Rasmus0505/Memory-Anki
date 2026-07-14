import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PalaceStageEditDialog } from './PalaceStageEditDialog'
import type {
  PalaceGroupedItem,
  ReviewStageAdjustmentResponse,
  ReviewStageSummary,
} from '@/shared/api/contracts'

const palace = {
  id: 7,
  title: '第四节 收回教育权运动与教会教育的变革',
  resolved_title: '第四节 收回教育权运动与教会教育的变革',
  review_stage_completed: 4,
  needs_practice: false,
} as PalaceGroupedItem

const stage: ReviewStageSummary = {
  review_number: 6,
  label: '15天',
  completed: false,
  completed_at: null,
  scheduled_at: '2026-07-20T10:00:00',
}

function buildPreview(
  overrides: Partial<ReviewStageAdjustmentResponse> = {},
): ReviewStageAdjustmentResponse {
  return {
    ok: true,
    palace_id: palace.id,
    palace_title: palace.title,
    previous_completed_count: 4,
    target_completed_count: 7,
    total_stage_count: 9,
    direction: 'forward',
    current_stage_label: '4天',
    target_stage_label: '15天',
    preserved_stage_labels: ['1小时', '睡前', '1天', '4天'],
    added_stage_labels: ['7天', '15天'],
    removed_stage_labels: [],
    next_stage_label: '30天',
    next_review_at: '2026-08-13T10:00:00',
    mastered: false,
    needs_practice: false,
    ...overrides,
  }
}

function renderDialog(preview = buildPreview()) {
  const handlers = {
    onCompletedAtChange: vi.fn(),
    onNeedsPracticeChange: vi.fn(),
    onNoteChange: vi.fn(),
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    onReset: vi.fn(),
  }
  render(
    <PalaceStageEditDialog
      stageEdit={{ palace, stage, targetCompletedCount: 7 }}
      completedAt="2026-07-14T14:30"
      needsPractice={false}
      note="补录线下复习"
      preview={preview}
      previewLoading={false}
      error={null}
      saving={false}
      {...handlers}
    />,
  )
  return handlers
}

describe('PalaceStageEditDialog', () => {
  it('shows the target, schedule impact, and selectable correction fields', () => {
    const handlers = renderDialog()

    expect(screen.getByText(palace.title)).toBeTruthy()
    expect(screen.getByText(/新增完成：7天、15天/)).toBeTruthy()
    expect(screen.getByText(/下次复习：30天/)).toBeTruthy()
    fireEvent.click(screen.getByRole('switch', { name: '仍需练习' }))
    fireEvent.click(screen.getByRole('button', { name: '调整到“15天”' }))
    expect(handlers.onNeedsPracticeChange).toHaveBeenCalledWith(true)
    expect(handlers.onConfirm).toHaveBeenCalledOnce()
  })

  it('uses a destructive confirmation for rollback and exposes reset separately', () => {
    const handlers = renderDialog(buildPreview({
      direction: 'backward',
      target_completed_count: 2,
      target_stage_label: '睡前',
      removed_stage_labels: ['1天', '4天'],
    }))

    const confirm = screen.getByRole('button', { name: '调整到“15天”' })
    expect(confirm.className).toContain('bg-destructive')
    fireEvent.click(screen.getByRole('button', { name: '重置为未开始' }))
    expect(handlers.onReset).toHaveBeenCalledOnce()
  })
})
