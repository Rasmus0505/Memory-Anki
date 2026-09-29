import { describe, expect, it, vi } from 'vitest'
import { createParticle, particleAlpha, spawnParticle, stepParticle } from './particleEngine'

const GOLD = [40, 96, 62] as const
const fixed = () => 0.5

describe('stepParticle', () => {
  it('applies gravity and drag per 60fps frame', () => {
    const p = createParticle({ x: 0, y: 0, vx: 10, gravity: 1, drag: 0.5, life: 5, size: 2, color: GOLD }, fixed)
    stepParticle(p, 1, 1 / 60)
    expect(p.vx).toBeCloseTo(5)
    expect(p.vy).toBeCloseTo(0.5)
    expect(p.x).toBeCloseTo(5)
  })

  it('holds a delayed particle in place until its delay runs out', () => {
    const p = createParticle({ x: 3, y: 4, vx: 5, delay: 0.1, life: 1, size: 2, color: GOLD }, fixed)
    stepParticle(p, 3, 0.05)
    expect(p.x).toBe(3)
    expect(p.age).toBe(0)
    stepParticle(p, 3, 0.05)
    stepParticle(p, 1, 1 / 60)
    expect(p.x).toBeGreaterThan(3)
  })

  it('ends when its life is spent', () => {
    const p = createParticle({ x: 0, y: 0, life: 0.1, size: 2, color: GOLD }, fixed)
    stepParticle(p, 6, 0.1)
    expect(p.done).toBe(true)
  })

  it('homes onto a target and reports arrival exactly once', () => {
    const onArrive = vi.fn()
    const p = createParticle({ x: 0, y: 0, vx: 0, vy: -4, life: 5, size: 2, color: GOLD, home: () => ({ x: 300, y: 120 }), onArrive }, fixed)
    for (let i = 0; i < 240 && !p.done; i += 1) stepParticle(p, 1, 1 / 60)
    expect(p.done).toBe(true)
    expect(onArrive).toHaveBeenCalledTimes(1)
    expect(p.x).toBe(300)
    stepParticle(p, 1, 1 / 60)
    expect(onArrive).toHaveBeenCalledTimes(1)
  })

  it('flies free before homeAfter so the burst reads first', () => {
    const home = vi.fn(() => ({ x: 500, y: 0 }))
    const p = createParticle({ x: 0, y: 0, vy: -3, homeAfter: 0.2, life: 5, size: 2, color: GOLD, home }, fixed)
    stepParticle(p, 6, 0.1)
    expect(home).not.toHaveBeenCalled()
    expect(p.vx).toBe(0)
  })
})

describe('particleAlpha', () => {
  it('fades out towards the end of life', () => {
    const p = createParticle({ x: 0, y: 0, life: 1, size: 2, color: GOLD }, fixed)
    expect(particleAlpha(p)).toBe(1)
    p.age = 0.9
    expect(particleAlpha(p)).toBeLessThan(0.25)
  })
})

describe('spawnParticle', () => {
  it('is a silent no-op without a real compositor (jsdom)', () => {
    expect(spawnParticle({ x: 0, y: 0, life: 1, size: 2, color: GOLD })).toBe(false)
    expect(document.querySelector('canvas')).toBeNull()
  })
})
