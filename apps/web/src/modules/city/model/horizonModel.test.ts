import { describe, expect, it } from 'vitest'
import {
  MAX_WINDOWS,
  focusPalaceIdFromPath,
  palaceOfUnit,
  planHouse,
  planIsland,
  type CityTodayPalace,
} from './horizonModel'

const palace = (overrides: Partial<CityTodayPalace> = {}): CityTodayPalace => ({
  id: 7,
  title: 'P',
  subject: { id: 1, name: '教育学', color: '#d9634c' },
  unit_count: 8,
  rating_count: 3,
  units: [
    { id: 'a', rating: 3 },
    { id: 'b', rating: 4 },
    { id: 'c', rating: 1 },
  ],
  ...overrides,
})

describe('focusPalaceIdFromPath', () => {
  it('reads the palace from view, edit and review routes', () => {
    expect(focusPalaceIdFromPath('/palaces/12')).toBe(12)
    expect(focusPalaceIdFromPath('/palaces/12/edit')).toBe(12)
    expect(focusPalaceIdFromPath('/palaces/12/review')).toBe(12)
    expect(focusPalaceIdFromPath('/freestyle')).toBeNull()
    expect(focusPalaceIdFromPath('/palaces/12/quiz')).toBeNull()
  })
})

describe('planHouse', () => {
  it('gives one window per card, lit bottom-up with the latest rating', () => {
    const plan = planHouse(palace())
    expect(plan.lights).toEqual([3, 4, 1, 0, 0, 0, 0, 0])
    expect(plan.repair).toBe(true)
    expect(plan.gold).toBe(false)
    expect(plan.roofColor).toBe('#d9634c')
  })

  it('caps the window count so a large palace stays inside the strip', () => {
    const units = Array.from({ length: 50 }, (_, i) => ({ id: `u${i}`, rating: 3 }))
    const plan = planHouse(palace({ unit_count: 200, units }))
    expect(plan.lights).toHaveLength(MAX_WINDOWS)
    expect(plan.lights.filter(Boolean)).toHaveLength(6)
  })

  it('turns the roof gold once every card of the palace was rated today', () => {
    const units = Array.from({ length: 4 }, (_, i) => ({ id: `u${i}`, rating: 2 }))
    const plan = planHouse(palace({ unit_count: 4, units }))
    expect(plan.gold).toBe(true)
    expect(plan.repair).toBe(false)
  })

  it('gives subjects still on the default color a roof color of their own', () => {
    const a = planHouse(palace({ subject: { id: 4, name: 'A', color: '#6366F1' } }))
    const b = planHouse(palace({ subject: { id: 5, name: 'B', color: '#6366f1' } }))
    expect(a.roofColor).not.toBe('#6366F1')
    expect(a.roofColor).not.toBe(b.roofColor)
    expect(planHouse(palace({ subject: null })).roofColor).toBeNull()
  })
})

describe('planIsland', () => {
  it('adds a bare foundation for the palace in focus', () => {
    const plans = planIsland({ day: '2026-11-05', palaces: [palace()] }, 9)
    expect(plans.map((plan) => plan.id)).toEqual([7, 9])
    expect(plans[1].lights).toEqual([0, 0, 0, 0])
  })

  it('finds the palace of a rated unit for live feedback', () => {
    const today = { day: '2026-11-05', palaces: [palace()] }
    expect(palaceOfUnit(today, 'b')).toBe(7)
    expect(palaceOfUnit(today, 'zz')).toBeUndefined()
  })
})
