import { particleAlpha, particleRingRadius, type Hsl, type Particle, type ParticleRenderer } from './particleModel'

export function createCanvas2dRenderer(canvas: HTMLCanvasElement): ParticleRenderer | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const sprites = new Map<string, HTMLCanvasElement>()
  let width = 0
  let height = 0

  function sprite([h, s, l]: Hsl) {
    const key = `${h}|${s}|${l}`
    const cached = sprites.get(key)
    if (cached) return cached
    const element = document.createElement('canvas')
    element.width = element.height = 64
    const spriteCtx = element.getContext('2d')
    if (spriteCtx) {
      const gradient = spriteCtx.createRadialGradient(32, 32, 0, 32, 32, 32)
      gradient.addColorStop(0, `hsla(${h},${s}%,${Math.min(97, l + 32)}%,1)`)
      gradient.addColorStop(0.22, `hsla(${h},${s}%,${l}%,0.85)`)
      gradient.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`)
      spriteCtx.fillStyle = gradient
      spriteCtx.fillRect(0, 0, 64, 64)
    }
    sprites.set(key, element)
    return element
  }

  function draw(p: Particle) {
    const alpha = particleAlpha(p)
    if (alpha <= 0.01) return
    const [h, s, l] = p.color
    ctx!.globalAlpha = alpha
    if (p.trailPoints.length > 3) {
      ctx!.strokeStyle = `hsla(${h},${s}%,${l}%,0.55)`
      ctx!.lineWidth = p.size * 0.9
      ctx!.lineCap = 'round'
      ctx!.beginPath()
      ctx!.moveTo(p.trailPoints[0], p.trailPoints[1])
      for (let i = 2; i < p.trailPoints.length; i += 2) ctx!.lineTo(p.trailPoints[i], p.trailPoints[i + 1])
      ctx!.stroke()
    }
    switch (p.shape) {
      case 'glow': {
        const r = p.size * 4
        ctx!.drawImage(sprite(p.color), p.x - r, p.y - r, r * 2, r * 2)
        break
      }
      case 'flake': {
        const face = Math.cos(p.flip)
        ctx!.save()
        ctx!.translate(p.x, p.y)
        ctx!.rotate(p.rotation)
        ctx!.scale(1, face)
        ctx!.fillStyle = `hsl(${h},${s}%,${face < 0 ? l - 12 : l}%)`
        ctx!.fillRect(-p.size, -p.size * 0.62, p.size * 2, p.size * 1.24)
        ctx!.restore()
        break
      }
      case 'star': {
        ctx!.save()
        ctx!.translate(p.x, p.y)
        ctx!.rotate(p.rotation)
        ctx!.fillStyle = `hsl(${h},${s}%,${Math.min(96, l + 10)}%)`
        ctx!.beginPath()
        for (let i = 0; i < 8; i += 1) {
          const radius = i % 2 ? p.size * 0.32 : p.size
          const angle = (i * Math.PI) / 4
          ctx!.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
        }
        ctx!.closePath()
        ctx!.fill()
        ctx!.restore()
        break
      }
      case 'ring': {
        const t = p.age / p.life
        const radius = particleRingRadius(p, { from: 8, to: 80 })
        ctx!.strokeStyle = `hsl(${h},${s}%,${l}%)`
        ctx!.lineWidth = Math.max(0.5, p.size * (1 - t))
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, radius, 0, Math.PI * 2)
        ctx!.stroke()
        break
      }
      case 'bloom': {
        const radius = particleRingRadius(p, { from: 4, to: 40 })
        const gradient = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
        gradient.addColorStop(0, `hsla(${h},${s}%,${l}%,0.34)`)
        gradient.addColorStop(0.7, `hsla(${h},${s}%,${l}%,0.14)`)
        gradient.addColorStop(1, `hsla(${h},${s}%,${l}%,0)`)
        ctx!.fillStyle = gradient
        ctx!.beginPath()
        ctx!.ellipse(p.x, p.y, radius, radius * 0.32, 0, 0, Math.PI * 2)
        ctx!.fill()
        break
      }
      default:
        ctx!.fillStyle = `hsl(${h},${s}%,${l}%)`
        ctx!.beginPath()
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx!.fill()
    }
  }

  return {
    kind: 'canvas2d',
    capacity: 900,
    resize(nextWidth, nextHeight, ratio) {
      width = nextWidth
      height = nextHeight
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    },
    render(particles) {
      ctx.clearRect(0, 0, width, height)
      ctx.globalCompositeOperation = 'source-over'
      for (const p of particles) if (!p.additive && p.delay <= 0) draw(p)
      ctx.globalCompositeOperation = 'lighter'
      for (const p of particles) if (p.additive && p.delay <= 0) draw(p)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
    },
    clear() {
      ctx.clearRect(0, 0, width, height)
    },
  }
}
