export interface Mote {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  depth: number
  phase: number
}

const REPEL_RADIUS = 110
const REPEL_FORCE = 0.06
const MAX_SPEED = 0.5

export function createMote(width: number, height: number, random: () => number = Math.random): Mote {
  const depth = 0.35 + random() * 0.65
  return {
    x: random() * width,
    y: random() * height,
    vx: (random() - 0.5) * 0.12 * depth,
    vy: -(0.03 + random() * 0.08) * depth,
    radius: 0.6 + random() * 1.6 * depth,
    depth,
    phase: random() * Math.PI * 2,
  }
}

/** Advances one mote by `frames` 60fps frames; pure so drift and repel are testable. */
export function stepMote(mote: Mote, frames: number, time: number, width: number, height: number, pointer: { x: number; y: number } | null) {
  mote.vx += Math.sin(time * 0.35 + mote.phase) * 0.0018 * frames
  if (pointer) {
    const dx = mote.x - pointer.x
    const dy = mote.y - pointer.y
    const distance = Math.hypot(dx, dy)
    if (distance > 0.001 && distance < REPEL_RADIUS) {
      const push = (1 - distance / REPEL_RADIUS) * REPEL_FORCE * mote.depth * frames
      mote.vx += (dx / distance) * push
      mote.vy += (dy / distance) * push
    }
  }
  const speed = Math.hypot(mote.vx, mote.vy)
  if (speed > MAX_SPEED) {
    mote.vx = (mote.vx / speed) * MAX_SPEED
    mote.vy = (mote.vy / speed) * MAX_SPEED
  }
  // Ease back towards the lazy upward drift once the pointer has passed.
  mote.vx *= Math.pow(0.992, frames)
  mote.vy += (-0.05 * mote.depth - mote.vy) * 0.01 * frames
  mote.x += mote.vx * frames
  mote.y += mote.vy * frames
  const margin = 12
  if (mote.y < -margin) mote.y = height + margin
  if (mote.y > height + margin) mote.y = -margin
  if (mote.x < -margin) mote.x = width + margin
  if (mote.x > width + margin) mote.x = -margin
}

export function moteAlpha(mote: Mote, time: number) {
  return (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 0.8 + mote.phase * 3))) * mote.depth
}

export interface DustMotesController {
  start(): void
  stop(): void
  destroy(): void
}

export function createDustMotes(canvas: HTMLCanvasElement, count: number): DustMotesController | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  let width = 0
  let height = 0
  let motes: Mote[] = []
  let pointer: { x: number; y: number } | null = null
  let frameId = 0
  let last = 0
  let skip = false

  const resize = () => {
    const ratio = Math.min(2, window.devicePixelRatio || 1)
    width = window.innerWidth
    height = window.innerHeight
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    if (motes.length !== count) motes = Array.from({ length: count }, () => createMote(width, height))
  }
  const onPointer = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY }
  }
  const onLeave = () => {
    pointer = null
  }

  const frame = (now: number) => {
    frameId = window.requestAnimationFrame(frame)
    // 30fps is plenty for motes this slow and halves the idle cost.
    skip = !skip
    if (skip) return
    const frames = Math.min(4, (now - last) / (1000 / 60))
    last = now
    const time = now / 1000
    const dark = document.documentElement.classList.contains('dark')
    const [h, s, l] = dark ? [40, 90, 72] : [32, 78, 52]
    ctx.clearRect(0, 0, width, height)
    for (const mote of motes) {
      stepMote(mote, frames, time, width, height, pointer)
      const alpha = moteAlpha(mote, time) * (dark ? 0.5 : 0.32)
      const r = mote.radius * 3
      const gradient = ctx.createRadialGradient(mote.x, mote.y, 0, mote.x, mote.y, r)
      gradient.addColorStop(0, `hsla(${h},${s}%,${l + 14}%,${alpha})`)
      gradient.addColorStop(0.35, `hsla(${h},${s}%,${l}%,${alpha * 0.55})`)
      gradient.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`)
      ctx.fillStyle = gradient
      ctx.fillRect(mote.x - r, mote.y - r, r * 2, r * 2)
    }
  }

  return {
    start() {
      if (frameId) return
      resize()
      window.addEventListener('resize', resize)
      window.addEventListener('pointermove', onPointer, { passive: true })
      window.addEventListener('pointerleave', onLeave)
      document.addEventListener('pointerleave', onLeave)
      last = performance.now()
      frameId = window.requestAnimationFrame(frame)
    },
    stop() {
      if (!frameId) return
      window.cancelAnimationFrame(frameId)
      frameId = 0
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointer)
      window.removeEventListener('pointerleave', onLeave)
      document.removeEventListener('pointerleave', onLeave)
      ctx.clearRect(0, 0, width, height)
    },
    destroy() {
      this.stop()
      motes = []
    },
  }
}
