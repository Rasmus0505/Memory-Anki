import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import ReviewOverview, { groupDueUnitsByPalace } from '@/app/router/review/ReviewOverview'
import type { ReviewUnitDto } from '@/modules/practice/public'

const getDueUnits = vi.fn()
vi.mock('@/modules/practice/public', async () => {
  const actual = await vi.importActual<typeof import('@/modules/practice/public')>('@/modules/practice/public')
  return { ...actual, getDueReviewUnitsApi: () => getDueUnits() }
})

function unit(id: string, palaceId: number, dueDate: string): ReviewUnitDto {
  return {
    id,
    palace_id: palaceId,
    anchor_uid: id,
    unit_kind: 'marked',
    title: `单元 ${id}`,
    node_uids: [id],
    revision: 1,
    stage_index: 0,
    interval_days: 1,
    has_passed: false,
    due_date: dueDate,
    due: true,
    session_status: 'pending',
    retry_count: 0,
    hard_count: 0,
    again_count: 0,
    final_rating: null,
    encounter: null,
  }
}

describe('ReviewOverview unit queue', () => {
  it('groups by palace and sorts by earliest due date', () => {
    const result = groupDueUnitsByPalace([
      unit('b', 2, '2026-07-27'),
      unit('a', 1, '2026-07-20'),
      unit('c', 1, '2026-07-25'),
    ])
    expect(result.map((item) => item.palaceId)).toEqual([1, 2])
    expect(result[0].units.map((item) => item.id)).toEqual(['a', 'c'])
  })

  it('shows only permanent-mark units', async () => {
    getDueUnits.mockResolvedValueOnce([unit('a', 1, '2026-07-27')])
    render(<MemoryRouter><ReviewOverview /></MemoryRouter>)
    expect(await screen.findByText('单元 a')).toBeTruthy()
    expect(screen.getByRole('button', { name: '立即复习' })).toBeTruthy()
    expect(screen.queryByText(/FSRS/)).toBeNull()
    expect(screen.queryByText(/波次/)).toBeNull()
  })
})
