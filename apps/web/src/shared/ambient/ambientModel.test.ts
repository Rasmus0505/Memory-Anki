import { describe, expect, it } from 'vitest'
import { dailyGoalSeconds, resolveAmbientTone, resolveExamPulse, resolveTint } from './ambientModel'
import { createMote, stepMote } from './dustMotes'
import { resolveLightPoint } from './pointerLight'

describe('resolveTint', () => {
  it('wraps around midnight and hits the stops exactly', () => {
    expect(resolveTint(0)).toBe(resolveTint(24))
    expect(resolveTint(15)).toBe('hsl(38 90% 70% / 0.05)')
  })

  it('interpolates between stops', () => {
    expect(resolveTint(12.5)).toBe('hsl(40 75% 80% / 0.038)')
  })
})

describe('resolveAmbientTone', () => {
  it('warms the window light with progress and clamps it', () => {
    const idle = resolveAmbientTone({ hour: 9, progress: 0, examDaysLeft: null })
    const done = resolveAmbientTone({ hour: 9, progress: 3, examDaysLeft: null })
    expect(idle.light).toBeLessThan(done.light)
    expect(done.light).toBe(0.11)
    expect(resolveAmbientTone({ hour: 9, progress: Number.NaN, examDaysLeft: null }).light).toBe(idle.light)
  })

  it('breathes faster as the exam gets closer, and not at all when far or past', () => {
    expect(resolveExamPulse(null)).toBe(0)
    expect(resolveExamPulse(30)).toBe(0)
    expect(resolveExamPulse(-1)).toBe(0)
    expect(resolveExamPulse(10)).toBeGreaterThan(resolveExamPulse(5))
    expect(resolveExamPulse(5)).toBeGreaterThan(resolveExamPulse(2))
  })

  it('derives a daily goal from the weekly goal with a sane default', () => {
    expect(dailyGoalSeconds(420)).toBe(3600)
    expect(dailyGoalSeconds(0)).toBe(dailyGoalSeconds(300))
    expect(dailyGoalSeconds(null)).toBe(dailyGoalSeconds(300))
  })
})

describe('dust motes', () => {
  const fixed = () => 0.5

  it('drifts upward and wraps back to the bottom', () => {
    const mote = createMote(100, 100, fixed)
    mote.y = -20
    stepMote(mote, 1, 0, 100, 100, null)
    expect(mote.y).toBeGreaterThan(100)
  })

  it('is pushed away from a nearby pointer but ignores a distant one', () => {
    const near = createMote(400, 400, fixed)
    near.x = 200
    near.y = 200
    near.vx = 0
    stepMote(near, 1, 0, 400, 400, { x: 180, y: 200 })
    expect(near.vx).toBeGreaterThan(0)

    const far = createMote(400, 400, fixed)
    far.x = 200
    far.vx = 0
    stepMote(far, 1, 0, 400, 400, { x: 0, y: 0 })
    expect(Math.abs(far.vx)).toBeLessThan(0.01)
  })
})

describe('resolveLightPoint', () => {
  it('maps the pointer to local px and a clamped -1..1 tilt', () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 }
    expect(resolveLightPoint(rect, 200, 100)).toEqual({ x: 100, y: 50, nx: 0, ny: 0 })
    expect(resolveLightPoint(rect, 500, -100)).toMatchObject({ nx: 1, ny: -1 })
  })
})
