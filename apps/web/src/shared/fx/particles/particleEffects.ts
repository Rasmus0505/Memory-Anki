import {
  prefersReducedParticleMotion,
  spawnParticle,
  type Hsl,
  type Point,
} from './particleEngine'
import { pal } from '../skins'

export type ParticleRating = 1 | 2 | 3 | 4


/** Every rating gets the same full burst; the grade only changes the tint. */
export const RATING_BURST_COUNT = 26
/** Combo length at which the layered style upgrades to additive glow. */
export const GLOW_COMBO = 5

const range = (min: number, max: number) => min + Math.random() * (max - min)
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

export function particlesAllowed() {
  return !prefersReducedParticleMotion()
}

export function rectCenter(rect: DOMRect): Point {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

function paperBurst(origin: Point, count: number, tone: Hsl) {
  for (let i = 0; i < count; i += 1) {
    const angle = range(-Math.PI * 0.95, -Math.PI * 0.05)
    const speed = range(2.5, 7.5)
    const roll = Math.random()
    const vx = Math.cos(angle) * speed
    const vy = Math.sin(angle) * speed
    if (roll < 0.55) {
      spawnParticle({ ...origin, vx, vy, gravity: 0.12, drag: 0.955, sway: 5, shape: 'flake', additive: pal.luminous, size: range(2.4, 4.6), color: pick([pal.paper, pal.cream, tone, pal.gold]), spin: range(-0.2, 0.2), flipSpeed: range(0.12, 0.3), life: range(0.9, 1.4) })
    } else if (roll < 0.82) {
      const star = pal.sparkShape === 'star'
      spawnParticle({ ...origin, vx: vx * 0.8, vy: vy * 0.8, gravity: 0.09, drag: 0.95, shape: pal.sparkShape, additive: pal.luminous, spin: star ? 0.18 : 0, size: star ? range(2.2, 3.8) : range(0.9, 1.8), color: pal.gold, twinkle: true, life: range(0.7, 1.2) })
    } else {
      spawnParticle({ ...origin, vx: vx * 0.6, vy: vy * 0.6, gravity: 0.16, drag: 0.94, size: range(1.6, 2.8), color: [tone[0], 30, 72], life: range(0.6, 1) })
    }
  }
}

function glowBurst(origin: Point, count: number, tone: Hsl) {
  for (let i = 0; i < count; i += 1) {
    const angle = range(0, Math.PI * 2)
    const speed = range(2, 8.5)
    spawnParticle({ ...origin, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.5, gravity: 0.06, drag: 0.94, shape: 'glow', additive: true, size: range(1.2, 2.6), color: Math.random() < 0.5 ? tone : pal.gold, trail: Math.random() < 0.5 ? 6 : 0, life: range(0.6, 1.1) })
  }
}
/**
 * Layered style: paper, ink and gold dust by default; once a streak reaches
 * GLOW_COMBO the same burst switches to additive glowing gold.
 */
export function emitRatingBurst(origin: Point, rating: ParticleRating, combo: number) {
  if (!particlesAllowed()) return
  const tone = pal.rating[rating]
  if (combo >= GLOW_COMBO && rating >= 2) glowBurst(origin, RATING_BURST_COUNT, tone)
  else paperBurst(origin, RATING_BURST_COUNT, tone)
}

export type GradeVariant = 'paper' | 'ink' | 'leaf' | 'mote'

/** One grade, four looks. No expanding ring — the press itself is the accent. */
export function emitGradeVariant(origin: Point, rating: ParticleRating, combo: number, variant: GradeVariant) {
  if (!particlesAllowed()) return
  const tone = pal.rating[rating]
  if (variant === 'paper') {
    emitRatingBurst(origin, rating, combo)
    return
  }
  if (variant === 'ink') {
    for (let i = 0; i < 10; i += 1) {
      spawnParticle({
        x: origin.x + range(-10, 10),
        y: origin.y - range(4, 18),
        vy: range(0.4, 1.6),
        gravity: 0.12,
        drag: 0.96,
        size: range(1.4, 2.6),
        color: [tone[0], 28, 42],
        alpha: 0.85,
        life: range(0.45, 0.8),
      })
    }
    return
  }
  if (variant === 'leaf') {
    for (let i = 0; i < 14; i += 1) {
      const side = i % 2 ? 1 : -1
      spawnParticle({
        x: origin.x,
        y: origin.y,
        vx: side * range(1.2, 4.2),
        vy: range(-3.2, -0.6),
        gravity: 0.1,
        drag: 0.95,
        sway: 4,
        shape: 'flake',
        size: range(2, 3.6),
        color: i % 3 ? pal.leaf : tone,
        spin: range(-0.2, 0.2),
        flipSpeed: 0.18,
        life: range(0.7, 1.1),
      })
    }
    return
  }
  for (let i = 0; i < 12; i += 1) {
    spawnParticle({
      x: origin.x + range(-14, 14),
      y: origin.y + range(-4, 8),
      vx: range(-0.3, 0.3),
      vy: range(-1.4, -0.3),
      drag: 0.98,
      shape: 'glow',
      additive: true,
      size: range(1, 2.2),
      color: Math.random() < 0.5 ? tone : pal.gold,
      twinkle: true,
      life: range(0.8, 1.4),
    })
  }
}

export interface FlightOptions {
  origin: Point
  /** Re-read every frame, so a moving target is fine. */
  target: () => Point | null
  count: number
  color?: Hsl
  glow?: boolean
  /** Lead particle becomes a bright comet with a long tail. */
  comet?: boolean
  /** Sparks thrown up where the flight lands. */
  fountain?: number
  onFirstArrive?: () => void
}

/** Particles burst out, then home onto `target`; `onFirstArrive` fires once. */
export function emitFlight(options: FlightOptions) {
  if (!particlesAllowed()) return false
  const { origin, target, count, color = pal.gold, glow = false, comet = false, fountain = 0, onFirstArrive } = options
  let arrived = false
  const land = () => {
    const point = target()
    if (point) {
      for (let i = 0; i < 3; i += 1) {
        spawnParticle({ ...point, vx: range(-2, 2), vy: range(-2.4, 0.6), gravity: 0.08, drag: 0.93, size: range(0.8, 1.5), color: pal.gold, shape: glow ? 'glow' : 'dot', additive: glow, twinkle: !glow, life: 0.45 })
      }
    }
    if (arrived) return
    arrived = true
    if (point) {
      for (let i = 0; i < fountain; i += 1) {
        spawnParticle({ ...point, vx: range(-2.5, 2.5), vy: range(-4, -1), gravity: 0.12, drag: 0.95, shape: 'glow', additive: true, size: range(0.8, 1.5), color: pal.gold, life: range(0.4, 0.7) })
      }
    }
    onFirstArrive?.()
  }
  let spawned = 0
  for (let i = 0; i < count; i += 1) {
    const lead = comet && i === 0
    const angle = range(-Math.PI * 0.85, -Math.PI * 0.15)
    const speed = range(3, 6.5)
    const ok = spawnParticle({ ...origin, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, drag: 0.96, shape: glow || lead ? 'glow' : 'dot', additive: glow || lead, size: lead ? 3.4 : glow ? range(1.3, 2) : range(1.6, 2.4), color, trail: lead ? 16 : 7, homeAfter: 0.14 + i * 0.035, life: 3, home: target, onArrive: land })
    if (ok) spawned += 1
  }
  return spawned > 0
}

/**
 * Rating collectors: a comet leads strong grades and the landing fountain grows
 * with the streak. Weak grades send fewer, dimmer collectors: information, never a loss.
 */
export function emitCollectors(args: {
  origin: Point
  target: () => Point | null
  rating: ParticleRating
  combo: number
  onFirstArrive?: () => void
}) {
  const { origin, target, rating, combo, onFirstArrive } = args
  const strong = rating >= 3
  return emitFlight({
    origin,
    target,
    count: strong ? Math.round(6 + Math.min(combo, 10) * 0.4) : 3,
    color: strong ? pal.gold : [pal.rating[rating][0], 40, 62],
    glow: combo >= GLOW_COMBO && rating >= 2,
    comet: strong,
    fountain: strong ? 4 + Math.min(combo, 10) : 0,
    onFirstArrive,
  })
}

/** A short light pillar and a slower second wave of gold dust. No expanding ring. */
export function emitKeycapShockwave(origin: Point, _rating: ParticleRating) {
  if (!particlesAllowed()) return
  for (let i = 0; i < 10; i += 1) {
    spawnParticle({ x: origin.x + range(-6, 6), y: origin.y, vy: range(-7, -3.5), drag: 0.93, shape: 'glow', additive: true, size: range(1, 1.8), color: pal.gold, life: range(0.5, 0.8), delay: i * 0.02 })
  }
  for (let i = 0; i < 14; i += 1) {
    const angle = range(-Math.PI, 0)
    const speed = range(1.5, 4)
    spawnParticle({ x: origin.x, y: origin.y - 10, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, gravity: 0.05, drag: 0.95, size: range(0.8, 1.6), color: pal.gold, twinkle: true, life: range(0.8, 1.2), delay: 0.16 })
  }
}

export function emitComboMilestone(center: Point, combo: number) {
  if (!particlesAllowed()) return
  const scale = combo >= 20 ? 1.8 : combo >= 10 ? 1.35 : 1
  spawnParticle({ ...center, shape: 'ring', additive: true, ring: { from: 10, to: 120 * scale }, size: 5, color: pal.gold, life: 0.75 })
  for (let i = 0; i < 26 * scale; i += 1) {
    const angle = range(0, Math.PI * 2)
    const speed = range(3, 10)
    spawnParticle({ ...center, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, gravity: 0.05, drag: 0.93, shape: 'star', additive: true, size: range(3, 6.5), color: pal.gold, spin: range(-0.25, 0.25), life: range(0.8, 1.3) })
  }
  glowBurst(center, 30 * scale, pal.amber)
}

/**
 * Gold dust drifts down onto a freshly revealed mind-map card, and a flat ring of
 * dust kicks up on the paper beneath it as it lands. Nothing is drawn on the card.
 */
export function emitGoldDustSettle(rect: DOMRect, delaySeconds = 0) {
  if (!particlesAllowed() || rect.width === 0) return
  const count = Math.round(Math.min(26, 12 + rect.width / 14))
  for (let i = 0; i < count; i += 1) {
    spawnParticle({ x: range(rect.left, rect.right), y: rect.top - range(4, 26), vx: range(-0.3, 0.3), vy: range(0.4, 1.4), gravity: 0.05, drag: 0.97, size: range(0.9, 2), color: pal.paperGold, twinkle: true, life: range(0.8, 1.3), delay: delaySeconds + range(0, 0.08) })
  }
  const cx = rect.left + rect.width / 2
  spawnParticle({ x: cx, y: rect.bottom + 3, shape: 'bloom', ring: { from: rect.width * 0.2, to: rect.width * 0.62 }, size: 1, color: [38, 80, 58], alpha: 0.7, life: 0.8, delay: delaySeconds })
  for (let i = 0; i < 18; i += 1) {
    const side = i % 2 ? 1 : -1
    spawnParticle({ x: cx + side * range(0, rect.width * 0.3), y: rect.bottom + 2, vx: side * range(1.2, 3.2), vy: range(-0.8, -0.1), gravity: 0.05, drag: 0.92, size: range(0.8, 1.6), color: pal.paperGold, life: range(0.5, 0.8), delay: delaySeconds })
  }
}

/** A whole branch landed: gold and star rain over the map. */
export function emitGoldRain(rect: DOMRect, delaySeconds = 0) {
  if (!particlesAllowed() || rect.width === 0) return
  const count = Math.round(Math.min(110, 50 + rect.width / 16))
  for (let i = 0; i < count; i += 1) {
    spawnParticle({ x: range(rect.left, rect.right), y: rect.top - range(0, 40), vx: range(-0.4, 0.4), vy: range(1, 2.6), gravity: 0.04, drag: 0.98, shape: Math.random() < 0.35 ? 'star' : 'dot', spin: 0.1, size: range(1, 4), color: pal.paperGold, twinkle: true, life: range(1.2, 1.8), delay: delaySeconds + range(0, 0.5) })
  }
}

/**
 * Round complete: dense diagonal gold meteors led by one giant, a wide ring, then
 * embers drifting down for a while after the rush.
 */
export function emitMeteorShower(focus?: Point) {
  if (!particlesAllowed() || typeof window === 'undefined') return
  const w = window.innerWidth
  const h = window.innerHeight
  const center = focus ?? { x: w / 2, y: h / 2 }
  spawnParticle({ ...center, shape: 'ring', additive: true, ring: { from: 40, to: Math.max(w, h) * 0.7 }, size: 6, color: pal.gold, life: 1.1, delay: 0.26 })
  spawnParticle({ x: -40, y: h * 0.05, vx: 13, vy: 10, drag: 0.998, shape: 'glow', additive: true, size: 5, color: pal.gold, trail: 26, shed: 0.6, life: 2, delay: 0.12 })
  const count = w < 640 ? 34 : 56
  for (let i = 0; i < count; i += 1) {
    const speed = range(12, 18)
    spawnParticle({ x: range(-w * 0.2, w * 0.9), y: range(-80, h * 0.25), vx: speed * 0.62, vy: speed * 0.78, drag: 0.995, shape: 'glow', additive: true, size: range(1.4, 2.8), color: pick([pal.gold, pal.amber]), trail: 13, shed: 0.32, life: range(1.2, 1.8), delay: i * 0.045 })
  }
  for (let i = 0; i < 26; i += 1) {
    spawnParticle({ x: range(0, w), y: -10, vx: range(-0.3, 0.3), vy: range(0.6, 1.4), sway: 1.5, drag: 0.995, shape: 'glow', additive: true, size: range(1, 2), color: pal.amber, twinkle: true, life: range(2, 3), delay: 2.6 + i * 0.05 })
  }
}
/* ---------- scene effects ---------- */


/** A counter on the paper card just completed: green ring plus paper-gold stars. */
export function emitBadgeBurst(center: Point) {
  if (!particlesAllowed()) return
  spawnParticle({ ...center, shape: 'ring', ring: { from: 6, to: 60 }, size: 4, color: pal.green, life: 0.6 })
  for (let i = 0; i < 14; i += 1) {
    const angle = range(0, Math.PI * 2)
    const speed = range(2, 6)
    spawnParticle({ ...center, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, drag: 0.92, shape: i % 3 ? 'star' : 'flake', size: range(2.5, 5), spin: 0.2, flipSpeed: 0.2, color: i % 3 ? pal.paperGold : pal.green, life: range(0.6, 1) })
  }
}

/** Palace cleared: leaves and gold sprayed out of both ends of the banner. */
export function emitLeafSpray(rect: DOMRect) {
  if (!particlesAllowed() || rect.width === 0) return
  const y = rect.top + rect.height / 2
  const ends: Array<[number, number]> = [[rect.left, -1], [rect.right, 1]]
  for (const [x, dir] of ends) {
    for (let i = 0; i < 18; i += 1) {
      const angle = dir > 0 ? range(-1.2, 0.2) : range(Math.PI - 0.2, Math.PI + 1.2)
      const speed = range(2, 6)
      spawnParticle({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1, gravity: 0.1, drag: 0.95, sway: 4, shape: i % 3 ? 'flake' : 'dot', size: range(2, 4), color: i % 3 ? pal.leaf : pal.gold, spin: range(-0.2, 0.2), flipSpeed: 0.2, life: range(0.9, 1.3) })
    }
  }
  spawnParticle({ x: rect.left + rect.width / 2, y, shape: 'ring', additive: true, ring: { from: 20, to: 140 }, size: 4, color: pal.gold, life: 0.7 })
}

/** Correct answer on a paper quiz card: paper burst in the grade's green, plus a ring. */
export function emitCorrectBurst(center: Point) {
  if (!particlesAllowed()) return
  paperBurst(center, 22, pal.rating[3])
  spawnParticle({ ...center, shape: 'ring', ring: { from: 8, to: 70 }, size: 4, color: pal.green, life: 0.55 })
}

/** A wrong answer only sinks a little ink: never a red flash. */
export function emitInkSink(center: Point) {
  if (!particlesAllowed()) return
  spawnParticle({ x: center.x, y: center.y + 6, shape: 'bloom', ring: { from: 4, to: 46 }, size: 1, color: [8, 30, 70], life: 0.9 })
  for (let i = 0; i < 6; i += 1) {
    spawnParticle({ x: center.x + range(-16, 16), y: center.y, vx: range(-0.5, 0.5), vy: range(0.3, 1.4), gravity: 0.1, drag: 0.96, size: range(1.4, 2.4), color: [8, 34, 66], alpha: 0.8, life: range(0.5, 0.8) })
  }
}

/** One coral drop falls into a freshly inserted retry slot and ripples on landing. */
export function emitInkDrop(target: () => Point | null) {
  if (!particlesAllowed()) return
  const start = target()
  if (!start) return
  spawnParticle({
    x: start.x,
    y: start.y - 60,
    vy: 1,
    shape: 'glow',
    additive: true,
    size: 2.4,
    color: pal.coral,
    trail: 8,
    life: 2,
    home: target,
    onArrive: () => {
      const point = target()
      if (point) spawnParticle({ ...point, shape: 'ring', additive: true, ring: { from: 3, to: 26 }, size: 2.5, color: pal.coral, life: 0.5 })
    },
  })
}

/** Paper scraps shed from the right edge of a card being torn off the queue. */
export function emitPaperPeel(rect: DOMRect) {
  if (!particlesAllowed() || rect.width === 0) return
  for (let i = 0; i < 18; i += 1) {
    spawnParticle({ x: rect.right - range(0, 12), y: range(rect.top, rect.bottom), vx: range(0.5, 3), vy: range(-2, 0), gravity: 0.14, drag: 0.96, sway: 4, shape: 'flake', size: range(2, 3.6), color: pick([pal.paper, pal.cream]), spin: range(-0.2, 0.2), flipSpeed: 0.25, life: range(0.9, 1.3), delay: i * 0.012 })
  }
}

/** Sparks rising off lit rail segments (25/50/75% of the round). */
export function emitRailSparks(points: readonly Point[]) {
  if (!particlesAllowed()) return
  points.forEach((point, index) => {
    spawnParticle({ ...point, vx: range(-0.5, 0.5), vy: range(-3, -1.5), gravity: 0.08, shape: 'glow', additive: true, size: 1.4, color: pal.gold, life: 0.7, delay: index * 0.06 })
  })
}

/** One slow mote of light drifting up just outside a key card's edge. */
export function emitAmbientMote(rect: DOMRect) {
  if (!particlesAllowed() || rect.width === 0) return
  const onTopOrBottom = Math.random() < 0.5
  const x = onTopOrBottom ? range(rect.left, rect.right) : pick([rect.left - 4, rect.right + 4])
  const y = onTopOrBottom ? pick([rect.top - 4, rect.bottom + 4]) : range(rect.top, rect.bottom)
  spawnParticle({ x, y, vx: range(-0.2, 0.2), vy: range(-0.6, -0.2), drag: 0.99, shape: 'glow', additive: true, size: range(1, 1.8), color: pal.gold, twinkle: true, life: range(1.4, 2.2) })
}

/** A pinch of paper dust from the edge of the page being pressed down. */
export function emitPageDust(x0: number, x1: number, y: number) {
  if (!particlesAllowed()) return
  for (let i = 0; i < 16; i += 1) {
    spawnParticle({ x: range(x0, x1), y, vx: range(-1.5, 1.5), vy: range(-2.2, -0.6), gravity: 0.08, drag: 0.95, sway: 3, shape: i % 3 ? 'flake' : 'dot', size: range(1.4, 3), color: pick([pal.paper, pal.cream, pal.gold]), spin: 0.15, flipSpeed: 0.2, life: range(0.7, 1.1) })
  }
}

/** Ink and gold drawn back into the parent card when its children are hidden. */
export function emitFoldTrail(rect: DOMRect, target: () => Point | null, onFirstArrive?: () => void) {
  if (!particlesAllowed() || rect.width === 0) return
  let arrived = false
  for (let i = 0; i < 10; i += 1) {
    spawnParticle({
      x: range(rect.left, rect.right),
      y: range(rect.top, rect.bottom),
      vx: range(-1.5, 1.5),
      vy: range(-1.5, 1.5),
      drag: 0.95,
      size: range(1.2, 2.2),
      color: i % 3 ? pal.ink : pal.paperGold,
      alpha: 0.8,
      trail: 5,
      delay: i * 0.015,
      homeAfter: 0.05,
      life: 2,
      home: target,
      onArrive: () => {
        if (arrived) return
        arrived = true
        onFirstArrive?.()
      },
    })
  }
}
