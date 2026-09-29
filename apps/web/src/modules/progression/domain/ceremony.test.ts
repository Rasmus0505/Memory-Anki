import { describe, expect, it } from 'vitest'
import type { ProgressionOverview, ProgressionStamp } from '@/shared/api/contracts'
import { MAX_STAMP_CEREMONIES, planCeremony, questToastKey } from './ceremony'
import { DEFAULT_GROWTH_STATE, sanitizeGrowthState } from './growthState'
import { BOOKMARKS, MATERIALS, SKINS, isUnlocked, newlyUnlocked, resolvePick } from './cosmetics'

function stamp(id: string, unlocked: boolean): ProgressionStamp {
  return { id, title: id, description: '', group: 'g', tier: 'paper', progress: 1, target: 1, unlocked_on: unlocked ? '2026-10-05' : null }
}

function overview(patch: Partial<ProgressionOverview> = {}): ProgressionOverview {
  return {
    today: '2026-10-05',
    level: { level: 4, xp: 1200, level_floor: 1100, next_level_xp: 2000, progress: 0.11 },
    xp: { today: 80, week: 300, sources: { rating: 1000, conquer: 100, first_learn: 50, quiz: 20, time: 30, quest: 0 } },
    quests: [{ key: 'rate_20', title: '评 20 张卡', hint: '', scope: 'daily', progress: 20, target: 20, done: true, xp: 30 }],
    stamps: [stamp('ratings_100', true), stamp('days_7', false)],
    stats: {},
    starmap: { subjects: [], chapters: [], palaces: [] },
    ...patch,
  }
}

describe('planCeremony', () => {
  it('baselines silently on the very first load', () => {
    const plan = planCeremony(DEFAULT_GROWTH_STATE, overview(), 'settle')
    expect(plan.baseline).toBe(true)
    expect(plan.stamps).toEqual([])
    expect(plan.next.seenLevel).toBe(4)
    expect(plan.next.celebrated).toEqual(['ratings_100'])
    expect(plan.next.toasted).toContain(questToastKey(overview(), overview().quests[0]))
  })

  it('settles XP gain, a level-up and new stamps exactly once', () => {
    const seen = { ...DEFAULT_GROWTH_STATE, seenLevel: 3, seenXp: 900, celebrated: [] }
    const plan = planCeremony(seen, overview(), 'settle')
    expect(plan).toMatchObject({ baseline: false, xpFrom: 900, xpTo: 1200, levelFrom: 3, levelTo: 4 })
    expect(plan.stamps.map((s) => s.id)).toEqual(['ratings_100'])
    const again = planCeremony(plan.next, overview(), 'settle')
    expect(again.stamps).toEqual([])
    expect(again.xpTo - again.xpFrom).toBe(0)
  })

  it('caps the round-end show but still marks every stamp seen', () => {
    const many = Array.from({ length: 6 }, (_, i) => stamp(`s${i}`, true))
    const plan = planCeremony({ ...DEFAULT_GROWTH_STATE, seenLevel: 4, seenXp: 1200 }, overview({ stamps: many }), 'settle')
    expect(plan.stamps).toHaveLength(MAX_STAMP_CEREMONIES)
    expect(plan.next.celebrated).toHaveLength(6)
  })

  it('live mode only toasts, never moves level or XP', () => {
    const seen = { ...DEFAULT_GROWTH_STATE, seenLevel: 3, seenXp: 900 }
    const plan = planCeremony(seen, overview(), 'live')
    expect(plan.levelTo).toBe(3)
    expect(plan.xpTo).toBe(900)
    expect(plan.stamps.map((s) => s.id)).toEqual(['ratings_100'])
    expect(plan.next.seenLevel).toBe(3)
    expect(planCeremony(plan.next, overview(), 'live').stamps).toEqual([])
  })

  it('never shows XP going backwards after an undo elsewhere', () => {
    const plan = planCeremony({ ...DEFAULT_GROWTH_STATE, seenLevel: 5, seenXp: 5000 }, overview(), 'settle')
    expect(plan.xpFrom).toBeLessThanOrEqual(plan.xpTo)
    expect(plan.levelFrom).toBeLessThanOrEqual(plan.levelTo)
  })
})

describe('growth state + cosmetics', () => {
  it('sanitizes junk into defaults', () => {
    expect(sanitizeGrowthState(null)).toEqual(DEFAULT_GROWTH_STATE)
    expect(sanitizeGrowthState({ skin: 3, celebrated: ['a', 1] })).toMatchObject({ skin: 'ink', celebrated: ['a'] })
  })

  it('first item of every shelf is always unlocked', () => {
    const none = { level: 1, stamps: new Set<string>() }
    for (const shelf of [SKINS, MATERIALS, BOOKMARKS]) expect(isUnlocked(shelf[0].unlock, none)).toBe(true)
  })

  it('falls back when a saved pick is locked', () => {
    expect(resolvePick(SKINS, 'galaxy', { level: 3, stamps: new Set() })).toBe('ink')
    expect(resolvePick(SKINS, 'galaxy', { level: 12, stamps: new Set() })).toBe('galaxy')
    expect(resolvePick(BOOKMARKS, 'bamboo', { level: 1, stamps: new Set(['perfect_1']) })).toBe('bamboo')
  })

  it('reports what a level-up just unlocked', () => {
    const ids = newlyUnlocked({ level: 4, stamps: new Set() }, { level: 5, stamps: new Set() }).map((item) => item.id)
    expect(ids).toEqual(['foil'])
  })
})
