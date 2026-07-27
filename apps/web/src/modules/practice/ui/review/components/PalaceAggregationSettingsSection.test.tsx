import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PalaceAggregationSettingsSection } from './PalaceAggregationSettingsSection'

const getSettingsMock = vi.fn()
const updateSettingsMock = vi.fn()
const previewMock = vi.fn()
const applyMock = vi.fn()
const clearMock = vi.fn()

vi.mock('@/modules/practice/ui/review/api/scheduleInsightApi', () => ({
  getPalaceReviewScheduleSettingsApi: (...args: unknown[]) => getSettingsMock(...args),
  updatePalaceReviewScheduleSettingsApi: (...args: unknown[]) => updateSettingsMock(...args),
  previewPalaceAggregationApi: (...args: unknown[]) => previewMock(...args),
  applyPalaceAggregationApi: (...args: unknown[]) => applyMock(...args),
  clearPalaceAggregationApi: (...args: unknown[]) => clearMock(...args),
}))

vi.mock('@/shared/feedback/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}))

function settingsItem(enabled: boolean) {
  return {
    item: {
      palace_id: 5,
      aggregation_enabled: enabled,
      aggregation_max_pull_days: 3,
      aggregation_max_push_days: 1,
      daily_new_limit_override: null,
    },
  }
}

describe('PalaceAggregationSettingsSection', () => {
  beforeEach(() => {
    getSettingsMock.mockReset()
    updateSettingsMock.mockReset()
    previewMock.mockReset()
    applyMock.mockReset()
    clearMock.mockReset()
  })

  it('toggles aggregation via PUT settings', async () => {
    getSettingsMock.mockResolvedValue(settingsItem(false))
    updateSettingsMock.mockResolvedValue(settingsItem(true))
    render(<PalaceAggregationSettingsSection palaceId={5} />)

    const toggle = await screen.findByRole('switch', { name: '聚合复习日开关' })
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(updateSettingsMock).toHaveBeenCalledWith(5, { aggregation_enabled: true })
    })
    expect(await screen.findByRole('button', { name: '预览聚合' })).toBeTruthy()
  })

  it('previews moves with source and target dates plus retention loss', async () => {
    getSettingsMock.mockResolvedValue(settingsItem(true))
    previewMock.mockResolvedValue({
      item: {
        palace_id: 5,
        horizon_days: 30,
        moves: [
          {
            node_uid: 'node-1',
            raw_due_local: '2026-08-02',
            target_local: '2026-08-05',
            retention_drop_pp: 1.6,
          },
        ],
      },
    })
    render(<PalaceAggregationSettingsSection palaceId={5} />)

    fireEvent.click(await screen.findByRole('button', { name: '预览聚合' }))
    expect((await screen.findAllByText(/原定 8\/2 → 聚合到 8\/5/)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/保持率损失 1\.6 pp/).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '应用' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '清除聚合' })).toBeTruthy()
  })
})
