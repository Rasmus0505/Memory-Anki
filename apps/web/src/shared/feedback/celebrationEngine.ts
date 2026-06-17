import confetti from 'canvas-confetti'

export type CelebrationPreset =
  | 'random_direction'
  | 'realistic_look'
  | 'fireworks'
  | 'stars'
  | 'school_pride'

interface CelebrationBurst {
  angle?: number
  colors?: string[]
  delayMs?: number
  drift?: number
  gravity?: number
  origin: {
    x: number
    y: number
  }
  particleCount: number
  scalar?: number
  shapes?: Array<'square' | 'circle' | 'star'>
  spread: number
  startVelocity: number
  ticks?: number
}

interface CelebrationStep {
  bursts: CelebrationBurst[]
}

const GLOBAL_CONFETTI_CANVAS_ID = 'memory-anki-global-confetti-canvas'
const GLOBAL_CONFETTI_Z_INDEX = '2147483647'

let sharedCanvas: HTMLCanvasElement | null = null
let sharedLauncher: ReturnType<typeof confetti.create> | null = null

function edgeBurst(
  x: number,
  y: number,
  angle: number,
  particleCount: number,
  spread: number,
  startVelocity: number,
  options: Omit<CelebrationBurst, 'origin' | 'angle' | 'particleCount' | 'spread' | 'startVelocity'> = {},
): CelebrationBurst {
  return {
    origin: { x, y },
    angle,
    particleCount,
    spread,
    startVelocity,
    ...options,
  }
}

const PRESET_STEPS: Record<CelebrationPreset, CelebrationStep[]> = {
  random_direction: [
    {
      bursts: [
        edgeBurst(0.04, 0.92, 58, 18, 28, 22, { scalar: 0.82, ticks: 90 }),
        edgeBurst(0.96, 0.92, 122, 18, 28, 22, { scalar: 0.82, ticks: 90 }),
      ],
    },
  ],
  realistic_look: [
    {
      bursts: [
        edgeBurst(0.03, 0.9, 52, 26, 40, 28, {
          scalar: 0.92,
          ticks: 112,
          gravity: 1.02,
          drift: 0.08,
        }),
        edgeBurst(0.97, 0.9, 128, 26, 40, 28, {
          scalar: 0.92,
          ticks: 112,
          gravity: 1.02,
          drift: -0.08,
        }),
        edgeBurst(0.5, 0.96, 90, 18, 24, 24, {
          scalar: 0.8,
          ticks: 96,
          delayMs: 42,
        }),
      ],
    },
  ],
  fireworks: [
    {
      bursts: [
        edgeBurst(0.02, 0.88, 48, 34, 54, 34, { scalar: 1, ticks: 132 }),
        edgeBurst(0.98, 0.88, 132, 34, 54, 34, { scalar: 1, ticks: 132 }),
        edgeBurst(0.16, 0.96, 74, 24, 30, 28, { scalar: 0.9, ticks: 118, delayMs: 34 }),
        edgeBurst(0.84, 0.96, 106, 24, 30, 28, { scalar: 0.9, ticks: 118, delayMs: 34 }),
        edgeBurst(0.5, 0.04, 270, 30, 56, 30, { scalar: 0.94, ticks: 128, delayMs: 74 }),
      ],
    },
  ],
  stars: [
    {
      bursts: [
        edgeBurst(0.02, 0.86, 46, 38, 58, 36, {
          scalar: 1.04,
          ticks: 138,
          shapes: ['star'],
          colors: ['#f59e0b', '#fcd34d', '#fde68a', '#fff7ed'],
        }),
        edgeBurst(0.98, 0.86, 134, 38, 58, 36, {
          scalar: 1.04,
          ticks: 138,
          shapes: ['star'],
          colors: ['#38bdf8', '#7dd3fc', '#bfdbfe', '#eff6ff'],
        }),
        edgeBurst(0.5, 0.03, 270, 42, 68, 34, {
          scalar: 1,
          ticks: 140,
          shapes: ['star'],
          colors: ['#f472b6', '#f9a8d4', '#c084fc', '#f5f3ff'],
          delayMs: 82,
        }),
      ],
    },
  ],
  school_pride: [
    {
      bursts: [
        edgeBurst(0.02, 0.84, 44, 46, 62, 38, {
          scalar: 1.1,
          ticks: 148,
          colors: ['#2563eb', '#ffffff', '#dc2626'],
        }),
        edgeBurst(0.98, 0.84, 136, 46, 62, 38, {
          scalar: 1.1,
          ticks: 148,
          colors: ['#2563eb', '#ffffff', '#dc2626'],
        }),
        edgeBurst(0.12, 0.96, 72, 32, 36, 30, {
          scalar: 0.94,
          ticks: 124,
          colors: ['#1d4ed8', '#bfdbfe', '#ffffff'],
          delayMs: 36,
        }),
        edgeBurst(0.88, 0.96, 108, 32, 36, 30, {
          scalar: 0.94,
          ticks: 124,
          colors: ['#b91c1c', '#fecaca', '#ffffff'],
          delayMs: 36,
        }),
        edgeBurst(0.5, 0.02, 270, 54, 74, 36, {
          scalar: 1.06,
          ticks: 150,
          colors: ['#2563eb', '#ffffff', '#dc2626'],
          delayMs: 72,
        }),
      ],
    },
  ],
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

function emitBurst(
  launch: ReturnType<typeof confetti.create>,
  burst: CelebrationBurst,
) {
  const fire = () =>
    launch({
      angle: burst.angle,
      colors: burst.colors,
      decay: 0.92,
      disableForReducedMotion: true,
      drift: burst.drift ?? 0,
      gravity: burst.gravity ?? 1,
      origin: burst.origin,
      particleCount: burst.particleCount,
      scalar: burst.scalar ?? 1,
      shapes: burst.shapes,
      spread: burst.spread,
      startVelocity: burst.startVelocity,
      ticks: burst.ticks ?? 120,
    })

  if ((burst.delayMs ?? 0) > 0) {
    window.setTimeout(() => {
      void fire()
    }, burst.delayMs)
    return
  }
  void fire()
}

export function getCelebrationSteps(preset: CelebrationPreset) {
  return PRESET_STEPS[preset]
}

export function launchCelebrationPreset(args: {
  preset: CelebrationPreset
  reducedMotion: boolean
}) {
  const { preset, reducedMotion } = args
  if (!canEmitConfetti(reducedMotion)) return
  const launch = ensureLauncher()
  if (!launch) return

  for (const step of PRESET_STEPS[preset]) {
    for (const burst of step.bursts) {
      emitBurst(launch, burst)
    }
  }
}

export function __resetCelebrationEngineForTests() {
  sharedCanvas?.remove()
  sharedCanvas = null
  sharedLauncher = null
}
