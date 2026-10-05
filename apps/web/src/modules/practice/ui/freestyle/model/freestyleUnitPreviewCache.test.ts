import { beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import type { FreestyleReviewUnitCard, FreestyleCard } from '@/shared/api/contracts'
import type { UnitReviewSessionDto } from '@/modules/practice/public'

const apiMocks = vi.hoisted(() => ({
  getUnitReviewPreviewApi: vi.fn(),
}))

vi.mock('@/modules/practice/public', () => ({
  getUnitReviewPreviewApi: apiMocks.getUnitReviewPreviewApi,
}))

import {
  prefetchRoundPreviews,
  prefetchUnitPreview,
  requestRoundPreview,
  sharedPalacePreviewForCard,
} from './freestyleUnitPreviewCache'

function unitCard(id: string, unitId: string, revision: number): FreestyleReviewUnitCard {
  return {
    id,
    type: 'mindmap_branch',
    content_type: 'mindmap_branch',
    palace_id: 1,
    palace_title: '测试宫殿',
    anchor_uid: `${unitId}:anchor`,
    context_path: [],
    node_uids: [`${unitId}:anchor`],
    node_count: 1,
    unit_id: unitId,
    unit_revision: revision,
  }
}

function preview(unitId: string, revision: number): UnitReviewSessionDto {
  return {
    id: `preview:${unitId}`,
    palace_id: 1,
    title: '测试宫殿',
    status: 'preview',
    palace: {
      id: 1,
      title: '测试宫殿',
      editor_doc: {
        root: {
          data: { uid: 'root', text: '宫殿' },
          children: [{ data: { uid: `${unitId}:anchor`, text: unitId }, children: [] }],
        },
      },
    },
    units: [{
      id: unitId,
      palace_id: 1,
      anchor_uid: `${unitId}:anchor`,
      unit_kind: 'marked',
      title: unitId,
      node_uids: [`${unitId}:anchor`],
      revision,
      stage_index: 0,
      interval_days: 0,
      has_passed: false,
      due_date: '2026-09-28',
      due: true,
      session_status: 'pending',
      retry_count: 0,
      hard_count: 0,
      again_count: 0,
      final_rating: null,
      encounter: null,
    }],
    pending_unit_count: 1,
    completed_unit_count: 0,
  }
}

describe('freestyleUnitPreviewCache', () => {
  beforeEach(() => {
    apiMocks.getUnitReviewPreviewApi.mockReset()
  })

  it('prefetches only the current and nearest distinct unit previews', async () => {
    const prefix = `near-${Date.now()}`
    const units = ['a', 'b', 'c', 'd', 'e'].map((suffix) => `${prefix}:${suffix}`)
    const cards: FreestyleCard[] = units.map((unitId, index) => unitCard(`${unitId}:card`, unitId, index + 1))
    apiMocks.getUnitReviewPreviewApi.mockImplementation(async (unitId: string) => {
      const index = units.indexOf(unitId)
      return preview(unitId, index + 1)
    })

    await prefetchRoundPreviews(cards, 2, { concurrency: 1 })

    expect(apiMocks.getUnitReviewPreviewApi.mock.calls.map(([unitId]) => unitId)).toEqual([
      units[2],
      units[1],
      units[3],
    ])
  })

  it('prefetches the forward neighbor before the one behind', async () => {
    const prefix = `dir-${Date.now()}`
    const units = ['a', 'b', 'c', 'd', 'e'].map((suffix) => `${prefix}:${suffix}`)
    const cards: FreestyleCard[] = units.map((unitId, index) => unitCard(`${unitId}:card`, unitId, index + 1))
    apiMocks.getUnitReviewPreviewApi.mockImplementation(async (unitId: string) => {
      const index = units.indexOf(unitId)
      return preview(unitId, index + 1)
    })

    await prefetchRoundPreviews(cards, 2, { concurrency: 1, direction: 1 })

    expect(apiMocks.getUnitReviewPreviewApi.mock.calls.map(([unitId]) => unitId)).toEqual([
      units[2],
      units[3],
      units[1],
    ])
  })

  it('paints another unit from the palace document already fetched', async () => {
    const prefix = `share-${Date.now()}`
    const first = `${prefix}:a`
    const second = `${prefix}:b`
    const painted = preview(first, 1)
    apiMocks.getUnitReviewPreviewApi.mockResolvedValue(painted)

    await prefetchUnitPreview(first, 1)

    const shared = sharedPalacePreviewForCard(unitCard(`${second}:card`, second, 2))
    expect(shared?.palace?.editor_doc).toEqual(painted.palace?.editor_doc)
    expect(shared?.units[0]?.id).toBe(second)
    expect(shared?.units[0]?.node_uids).toEqual([`${second}:anchor`])
    expect(sharedPalacePreviewForCard(unitCard(`${first}:card`, first, 1))).toBeNull()
  })

  it('follows the latest index instead of draining cards already passed', async () => {
    const prefix = `pump-${Date.now()}`
    const units = ['a', 'b', 'c', 'd', 'e'].map((suffix) => `${prefix}:${suffix}`)
    const cards: FreestyleCard[] = units.map((unitId, index) => unitCard(`${unitId}:card`, unitId, index + 1))
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    apiMocks.getUnitReviewPreviewApi.mockImplementation(async (unitId: string) => {
      if (unitId === units[0]) await gate
      const index = units.indexOf(unitId)
      return preview(unitId, index + 1)
    })

    requestRoundPreview(cards, 0, 1)
    await waitFor(() => expect(apiMocks.getUnitReviewPreviewApi).toHaveBeenCalledWith(units[0]))
    requestRoundPreview(cards, 4, 1)
    release()
    await waitFor(() => expect(apiMocks.getUnitReviewPreviewApi).toHaveBeenCalledWith(units[4]))
    const called = apiMocks.getUnitReviewPreviewApi.mock.calls.map(([unitId]) => unitId)
    expect(called.indexOf(units[4])).toBeLessThanOrEqual(1)
  })
})