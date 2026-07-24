import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  nodes: [
    {
      node_uid: 'n-a',
      text: '卡片甲',
      stability_days: 7,
      retrievability: 0.9,
      due_at: '2026-07-30T00:00:00Z',
      due: false,
      reinforcement_due: false,
      schedule_source: 'manual',
      evidence_source: 'direct',
      progress_label: '一般',
    },
    {
      node_uid: 'n-b',
      text: '卡片乙',
      stability_days: 1,
      retrievability: 0.4,
      due_at: '2026-07-23T00:00:00Z',
      due: true,
      reinforcement_due: false,
      schedule_source: 'manual',
      evidence_source: 'direct',
      progress_label: '偏弱',
    },
    {
      node_uid: 'n-c',
      text: '卡片丙',
      stability_days: null,
      retrievability: 0,
      due_at: null,
      due: true,
      reinforcement_due: false,
      schedule_source: 'uninitialized',
      evidence_source: 'none',
      progress_label: '未初始化',
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

  it('loads diagnose summary and per-card progress when opened', async () => {
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
    expect(await screen.findByText('各卡片进度')).toBeTruthy()
    expect(screen.getByText('卡片甲')).toBeTruthy()
    expect(screen.getByText('卡片乙')).toBeTruthy()
    expect(screen.getByText('卡片丙')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '设模板' }).length).toBe(3)
  })

  it('disables branch scope without map selection', async () => {
    render(
      <PalaceCalibrationDrawer
        open
        onOpenChange={vi.fn()}
        palaceId={12}
      />,
    )
    await waitFor(() => expect(diagnoseMock).toHaveBeenCalled())

    expect(document.getElementById('cal-scope-branch')).toHaveProperty('disabled', true)
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

  it('matches selected cards to a template card progress', async () => {
    render(
      <PalaceCalibrationDrawer
        open
        onOpenChange={vi.fn()}
        palaceId={12}
      />,
    )
    await waitFor(() => expect(screen.findByText('卡片甲')).resolves.toBeTruthy())

    // Set 卡片甲 as template
    const rowA = screen.getByText('卡片甲').closest('li')!
    fireEvent.click(within(rowA).getByRole('button', { name: '设模板' }))
    expect(within(rowA).getByRole('button', { name: '模板' })).toBeTruthy()

    // Switch to match mode (set template already switches mode)
    fireEvent.click(document.getElementById('cal-mode-match')!)

    // Scope to checked cards: check 卡片乙
    const rowB = screen.getByText('卡片乙').closest('li')!
    fireEvent.click(within(rowB).getByRole('checkbox'))
    fireEvent.click(document.getElementById('cal-scope-nodes')!)

    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    await waitFor(() => expect(applyMock).toHaveBeenCalled())
    expect(applyMock.mock.calls[0]?.[1]).toMatchObject({
      mode: 'match_node',
      scope_kind: 'nodes',
      source_node_uid: 'n-a',
      scope: {
        source_node_uid: 'n-a',
        node_uids: ['n-b'],
      },
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
