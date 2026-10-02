export type Hsl = readonly [number, number, number]
export type ParticleShape = 'dot' | 'glow' | 'flake' | 'star' | 'ring' | 'bloom'

export interface Point {
  x: number
  y: number
}

export interface ParticleSpec {
  x: number
  y: number
  vx?: number
  vy?: number
  /** Gravity per 60fps frame. */
  gravity?: number
  /** Velocity multiplier per 60fps frame. */
  drag?: number
  /** Seconds. */
  life: number
  size: number
  color: Hsl
  shape?: ParticleShape
  /** Additive blend: glows on the dark stage, washes out on paper. */
  additive?: boolean
  alpha?: number
  spin?: number
  flipSpeed?: number
  sway?: number
  twinkle?: boolean
  trail?: number
  /** Chance per frame to drop a small twinkling ember. */
  shed?: number
  ring?: { from: number; to: number }
  delay?: number
  /** Seconds of free flight before steering towards `home`. */
  homeAfter?: number
  home?: () => Point | null
  onArrive?: () => void
}

export interface Particle extends Required<Omit<ParticleSpec, 'home' | 'onArrive' | 'ring'>> {
  age: number
  rotation: number
  flip: number
  phase: number
  trailPoints: number[]
  ring: { from: number; to: number } | null
  home: (() => Point | null) | null
  onArrive: (() => void) | null
  done: boolean
}

export function createParticle(spec: ParticleSpec, random: () => number = Math.random): Particle {
  return {
    x: spec.x,
    y: spec.y,
    vx: spec.vx ?? 0,
    vy: spec.vy ?? 0,
    gravity: spec.gravity ?? 0,
    drag: spec.drag ?? 0.985,
    life: spec.life,
    size: spec.size,
    color: spec.color,
    shape: spec.shape ?? 'dot',
    additive: spec.additive ?? false,
    alpha: spec.alpha ?? 1,
    spin: spec.spin ?? 0,
    flipSpeed: spec.flipSpeed ?? 0,
    sway: spec.sway ?? 0,
    twinkle: spec.twinkle ?? false,
    trail: spec.trail ?? 0,
    shed: spec.shed ?? 0,
    delay: spec.delay ?? 0,
    homeAfter: spec.homeAfter ?? 0,
    ring: spec.ring ?? null,
    home: spec.home ?? null,
    onArrive: spec.onArrive ?? null,
    age: 0,
    rotation: random() * Math.PI * 2,
    flip: 0,
    phase: random() * Math.PI * 2,
    trailPoints: [],
    done: false,
  }
}

const HOME_MIN_SPEED = 7
const HOME_MAX_SPEED = 24
const HOME_STEER = 0.16

/**
 * Advances one particle by `frames` (1 = one 60fps frame). Pure apart from the
 * particle itself, so the physics is testable without a canvas.
 */
export function stepParticle(p: Particle, frames: number, seconds: number) {
  if (p.done) return
  if (p.delay > 0) {
    p.delay -= seconds
    return
  }
  p.age += seconds
  if (p.age >= p.life) {
    p.done = true
    return
  }
  const target = p.home && p.age >= p.homeAfter ? p.home() : null
  if (target) {
    const dx = target.x - p.x
    const dy = target.y - p.y
    const distance = Math.hypot(dx, dy) || 1
    // Ramp in the pull so the burst reads first and the flight second.
    const pull = Math.min(1, (p.age - p.homeAfter) * 3)
    const speed = HOME_MIN_SPEED + pull * (HOME_MAX_SPEED - HOME_MIN_SPEED)
    const steer = Math.min(1, HOME_STEER * frames * pull)
    p.vx += ((dx / distance) * speed - p.vx) * steer
    p.vy += ((dy / distance) * speed - p.vy) * steer
    if (distance < Math.max(14, Math.hypot(p.vx, p.vy) * frames)) {
      p.x = target.x
      p.y = target.y
      p.done = true
      p.onArrive?.()
      return
    }
  } else {
    p.vy += p.gravity * frames
    if (p.sway) p.vx += Math.sin(p.age * p.sway + p.phase) * 0.12 * frames
  }
  const drag = Math.pow(p.drag, frames)
  p.vx *= drag
  p.vy *= drag
  p.x += p.vx * frames
  p.y += p.vy * frames
  p.rotation += p.spin * frames
  p.flip += p.flipSpeed * frames
  if (p.trail > 0) {
    p.trailPoints.push(p.x, p.y)
    if (p.trailPoints.length > p.trail * 2) p.trailPoints.splice(0, 2)
  }
}

export function particleAlpha(p: Particle) {
  const t = p.age / p.life
  let alpha = p.alpha * (1 - t * t)
  if (p.twinkle) alpha *= 0.55 + 0.45 * Math.sin(p.age * 22 + p.phase)
  return Math.max(0, alpha)
}

/** Eased radius for expanding ring/bloom shapes. */
export function particleRingRadius(p: Particle, fallback: { from: number; to: number }) {
  const t = p.age / p.life
  const ring = p.ring ?? fallback
  return ring.from + (ring.to - ring.from) * (1 - Math.pow(1 - t, 3))
}

export interface ParticleRenderer {
  readonly kind: 'webgl' | 'canvas2d'
  readonly capacity: number
  resize(width: number, height: number, ratio: number): void
  render(particles: readonly Particle[]): void
  clear(): void
}
