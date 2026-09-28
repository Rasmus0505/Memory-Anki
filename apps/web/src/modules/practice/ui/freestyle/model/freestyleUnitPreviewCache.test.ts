import { describe, expect, it, vi } from 'vitest'
import type { FreestyleReviewUnitCard, FreestyleCard } from '@/shared/api/contracts'
import type { UnitReviewSessionDto } from '@/modules/practice/public'

const apiMocks = vi.hoisted(() => ({
  getUnitReviewPreviewApi: vi.fn(),
}))

vi.mock('@/modules/practice/public', () => ({
  getUnitReviewPreviewApi: apiMocks.getUnitReviewPreviewApi,
}))

import { prefetchRoundPreviews } from './freestyleUnitPreviewCache'

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
})