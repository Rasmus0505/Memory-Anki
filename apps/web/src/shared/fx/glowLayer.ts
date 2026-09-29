import { createCanvas2dRenderer } from './particles/canvas2dRenderer'
import { createParticle, type Hsl, type Particle, type ParticleRenderer } from './particles/particleModel'
import { createWebglRenderer } from './particles/webglRenderer'

/** One steady glowing point; the host owns position and brightness every frame. */
export interface GlowPoint {
  x: number
  y: number
  size: number
  alpha: number
  color: Hsl
}

export interface GlowLayer {
  readonly kind: 'webgl' | 'canvas2d'
  resize(width: number, height: number): void
  draw(points: readonly GlowPoint[]): void
  destroy(): void
}

/**
 * A retained-mode glow canvas for static scenes (the starmap): the same bloom
 * renderer as the particle engine, but points never age. Falls back to Canvas2D.
 */
export function createGlowLayer(canvas: HTMLCanvasElement): GlowLayer | null {
  let renderer: ParticleRenderer | null = null
  let current = canvas
  const fallback = () => {
    // A canvas that ever held WebGL cannot hand out a 2D context: swap in a fresh one.
    const fresh = document.createElement('canvas')
    fresh.className = current.className
    fresh.setAttribute('aria-hidden', 'true')
    current.replaceWith(fresh)
    current = fresh
    renderer = createCanvas2dRenderer(fresh)
  }
  renderer = createWebglRenderer(canvas, fallback) ?? createCanvas2dRenderer(canvas)
  if (!renderer) return null
  const pool: Particle[] = []
  let width = 1
  let height = 1

  const particleAt = (index: number) => {
    let p = pool[index]
    if (!p) {
      p = createParticle({ x: 0, y: 0, life: 1e9, size: 1, color: [40, 90, 60], shape: 'glow', additive: true }, () => 0)
      pool[index] = p
    }
    return p
  }

  return {
    get kind() {
      return renderer?.kind ?? 'canvas2d'
    },
    resize(nextWidth, nextHeight) {
      width = Math.max(1, nextWidth)
      height = Math.max(1, nextHeight)
      renderer?.resize(width, height, Math.min(2, window.devicePixelRatio || 1))
    },
    draw(points) {
      if (!renderer) return
      const count = Math.min(points.length, renderer.capacity)
      const live: Particle[] = []
      for (let i = 0; i < count; i += 1) {
        const point = points[i]
        if (point.x < -40 || point.y < -40 || point.x > width + 40 || point.y > height + 40) continue
        const p = particleAt(live.length)
        p.x = point.x
        p.y = point.y
        p.size = point.size
        p.alpha = point.alpha
        p.color = point.color
        p.age = 0
        live.push(p)
      }
      renderer.render(live)
    },
    destroy() {
      renderer?.clear()
      renderer = null
    },
  }
}
