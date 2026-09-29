import { describe, expect, it } from 'vitest'
import type { ProgressionStarmap, StarmapPalace } from '@/shared/api/contracts'
import { brightnessFor, hitStar, layoutSky } from './starmapLayout'

function palace(id: number, chapter: number | null, patch: Partial<StarmapPalace> = {}): StarmapPalace {
  return { id, title: `宫殿${id}`, subject_id: 1, chapter_id: chapter, stars: 1, unit_count: 4, learned_count: 2, mastery_ratio: 0.5, recall: 0.6, due_count: 0, ...patch }
}

const MAP: ProgressionStarmap = {
  subjects: [{ id: 1, name: '数学', color: '' }, { id: 2, name: '政治', color: '' }],
  chapters: [
    { id: 10, subject_id: 1, parent_id: null, name: '线代', sort_order: 0, exam_stars: 3 },
    { id: 11, subject_id: 1, parent_id: null, name: '概率', sort_order: 1, exam_stars: null },
    { id: 20, subject_id: 2, parent_id: null, name: '马原', sort_order: 0, exam_stars: null },
  ],
  palaces: [palace(1, 10, { due_count: 3 }), palace(2, 10, { mastery_ratio: 1 }), palace(3, 11), palace(4, 20, { subject_id: 2 }), palace(5, null, { subject_id: null })],
}

describe('layoutSky', () => {
  it('is deterministic for the same data', () => {
    expect(layoutSky(MAP)).toEqual(layoutSky(MAP))
  })

  it('builds subject → chapter → palace constellations, plus an unfiled cluster', () => {
    const sky = layoutSky(MAP)
    const kinds = sky.stars.reduce<Record<string, number>>((acc, star) => ({ ...acc, [star.kind]: (acc[star.kind] ?? 0) + 1 }), {})
    expect(kinds).toEqual({ subject: 3, chapter: 3, palace: 5 })
    const unfiled = sky.stars.find((star) => star.key === 'p:5')
    expect(unfiled?.parentKey).toBe('s:-1')
    expect(sky.links.every((link) => sky.stars.some((s) => s.key === link.from) && sky.stars.some((s) => s.key === link.to))).toBe(true)
  })

  it('maps mastery to brightness, stars to size and due to twinkle', () => {
    const sky = layoutSky(MAP)
    const chapter = sky.stars.find((star) => star.key === 'c:10')!
    const plain = sky.stars.find((star) => star.key === 'c:11')!
    expect(chapter.stars).toBe(3)
    expect(chapter.size).toBeGreaterThan(plain.size)
    expect(chapter.twinkle).toBe(true)
    expect(sky.stars.find((star) => star.key === 'p:2')!.brightness).toBeGreaterThan(sky.stars.find((star) => star.key === 'p:3')!.brightness)
    expect(brightnessFor(0, 0)).toBeGreaterThan(0)
  })

  it('uses warm hues only', () => {
    for (const star of layoutSky(MAP).stars) expect(star.hue < 60 || star.hue >= 290).toBe(true)
  })

  it('hit-tests the nearest star', () => {
    const sky = layoutSky(MAP)
    const target = sky.stars.find((star) => star.key === 'p:3')!
    expect(hitStar(sky, target.x + 1, target.y, 8)?.key).toBe('p:3')
    expect(hitStar(sky, 1e6, 1e6, 8)).toBeNull()
  })
})
