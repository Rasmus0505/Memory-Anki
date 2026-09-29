import { spawnParticle, prefersReducedParticleMotion } from '@/shared/fx/particles/particleEngine'
import type { Hsl, ParticleShape } from '@/shared/fx/particles/particleModel'
import { pal } from '@/shared/fx/skins'

export type CelebrationPreset =
  | 'random_direction'
  | 'realistic_look'
  | 'fireworks'
  | 'stars'
  | 'school_pride'

export type CelebrationScenario =
  | 'preview'
  | 'review'
  | 'milestone'
  | 'completion'
  | 'timer'
  | 'quiz'

type BurstShape = 'square' | 'circle' | 'star'

/** canvas-confetti style burst description, rendered by the fx particle engine. */
export interface CelebrationBurst {
  angle?: number
  colors?: readonly Hsl[]
  decay?: number
  gravity?: number
  origin?: { x?: number; y?: number }
  particleCount: number
  scalar?: number
  shapes?: BurstShape[]
  spread: number
  startVelocity: number
  ticks?: number
}

interface CelebrationProgress {
  amount: number
  elapsedRatio: number
  intensity: number
  phase: number
}

interface CelebrationPresetDebugConfig {
  maxDurationMs: number
  minDurationMs: number
  name: CelebrationPreset
  scenarioDurationMultiplier: Partial<Record<CelebrationScenario, number>>
  speed: number
}

interface CelebrationPresetDefinition extends CelebrationPresetDebugConfig {
  tick: (emit: (burst: CelebrationBurst) => void, progress: CelebrationProgress) => void
}

const PREVIEW_AMOUNT = 1.15
const DEFAULT_SCENARIO: CelebrationScenario = 'review'
const DEFAULT_AMOUNT = 1
/** One confetti particle ≈ this many fx particles; the fx ones are richer (spin, flip, glow). */
const DENSITY = 0.42
const SCENARIO_DURATION_MULTIPLIER: Record<CelebrationScenario, number> = {
  preview: 0.85,
  review: 0.82,
  milestone: 1,
  completion: 1.08,
  timer: 1.18,
  quiz: 0.76,
}

let activeRunId = 0
const scheduledTimeouts = new Set<number>()
const scheduledIntervals = new Set<number>()
let burstSink: ((burst: CelebrationBurst) => void) | null = null

const range = (min: number, max: number) => min + Math.random() * (max - min)
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

// Warm only: the old flag/sky palettes read as a different product.
const warmConfetti = () => [pal.gold, pal.amber, pal.coral, pal.rating[3], pal.cream, pal.paperGold]
const goldStars = () => [pal.gold, pal.amber, pal.cream, [48, 100, 86] as Hsl]
const roseStars = () => [pal.coral, [340, 70, 72] as Hsl, pal.amber, pal.cream]
const cinnabar = () => [[4, 78, 52] as Hsl, pal.cream, pal.gold]

function shapeFor(shapes: BurstShape[] | undefined): ParticleShape {
  const shape = shapes ? pick(shapes) : Math.random() < 0.7 ? 'square' : 'circle'
  if (shape === 'star') return 'star'
  return shape === 'circle' ? 'dot' : 'flake'
}

function renderBurst(burst: CelebrationBurst) {
  if (typeof window === 'undefined') return
  const width = window.innerWidth
  const height = window.innerHeight
  const x = (burst.origin?.x ?? 0.5) * width
  const y = (burst.origin?.y ?? 0.7) * height
  const count = Math.max(1, Math.round(burst.particleCount * DENSITY))
  const colors = burst.colors ?? warmConfetti()
  const center = ((burst.angle ?? 90) * Math.PI) / 180
  const spread = (burst.spread * Math.PI) / 180
  const scalar = burst.scalar ?? 1
  const drag = 1 - (1 - (burst.decay ?? 0.92)) * 0.55
  const life = ((burst.ticks ?? 120) / 60) * 1.15
  for (let i = 0; i < count; i += 1) {
    const angle = center + (Math.random() - 0.5) * spread
    const speed = burst.startVelocity * range(0.45, 1) * 0.36
    const shape = shapeFor(burst.shapes)
    spawnParticle({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: -Math.sin(angle) * speed,
      gravity: 0.2 * (burst.gravity ?? 1),
      drag,
      sway: shape === 'flake' ? 4 : 0,
      shape,
      additive: pal.luminous && shape !== 'flake',
      size: scalar * (shape === 'star' ? range(3.5, 6) : range(2.4, 4.4)),
      color: pick(colors),
      spin: range(-0.22, 0.22),
      flipSpeed: shape === 'flake' ? range(0.12, 0.32) : 0,
      life: range(life * 0.7, life),
    })
  }
}

function emit(burst: CelebrationBurst) {
  if (burstSink) burstSink(burst)
  else renderBurst(burst)
}

const PRESET_DEFINITIONS: Record<CelebrationPreset, CelebrationPresetDefinition> = {
  random_direction: {
    name: 'random_direction',
    speed: 4,
    minDurationMs: 420,
    maxDurationMs: 980,
    scenarioDurationMultiplier: { preview: 0.7, review: 0.82, quiz: 0.76, milestone: 0.92, completion: 1, timer: 1.05 },
    tick(fire, progress) {
      fire({
        particleCount: 10 + progress.intensity * 12,
        spread: 36 + progress.phase * 20,
        startVelocity: 18 + progress.intensity * 10,
        scalar: 0.72 + progress.intensity * 0.16,
        ticks: 80 + progress.phase * 20,
        angle: range(40, 140),
        origin: { x: range(0.08, 0.92), y: range(0.14, 0.86) },
      })
    },
  },
  fireworks: {
    name: 'fireworks',
    speed: 7,
    minDurationMs: 760,
    maxDurationMs: 1650,
    scenarioDurationMultiplier: { preview: 0.82, review: 0.88, quiz: 0.78, milestone: 1, completion: 1.05, timer: 1.12 },
    tick(fire, progress) {
      const y = range(0.08, 0.34)
      const count = (58 + progress.intensity * 78) * (1 + progress.phase * 0.22)
      const ticks = 58 + progress.phase * 8
      const startVelocity = 28 + progress.intensity * 12
      fire({ particleCount: count, spread: 360, ticks, startVelocity, origin: { x: range(0.1, 0.3), y } })
      fire({ particleCount: count, spread: 360, ticks, startVelocity, origin: { x: range(0.7, 0.9), y } })
    },
  },
  realistic_look: {
    name: 'realistic_look',
    speed: 6,
    minDurationMs: 640,
    maxDurationMs: 1420,
    scenarioDurationMultiplier: { preview: 0.78, review: 0.86, quiz: 0.78, milestone: 0.96, completion: 1.02, timer: 1.08 },
    tick(fire, progress) {
      const base = 200 * (0.82 + progress.intensity * 0.52)
      const origin = { y: 0.68 + range(-0.02, 0.03) }
      fire({ spread: 26, startVelocity: 52 + progress.phase * 4, origin, particleCount: base * 0.25 })
      fire({ spread: 60, startVelocity: 36 + progress.phase * 2, origin, particleCount: base * 0.2 })
      fire({ spread: 100, startVelocity: 32 + progress.phase * 2, decay: 0.91, scalar: 0.8, origin, particleCount: base * 0.35 })
      fire({ spread: 120, startVelocity: 25 + progress.phase * 2, decay: 0.92, scalar: 1.2, origin, particleCount: base * 0.1 })
      fire({ spread: 120, startVelocity: 45 + progress.phase * 3, origin, particleCount: base * 0.1 })
    },
  },
  stars: {
    name: 'stars',
    speed: 5,
    minDurationMs: 720,
    maxDurationMs: 1500,
    scenarioDurationMultiplier: { preview: 0.82, review: 0.88, quiz: 0.8, milestone: 0.98, completion: 1.04, timer: 1.08 },
    tick(fire, progress) {
      const spread = 44 + progress.phase * 16
      const startVelocity = 26 + progress.intensity * 10
      const common = {
        particleCount: 18 + progress.intensity * 18,
        spread,
        startVelocity,
        ticks: 120 + progress.phase * 12,
        scalar: 0.96 + progress.intensity * 0.16,
        shapes: ['star'] as BurstShape[],
      }
      fire({ ...common, colors: goldStars(), angle: 48, origin: { x: 0.06, y: 0.84 } })
      fire({ ...common, colors: roseStars(), angle: 132, origin: { x: 0.94, y: 0.84 } })
      if (progress.phase >= 2) {
        fire({ ...common, particleCount: 22 + progress.intensity * 24, spread: 56 + progress.phase * 10, startVelocity: startVelocity + 2, colors: goldStars(), angle: 270, origin: { x: 0.5, y: 0.04 } })
      }
    },
  },
  school_pride: {
    name: 'school_pride',
    speed: 8,
    minDurationMs: 980,
    maxDurationMs: 2200,
    scenarioDurationMultiplier: { preview: 0.88, review: 0.94, quiz: 0.82, milestone: 1, completion: 1.1, timer: 1.18 },
    tick(fire, progress) {
      const boost = 1 + progress.phase * 0.28
      const side = (16 + progress.intensity * 14) * boost
      const ticks = 120 + progress.phase * 10
      const startVelocity = 26 + progress.phase * 3
      fire({ particleCount: side, angle: 60, spread: 55 + progress.phase * 4, origin: { x: 0, y: 0.78 + range(-0.04, 0.04) }, colors: cinnabar(), startVelocity, ticks })
      fire({ particleCount: side, angle: 120, spread: 55 + progress.phase * 4, origin: { x: 1, y: 0.78 + range(-0.04, 0.04) }, colors: cinnabar(), startVelocity, ticks })
      if (progress.phase >= 2) {
        fire({
          particleCount: (28 + progress.intensity * 36) * boost,
          spread: 360,
          startVelocity: 30 + progress.phase * 4,
          ticks: 64 + progress.phase * 10,
          scalar: 1 + progress.intensity * 0.12,
          origin: { x: progress.elapsedRatio < 0.7 ? range(0.12, 0.3) : range(0.7, 0.88), y: range(0.06, 0.24) },
          colors: warmConfetti(),
        })
      }
      if (progress.phase >= 3) {
        fire({ particleCount: 20 + progress.intensity * 24, spread: 360, gravity: 0, decay: 0.94, startVelocity: 28 + progress.intensity * 8, colors: goldStars(), scalar: 1.12, shapes: ['star'], ticks: 58 })
      }
    },
  },
}

function resolveDurationMs(preset: CelebrationPresetDefinition, amount: number, scenario: CelebrationScenario, durationMs?: number) {
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0) return Math.round(durationMs)
  const span = preset.maxDurationMs - preset.minDurationMs
  const multiplier = preset.scenarioDurationMultiplier[scenario] ?? SCENARIO_DURATION_MULTIPLIER[scenario] ?? 1
  return Math.round((preset.minDurationMs + span * (clamp(amount, 0, 3) / 3)) * multiplier)
}

function clearScheduledWork() {
  scheduledTimeouts.forEach((id) => window.clearTimeout(id))
  scheduledTimeouts.clear()
  scheduledIntervals.forEach((id) => window.clearInterval(id))
  scheduledIntervals.clear()
}

function runPreset(preset: CelebrationPresetDefinition, amount: number, durationMs: number) {
  activeRunId += 1
  clearScheduledWork()
  const runId = activeRunId
  const startedAt = Date.now()
  const shoot = () => {
    if (runId !== activeRunId) return
    const elapsedRatio = clamp((Date.now() - startedAt) / durationMs, 0, 1)
    preset.tick(emit, {
      amount,
      elapsedRatio,
      intensity: clamp(amount * (0.72 + elapsedRatio * 0.9), 0.2, 3.2),
      phase: Math.min(3, Math.floor(elapsedRatio * 4)),
    })
  }
  shoot()
  const intervalId = window.setInterval(shoot, Math.max(60, Math.round(1000 / preset.speed)))
  scheduledIntervals.add(intervalId)
  const timeoutId = window.setTimeout(() => {
    scheduledTimeouts.delete(timeoutId)
    window.clearInterval(intervalId)
    scheduledIntervals.delete(intervalId)
  }, durationMs)
  scheduledTimeouts.add(timeoutId)
}

export function getCelebrationPresetDebugConfig(preset: CelebrationPreset): CelebrationPresetDebugConfig {
  const definition = PRESET_DEFINITIONS[preset]
  return {
    name: definition.name,
    speed: definition.speed,
    minDurationMs: definition.minDurationMs,
    maxDurationMs: definition.maxDurationMs,
    scenarioDurationMultiplier: { ...definition.scenarioDurationMultiplier },
  }
}

export function launchCelebrationPreset(args: {
  preset: CelebrationPreset
  reducedMotion: boolean
  amount?: number
  durationMs?: number
  scenario?: CelebrationScenario
}) {
  const { preset, reducedMotion, amount = DEFAULT_AMOUNT, durationMs, scenario = DEFAULT_SCENARIO } = args
  if (reducedMotion || typeof window === 'undefined' || (!burstSink && prefersReducedParticleMotion())) return
  const definition = PRESET_DEFINITIONS[preset]
  const normalized = clamp(scenario === 'preview' ? Math.max(amount, PREVIEW_AMOUNT) : amount, 0, 3)
  runPreset(definition, normalized, resolveDurationMs(definition, normalized, scenario, durationMs))
}

/** Tests capture bursts instead of rendering them. */
export function __setCelebrationBurstSinkForTests(sink: ((burst: CelebrationBurst) => void) | null) {
  burstSink = sink
}

export function __resetCelebrationEngineForTests() {
  activeRunId += 1
  clearScheduledWork()
}
