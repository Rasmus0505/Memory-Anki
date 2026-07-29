import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PalaceReviewUnitsPanel } from './PalaceReviewUnitsPanel'

const apiMocks = vi.hoisted(() => ({
  getPalaceReviewUnitsApi: vi.fn(),
  adjustUnitScheduleApi: vi.fn(),
  reconcilePalaceUnitsApi: vi.fn(),
  undoContentScheduleBatchApi: vi.fn(),
}))

vi.mock('../api', () => ({
  getPalaceReviewUnitsApi: (...args: unknown[]) => apiMocks.getPalaceReviewUnitsApi(...args),
  adjustUnitScheduleApi: (...args: unknown[]) => apiMocks.adjustUnitScheduleApi(...args),
  reconcilePalaceUnitsApi: (...args: unknown[]) => apiMocks.reconcilePalaceUnitsApi(...args),
  undoContentScheduleBatchApi: (...args: unknown[]) => apiMocks.undoContentScheduleBatchApi(...args),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: {
    message: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/shared/components/ui/native-dialog', () => ({
  appConfirm: vi.fn(async () => true),
}))

const sampleUnit = {
  id: 'unit-1',
  palace_id: 42,
  anchor_uid: 'anchor-1',
  unit_kind: 'permanent_mark',
  title: '核心概念单元',
  node_uids: ['n1', 'n2'],
  revision: 1,
  stage_index: 3,
  interval_days: 7,
  has_passed: false,
  due_date: '2026-08-01',
  due: true,
  active: true,
}

describe('PalaceReviewUnitsPanel', () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset())
    apiMocks.getPalaceReviewUnitsApi.mockResolvedValue({
      palace_id: 42,
      title: '测试宫殿',
      mark_required: false,
      unit_count: 1,
      due_unit_count: 1,
      next_review_date: '2026-08-01',
      review_status: 'due',
      units: [sampleUnit],
    })
    apiMocks.adjustUnitScheduleApi.mockResolvedValue({
      operation_id: 'op-1',
      reason: 'manual_adjust',
      unit: { ...sampleUnit, stage_index: 4, interval_days: 14, due_date: '2026-08-10' },
      before: {
        stage_index: 3,
        interval_days: 7,
        due_date: '2026-08-01',
        has_passed: false,
      },
      after: {
        stage_index: 4,
        interval_days: 14,
        due_date: '2026-08-10',
        has_passed: false,
      },
      invalidated_session_count: 0,
      palace: {
        palace_id: 42,
        title: '测试宫殿',
        unit_count: 1,
        due_unit_count: 0,
        next_review_date: '2026-08-10',
        review_status: 'scheduled',
        mark_required: false,
      },
    })
  })

  it('loads and shows unit title when open', async () => {
    render(
      <PalaceReviewUnitsPanel
        open
        palaceId={42}
        onClose={vi.fn()}
      />,
    )

    expect(await screen.findByText('核心概念单元')).toBeTruthy()
    expect(screen.getByText('7天级')).toBeTruthy()
    expect(screen.getByText('到期')).toBeTruthy()
    expect(apiMocks.getPalaceReviewUnitsApi).toHaveBeenCalledWith(42)
  })

  it('expands a unit and saves schedule adjust', async () => {
    const onScheduleChanged = vi.fn()
    render(
      <PalaceReviewUnitsPanel
        open
        palaceId={42}
        onClose={vi.fn()}
        onScheduleChanged={onScheduleChanged}
      />,
    )

    await screen.findByText('核心概念单元')
    fireEvent.click(screen.getByText('核心概念单元'))
    const stageSelect = await screen.findByDisplayValue('3 · 7天级')
    fireEvent.change(stageSelect, { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: '保存进度' }))

    await waitFor(() => {
      expect(apiMocks.adjustUnitScheduleApi).toHaveBeenCalled()
    })
    const [, payload] = apiMocks.adjustUnitScheduleApi.mock.calls[0] as [string, { stage_index: number; operation_id: string }]
    expect(payload.stage_index).toBe(4)
    expect(payload.operation_id).toBeTruthy()
    await waitFor(() => expect(onScheduleChanged).toHaveBeenCalled())
  })

  it('does not load when closed', () => {
    render(
      <PalaceReviewUnitsPanel
        open={false}
        palaceId={42}
        onClose={vi.fn()}
      />,
    )
    expect(apiMocks.getPalaceReviewUnitsApi).not.toHaveBeenCalled()
    expect(screen.queryByTestId('palace-review-units-panel')).toBeNull()
  })

  it('reconciles and surfaces undo control', async () => {
    apiMocks.reconcilePalaceUnitsApi.mockResolvedValue({
      palace_id: 42,
      mark_required: false,
      unit_count: 1,
      changed: true,
      invalidated_session_count: 0,
      title: '测试宫殿',
      changes: [
        {
          unit_id: 'unit-1',
          anchor_uid: 'anchor-1',
          title: '核心概念单元',
          action: 'demote',
          before: {
            stage_index: 4,
            interval_days: 14,
            due_date: '2026-08-10',
            has_passed: true,
          },
          after: {
            stage_index: 3,
            interval_days: 7,
            due_date: '2026-08-01',
            has_passed: false,
          },
        },
      ],
      undo_token: 'batch-abc',
      schedule_batch_id: 'batch-abc',
    })

    render(
      <PalaceReviewUnitsPanel
        open
        palaceId={42}
        onClose={vi.fn()}
      />,
    )
    await screen.findByText('核心概念单元')
    fireEvent.click(screen.getByRole('button', { name: '立即调和进度' }))

    await waitFor(() => {
      expect(apiMocks.reconcilePalaceUnitsApi).toHaveBeenCalledWith(42)
    })
    expect(await screen.findByRole('button', { name: '撤销这次内容对进度的影响' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '撤销这次内容对进度的影响' }))
    })
    await waitFor(() => {
      expect(apiMocks.undoContentScheduleBatchApi).toHaveBeenCalledWith(42, 'batch-abc', expect.any(String))
    })
  })
})
