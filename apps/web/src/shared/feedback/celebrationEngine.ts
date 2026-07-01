import confetti from 'canvas-confetti'

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

type CelebrationShape = 'square' | 'circle' | 'star'

interface CelebrationBurstOptions {
  angle?: number
  colors?: string[]
  decay?: number
  drift?: number
  flat?: boolean
  gravity?: number
  origin?: {
    x?: number
    y?: number
  }
  particleCount: number
  scalar?: number
  shapes?: CelebrationShape[]
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
  tick: (
    launch: ReturnType<typeof confetti.create>,
    progress: CelebrationProgress,
  ) => void
}

const GLOBAL_CONFETTI_CANVAS_ID = 'memory-anki-global-confetti-canvas'
const GLOBAL_CONFETTI_Z_INDEX = '2147483647'

const PREVIEW_AMOUNT = 1.15
const DEFAULT_SCENARIO: CelebrationScenario = 'review'
const DEFAULT_AMOUNT = 1
const SCENARIO_DURATION_MULTIPLIER: Record<CelebrationScenario, number> = {
  preview: 0.85,
  review: 0.82,
  milestone: 1,
  completion: 1.08,
  timer: 1.18,
  quiz: 0.76,
}

let sharedCanvas: HTMLCanvasElement | null = null
let sharedLauncher: ReturnType<typeof confetti.create> | null = null
let activeRunId = 0
const scheduledTimeouts = new Set<number>()
const scheduledIntervals = new Set<number>()

function randomInRange(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value))
}

function scheduleTimeout(callback: () => void, delayMs: number) {
  const id = window.setTimeout(() => {
    scheduledTimeouts.delete(id)
    callback()
  }, delayMs)
  scheduledTimeouts.add(id)
  return id
}

function scheduleInterval(callback: () => void, delayMs: number) {
  const id = window.setInterval(callback, delayMs)
  scheduledIntervals.add(id)
  return id
}

function clearScheduledWork() {
  for (const id of scheduledTimeouts) {
    window.clearTimeout(id)
  }
  scheduledTimeouts.clear()

  for (const id of scheduledIntervals) {
    window.clearInterval(id)
  }
  scheduledIntervals.clear()
}

function emitBurst(
  launch: ReturnType<typeof confetti.create>,
  options: CelebrationBurstOptions,
) {
  void launch({
    angle: options.angle,
    colors: options.colors,
    decay: options.decay ?? 0.92,
    disableForReducedMotion: true,
    drift: options.drift ?? 0,
    flat: options.flat,
    gravity: options.gravity ?? 1,
    origin: {
      x: options.origin?.x ?? 0.5,
      y: options.origin?.y ?? 0.7,
    },
    particleCount: Math.max(1, Math.round(options.particleCount)),
    scalar: options.scalar ?? 1,
    shapes: options.shapes,
    spread: options.spread,
    startVelocity: options.startVelocity,
    ticks: options.ticks ?? 120,
  })
}

const PRESET_DEFINITIONS: Record<CelebrationPreset, CelebrationPresetDefinition> = {
  random_direction: {
    name: 'random_direction',
    speed: 4,
    minDurationMs: 420,
    maxDurationMs: 980,
    scenarioDurationMultiplier: {
      preview: 0.7,
      review: 0.82,
      quiz: 0.76,
      milestone: 0.92,
      completion: 1,
      timer: 1.05,
    },
    tick(launch, progress) {
      const phaseSpread = 36 + progress.phase * 20
      emitBurst(launch, {
        particleCount: 10 + progress.intensity * 12,
        spread: phaseSpread,
        startVelocity: 18 + progress.intensity * 10,
        scalar: 0.72 + progress.intensity * 0.16,
        ticks: 80 + progress.phase * 20,
        angle: randomInRange(40, 140),
        origin: {
          x: randomInRange(0.08, 0.92),
          y: randomInRange(0.14, 0.86),
        },
      })
    },
  },
  fireworks: {
    name: 'fireworks',
    speed: 7,
    minDurationMs: 760,
    maxDurationMs: 1650,
    scenarioDurationMultiplier: {
      preview: 0.82,
      review: 0.88,
      quiz: 0.78,
      milestone: 1,
      completion: 1.05,
      timer: 1.12,
    },
    tick(launch, progress) {
      const originY = randomInRange(-0.18, 0.28)
      const phaseBoost = 1 + progress.phase * 0.22
      emitBurst(launch, {
        particleCount: (58 + progress.intensity * 78) * phaseBoost,
        spread: 360,
        ticks: 58 + progress.phase * 8,
        startVelocity: 28 + progress.intensity * 12,
        origin: {
          x: randomInRange(0.1, 0.3),
          y: originY,
        },
      })
      emitBurst(launch, {
        particleCount: (58 + progress.intensity * 78) * phaseBoost,
        spread: 360,
        ticks: 58 + progress.phase * 8,
        startVelocity: 28 + progress.intensity * 12,
        origin: {
          x: randomInRange(0.7, 0.9),
          y: originY,
        },
      })
    },
  },
  realistic_look: {
    name: 'realistic_look',
    speed: 6,
    minDurationMs: 640,
    maxDurationMs: 1420,
    scenarioDurationMultiplier: {
      preview: 0.78,
      review: 0.86,
      quiz: 0.78,
      milestone: 0.96,
      completion: 1.02,
      timer: 1.08,
    },
    tick(launch, progress) {
      const baseCount = 200 * (0.82 + progress.intensity * 0.52)
      const originY = 0.68 + randomInRange(-0.02, 0.03)
      emitBurst(launch, {
        spread: 26,
        startVelocity: 52 + progress.phase * 4,
        origin: { y: originY },
        particleCount: baseCount * 0.25,
      })
      emitBurst(launch, {
        spread: 60,
        startVelocity: 36 + progress.phase * 2,
        origin: { y: originY },
        particleCount: baseCount * 0.2,
      })
      emitBurst(launch, {
        spread: 100,
        startVelocity: 32 + progress.phase * 2,
        decay: 0.91,
        scalar: 0.8,
        origin: { y: originY },
        particleCount: baseCount * 0.35,
      })
      emitBurst(launch, {
        spread: 120,
        startVelocity: 25 + progress.phase * 2,
        decay: 0.92,
        scalar: 1.2,
        origin: { y: originY },
        particleCount: baseCount * 0.1,
      })
      emitBurst(launch, {
        spread: 120,
        startVelocity: 45 + progress.phase * 3,
        origin: { y: originY },
        particleCount: baseCount * 0.1,
      })
    },
  },
  stars: {
    name: 'stars',
    speed: 5,
    minDurationMs: 720,
    maxDurationMs: 1500,
    scenarioDurationMultiplier: {
      preview: 0.82,
      review: 0.88,
      quiz: 0.8,
      milestone: 0.98,
      completion: 1.04,
      timer: 1.08,
    },
    tick(launch, progress) {
      const spread = 44 + progress.phase * 16
      const velocity = 26 + progress.intensity * 10
      emitBurst(launch, {
        particleCount: 18 + progress.intensity * 18,
        spread,
        startVelocity: velocity,
        ticks: 120 + progress.phase * 12,
        scalar: 0.96 + progress.intensity * 0.16,
        shapes: ['star'],
        colors: ['#f59e0b', '#fcd34d', '#fde68a', '#fff7ed'],
        angle: 48,
        origin: { x: 0.06, y: 0.84 },
      })
      emitBurst(launch, {
        particleCount: 18 + progress.intensity * 18,
        spread,
        startVelocity: velocity,
        ticks: 120 + progress.phase * 12,
        scalar: 0.96 + progress.intensity * 0.16,
        shapes: ['star'],
        colors: ['#38bdf8', '#7dd3fc', '#bfdbfe', '#eff6ff'],
        angle: 132,
        origin: { x: 0.94, y: 0.84 },
      })
      if (progress.phase >= 2) {
        emitBurst(launch, {
          particleCount: 22 + progress.intensity * 24,
          spread: 56 + progress.phase * 10,
          startVelocity: velocity + 2,
          ticks: 132 + progress.phase * 12,
          scalar: 1 + progress.intensity * 0.16,
          shapes: ['star'],
          colors: ['#f472b6', '#f9a8d4', '#c084fc', '#f5f3ff'],
          angle: 270,
          origin: { x: 0.5, y: 0.04 },
        })
      }
    },
  },
  school_pride: {
    name: 'school_pride',
    speed: 8,
    minDurationMs: 980,
    maxDurationMs: 2200,
    scenarioDurationMultiplier: {
      preview: 0.88,
      review: 0.94,
      quiz: 0.82,
      milestone: 1,
      completion: 1.1,
      timer: 1.18,
    },
    tick(launch, progress) {
      const phaseBoost = 1 + progress.phase * 0.28
      const sideParticleCount = (16 + progress.intensity * 14) * phaseBoost
      emitBurst(launch, {
        particleCount: sideParticleCount,
        angle: 60,
        spread: 55 + progress.phase * 4,
        origin: { x: 0, y: 0.78 + randomInRange(-0.04, 0.04) },
        colors: ['#bb0000', '#ffffff'],
        startVelocity: 26 + progress.phase * 3,
        ticks: 120 + progress.phase * 10,
      })
      emitBurst(launch, {
        particleCount: sideParticleCount,
        angle: 120,
        spread: 55 + progress.phase * 4,
        origin: { x: 1, y: 0.78 + randomInRange(-0.04, 0.04) },
        colors: ['#bb0000', '#ffffff'],
        startVelocity: 26 + progress.phase * 3,
        ticks: 120 + progress.phase * 10,
      })
      if (progress.phase >= 2) {
        emitBurst(launch, {
          particleCount: (28 + progress.intensity * 36) * phaseBoost,
          spread: 360,
          startVelocity: 30 + progress.phase * 4,
          ticks: 64 + progress.phase * 10,
          scalar: 1 + progress.intensity * 0.12,
          origin: {
            x: progress.elapsedRatio < 0.7 ? randomInRange(0.12, 0.3) : randomInRange(0.7, 0.88),
            y: randomInRange(-0.18, 0.18),
          },
          colors: ['#2563eb', '#ffffff', '#dc2626'],
        })
      }
      if (progress.phase >= 3) {
        emitBurst(launch, {
          particleCount: 20 + progress.intensity * 24,
          spread: 360,
          gravity: 0,
          decay: 0.94,
          startVelocity: 28 + progress.intensity * 8,
          colors: ['#ffe400', '#ffbd00', '#e89400', '#ffca6c', '#fdffb8'],
          scalar: 1.12,
          shapes: ['star'],
          ticks: 58,
        })
      }
    },
  },
}

function resolveDurationMs(
  preset: CelebrationPresetDefinition,
  amount: number,
  scenario: CelebrationScenario,
  durationMs?: number,
) {
  if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0) {
    return Math.round(durationMs)
  }
  const normalizedAmount = clamp(amount, 0, 3)
  const span = preset.maxDurationMs - preset.minDurationMs
  const amountRatio = normalizedAmount / 3
  const scenarioMultiplier =
    preset.scenarioDurationMultiplier[scenario] ??
    SCENARIO_DURATION_MULTIPLIER[scenario] ??
    1
  return Math.round((preset.minDurationMs + span * amountRatio) * scenarioMultiplier)
}

function ensureLauncher() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  if (sharedCanvas && sharedLauncher && document.body.contains(sharedCanvas)) {
    return sharedLauncher
  }

  const existingCanvas = document.getElementById(GLOBAL_CONFETTI_CANVAS_ID)
  const canvas =
    existingCanvas instanceof HTMLCanvasElement
      ? existingCanvas
      : document.createElement('canvas')

  canvas.id = GLOBAL_CONFETTI_CANVAS_ID
  canvas.setAttribute('aria-hidden', 'true')
  canvas.style.position = 'fixed'
  canvas.style.inset = '0'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.pointerEvents = 'none'
  canvas.style.zIndex = GLOBAL_CONFETTI_Z_INDEX

  if (!canvas.parentElement) {
    document.body.append(canvas)
  }

  sharedCanvas = canvas
  sharedLauncher = confetti.create(canvas, {
    resize: true,
    useWorker: true,
  })
  return sharedLauncher
}

function canEmitConfetti(reducedMotion: boolean) {
  if (reducedMotion || typeof window === 'undefined' || typeof HTMLCanvasElement === 'undefined') {
    return false
  }
  if (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)) {
    return false
  }
  try {
    const probe = document.createElement('canvas')
    return typeof probe.getContext === 'function' && probe.getContext('2d') != null
  } catch {
    return false
  }
}

function runPreset(
  launch: ReturnType<typeof confetti.create>,
  preset: CelebrationPresetDefinition,
  amount: number,
  durationMs: number,
) {
  activeRunId += 1
  clearScheduledWork()
  const runId = activeRunId
  const startedAt = Date.now()
  const tickIntervalMs = Math.max(60, Math.round(1000 / Math.min(preset.speed, 1000)))

  const shoot = () => {
    if (runId !== activeRunId) return
    const elapsedMs = Date.now() - startedAt
    const elapsedRatio = clamp(elapsedMs / durationMs, 0, 1)
    const intensity = clamp(amount * (0.72 + elapsedRatio * 0.9), 0.2, 3.2)
    const phase = Math.min(3, Math.floor(elapsedRatio * 4))
    preset.tick(launch, {
      amount,
      elapsedRatio,
      intensity,
      phase,
    })
  }

  shoot()
  const intervalId = scheduleInterval(shoot, tickIntervalMs)
  scheduleTimeout(() => {
    if (runId !== activeRunId) return
    window.clearInterval(intervalId)
    scheduledIntervals.delete(intervalId)
  }, durationMs)
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
  const {
    preset,
    reducedMotion,
    amount = DEFAULT_AMOUNT,
    durationMs,
    scenario = DEFAULT_SCENARIO,
  } = args
  if (!canEmitConfetti(reducedMotion)) return
  const launch = ensureLauncher()
  if (!launch) return

  const definition = PRESET_DEFINITIONS[preset]
  const normalizedAmount = clamp(
    scenario === 'preview' ? Math.max(amount, PREVIEW_AMOUNT) : amount,
    0,
    3,
  )
  const resolvedDuration = resolveDurationMs(definition, normalizedAmount, scenario, durationMs)
  runPreset(launch, definition, normalizedAmount, resolvedDuration)
}

export function __resetCelebrationEngineForTests() {
  activeRunId += 1
  clearScheduledWork()
  sharedCanvas?.remove()
  sharedCanvas = null
  sharedLauncher = null
}
