import { createCanvas2dRenderer } from './canvas2dRenderer'
import { createParticle, stepParticle, type Particle, type ParticleRenderer, type ParticleSpec } from './particleModel'
import { createWebglRenderer } from './webglRenderer'

export {
  createParticle,
  particleAlpha,
  stepParticle,
  type Hsl,
  type Particle,
  type ParticleShape,
  type ParticleSpec,
  type Point,
} from './particleModel'

/* ---------- runtime: one shared canvas, idle when empty ---------- */

const CANVAS_ID = 'memory-anki-particle-canvas'
const MAX_FRAME_MS = 50

let canvas: HTMLCanvasElement | null = null
let renderer: ParticleRenderer | null = null
let listening = false
let running = false
let lastFrame = 0
const live: Particle[] = []

export function prefersReducedParticleMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function resize() {
  if (!renderer) return
  renderer.resize(window.innerWidth, window.innerHeight, Math.min(2, window.devicePixelRatio || 1))
}

function mountCanvas() {
  const element = document.createElement('canvas')
  element.id = CANVAS_ID
  element.setAttribute('aria-hidden', 'true')
  Object.assign(element.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: '2147483646',
  })
  document.body.appendChild(element)
  return element
}

function fallBackToCanvas2d() {
  // A canvas that ever held a WebGL context cannot hand out a 2D one.
  canvas?.remove()
  canvas = mountCanvas()
  renderer = createCanvas2dRenderer(canvas)
  resize()
}

function ensureRenderer() {
  if (renderer) return renderer
  if (typeof document === 'undefined' || !document.body) return null
  // No Web Animations means no real compositor either (jsdom): stay silent.
  if (typeof document.body.animate !== 'function') return null
  canvas = mountCanvas()
  renderer = createWebglRenderer(canvas, fallBackToCanvas2d)
  if (!renderer) fallBackToCanvas2d()
  if (!renderer) return null
  resize()
  if (!listening) {
    listening = true
    window.addEventListener('resize', resize)
    // A background tab would otherwise resume with one giant catch-up frame.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) live.length = 0
    })
  }
  return renderer
}

function frame(now: number) {
  const active = renderer
  if (!active) {
    running = false
    return
  }
  const ms = Math.min(MAX_FRAME_MS, now - lastFrame)
  lastFrame = now
  const frames = ms / (1000 / 60)
  const seconds = ms / 1000
  for (let i = live.length - 1; i >= 0; i -= 1) {
    const p = live[i]
    stepParticle(p, frames, seconds)
    if (p.done) {
      live.splice(i, 1)
      continue
    }
    if (p.shed && p.delay <= 0 && Math.random() < p.shed) {
      spawnParticle({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 1.2, vy: Math.random() * 1.2 - 0.4, gravity: 0.03, drag: 0.96, size: 0.8 + Math.random(), color: p.color, shape: 'glow', additive: true, life: 0.4 + Math.random() * 0.4, twinkle: true })
    }
  }
  active.render(live)
  if (live.length > 0) {
    window.requestAnimationFrame(frame)
  } else {
    running = false
  }
}

export function spawnParticle(spec: ParticleSpec) {
  const active = ensureRenderer()
  if (!active || live.length >= active.capacity) return false
  live.push(createParticle(spec))
  if (!running && typeof window.requestAnimationFrame === 'function') {
    running = true
    lastFrame = performance.now()
    window.requestAnimationFrame(frame)
  }
  return true
}

export function liveParticleCount() {
  return live.length
}

export function particleRendererKind() {
  return renderer?.kind ?? null
}

export function clearParticles() {
  live.length = 0
  renderer?.clear()
}
