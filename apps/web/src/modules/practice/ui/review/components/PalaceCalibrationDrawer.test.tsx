import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PalaceCalibrationDrawer } from './PalaceCalibrationDrawer'

const diagnoseMock = vi.fn()
const previewMock = vi.fn()
const applyMock = vi.fn()
const undoMock = vi.fn()

vi.mock('@/modules/practice/ui/review/api', () => ({
  diagnosePalaceCalibrationApi: (...args: unknown[]) => diagnoseMock(...args),
  previewPalaceCalibrationApi: (...args: unknown[]) => previewMock(...args),
  applyPalaceCalibrationApi: (...args: unknown[]) => applyMock(...args),
  undoPalaceCalibrationApi: (...args: unknown[]) => undoMock(...args),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
  },
}))

const diagnoseItem = {
  palace_id: 12,
  palace_revision: 'rev-1',
  wave_count: 1,
  formal_wave_dates: ['2026-07-23'],
  date_spread_days: 0,
  due_node_count: 3,
  overdue_node_count: 1,
  reinforcement_due_count: 0,
  uninitialized_node_count: 2,
  content_changed_node_count: 0,
  direct_evidence_count: 1,
  inherited_evidence_count: 0,
  waves: [
    {
      id: 'wave-1',
      palace_id: 12,
      wave_type: 'formal_long_term',
      status: 'active',
      local_date: '2026-07-23',
      item_count: 3,
      rated_count: 0,
    },
  ],
}

describe('PalaceCalibrationDrawer', () => {
  beforeEach(() => {
    diagnoseMock.mockReset()
    previewMock.mockReset()
    applyMock.mockReset()
    undoMock.mockReset()
    diagnoseMock.mockResolvedValue({ item: diagnoseItem })
    previewMock.mockResolvedValue({
      item: {
        operation_id: 'preview-op',
        preview: true,
        affected_node_count: 5,
        baseline_tier: 'fair',
        palace_revision: 'rev-1',
      },
    })
    applyMock.mockResolvedValue({
      item: {
        operation_id: 'apply-op',
        preview: false,
        affected_node_count: 5,
        baseline_tier: 'fair',
        palace_revision: 'rev-1',
      },
    })
    undoMock.mockResolvedValue({
      item: { operation_id: 'apply-op', undone: true, affected_node_count: 5 },
    })
  })

  it('loads diagnose summary when opened', async () => {
    render(
      <PalaceCalibrationDrawer
        open
        onOpenChange={vi.fn()}
        palaceId={12}
      />,
    )

    expect(screen.getByText('宫殿进度校准')).toBeTruthy()
    await waitFor(() => expect(diagnoseMock).toHaveBeenCalledWith(12))
    expect(await screen.findByText('3')).toBeTruthy()
    expect(screen.getByText(/进行中或已暂停的正式波次/)).toBeTruthy()
  })

  it('disables branch/node scopes without selection', async () => {
    render(
      <PalaceCalibrationDrawer
        open
        onOpenChange={vi.fn()}
        palaceId={12}
      />,
    )
    await waitFor(() => expect(diagnoseMock).toHaveBeenCalled())

    expect(document.getElementById('cal-scope-branch')).toHaveProperty('disabled', true)
    expect(document.getElementById('cal-scope-nodes')).toHaveProperty('disabled', true)
  })

  it('previews then applies baseline calibration for the whole palace', async () => {
    const onApplied = vi.fn()
    render(
      <PalaceCalibrationDrawer
        open
        onOpenChange={vi.fn()}
        palaceId={12}
        onApplied={onApplied}
      />,
    )
    await waitFor(() => expect(diagnoseMock).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    await waitFor(() => expect(previewMock).toHaveBeenCalled())
    expect(previewMock.mock.calls[0]?.[1]).toMatchObject({
      mode: 'baseline',
      scope_kind: 'palace',
      baseline_tier: 'fair',
      palace_revision: 'rev-1',
    })
    expect(await screen.findByText(/预览将影响/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '确认应用' }))
    await waitFor(() => expect(applyMock).toHaveBeenCalled())
    expect(applyMock.mock.calls[0]?.[1]).toMatchObject({
      mode: 'baseline',
      scope_kind: 'palace',
      baseline_tier: 'fair',
    })
    expect(onApplied).toHaveBeenCalledTimes(1)
  })

  it('applies branch scope when a node is selected', async () => {
    render(
      <PalaceCalibrationDrawer
        open
        onOpenChange={vi.fn()}
        palaceId={12}
        selectedNodeUid="branch-a"
      />,
    )
    await waitFor(() => expect(diagnoseMock).toHaveBeenCalled())

    fireEvent.click(document.getElementById('cal-scope-branch')!)
    fireEvent.click(document.getElementById('cal-tier-weak')!)
    fireEvent.click(screen.getByRole('button', { name: '应用' }))

    await waitFor(() => expect(applyMock).toHaveBeenCalled())
    expect(applyMock.mock.calls[0]?.[1]).toMatchObject({
      mode: 'baseline',
      scope_kind: 'branch',
      baseline_tier: 'weak',
      scope: { branch_uid: 'branch-a' },
    })
  })

  it('undoes the last applied operation', async () => {
    render(
      <PalaceCalibrationDrawer
        open
        onOpenChange={vi.fn()}
        palaceId={12}
      />,
    )
    await waitFor(() => expect(diagnoseMock).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => expect(applyMock).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: '撤销本次' }))
    await waitFor(() => expect(undoMock).toHaveBeenCalledWith(12, 'apply-op'))
  })
})
