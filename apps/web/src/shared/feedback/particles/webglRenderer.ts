import { particleAlpha, particleRingRadius, type Particle, type ParticleRenderer } from './particleModel'
import { compileProgram, createTarget, hslToRgb, sizeTarget, type RenderTarget } from './webglResources'
import { BLUR_FRAGMENT, FULLSCREEN_VERTEX, PARTICLE_FRAGMENT, PARTICLE_VERTEX } from './webglShaders'

const FLOATS = 12
const STRIDE = FLOATS * 4
const BLOOM_GAIN = 0.6
const BLOOM_PASSES = 2
const SHAPE = { dot: 0, glow: 1, flake: 2, star: 3, ring: 4, bloom: 5, capsule: 6 } as const

interface BloomChain {
  program: WebGLProgram
  vao: WebGLVertexArrayObject
  half: RenderTarget
  quarterA: RenderTarget
  quarterB: RenderTarget
  uDir: WebGLUniformLocation | null
  uGain: WebGLUniformLocation | null
}

export function createWebglRenderer(canvas: HTMLCanvasElement, onContextLost: () => void): ParticleRenderer | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  })
  if (!gl) return null
  const program = compileProgram(gl, PARTICLE_VERTEX, PARTICLE_FRAGMENT)
  const vao = gl.createVertexArray()
  const cornerBuffer = gl.createBuffer()
  const instanceBuffer = gl.createBuffer()
  if (!program || !vao || !cornerBuffer || !instanceBuffer) return null
  const uResolution = gl.getUniformLocation(program, 'u_resolution')

  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.bindVertexArray(vao)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
  for (let location = 1; location <= 3; location += 1) {
    gl.enableVertexAttribArray(location)
    gl.vertexAttribDivisor(location, 1)
  }
  const pointInstances = (firstInstance: number) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
    const base = firstInstance * STRIDE
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STRIDE, base)
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE, base + 16)
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, STRIDE, base + 32)
  }
  pointInstances(0)
  gl.bindVertexArray(null)

  const bloom = createBloomChain(gl, cornerBuffer)
  let data = new Float32Array(4096 * FLOATS)
  let count = 0
  let cssWidth = 1
  let cssHeight = 1
  let lost = false

  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    lost = true
    onContextLost()
  })

  function push(x: number, y: number, hx: number, hy: number, rot: number, shape: number, p0: number, p1: number, rgb: readonly number[], a: number) {
    if ((count + 1) * FLOATS > data.length) {
      const grown = new Float32Array(data.length * 2)
      grown.set(data)
      data = grown
    }
    const o = count * FLOATS
    data[o] = x; data[o + 1] = y; data[o + 2] = hx; data[o + 3] = hy
    data[o + 4] = rot; data[o + 5] = shape; data[o + 6] = p0; data[o + 7] = p1
    data[o + 8] = rgb[0]; data[o + 9] = rgb[1]; data[o + 10] = rgb[2]; data[o + 11] = a
    count += 1
  }

  function writeParticle(p: Particle) {
    const alpha = particleAlpha(p)
    if (alpha <= 0.01) return
    const [h, s, l] = p.color
    const rgb = hslToRgb(p.color)
    const points = p.trailPoints
    if (points.length > 3) {
      // Comet tail: capsules that thin and fade towards the oldest point.
      const segments = points.length / 2 - 1
      for (let i = 0; i < segments; i += 1) {
        const x0 = points[i * 2], y0 = points[i * 2 + 1], x1 = points[i * 2 + 2], y1 = points[i * 2 + 3]
        const halfLength = Math.hypot(x1 - x0, y1 - y0) / 2
        const progress = (i + 1) / segments
        const radius = Math.max(0.35, p.size * 0.45 * (0.3 + 0.7 * progress))
        push((x0 + x1) / 2, (y0 + y1) / 2, halfLength + radius + 1, radius + 1, Math.atan2(y1 - y0, x1 - x0), SHAPE.capsule, halfLength, radius, rgb, alpha * 0.55 * progress)
      }
    }
    switch (p.shape) {
      case 'glow': {
        const r = p.size * 4
        push(p.x, p.y, r, r, 0, SHAPE.glow, 0, 0, rgb, alpha)
        break
      }
      case 'flake': {
        const face = Math.cos(p.flip)
        const hy = Math.max(0.3, p.size * 0.62 * Math.abs(face))
        push(p.x, p.y, p.size + 1.5, hy + 1.5, p.rotation, SHAPE.flake, p.size, hy, face < 0 ? hslToRgb([h, s, l - 12]) : rgb, alpha)
        break
      }
      case 'star':
        push(p.x, p.y, p.size + 2, p.size + 2, p.rotation, SHAPE.star, p.size, 0, hslToRgb([h, s, Math.min(96, l + 10)]), alpha)
        break
      case 'ring': {
        const radius = particleRingRadius(p, { from: 8, to: 80 })
        const lineWidth = Math.max(0.5, p.size * (1 - p.age / p.life))
        const half = radius + lineWidth + 2
        push(p.x, p.y, half, half, 0, SHAPE.ring, radius, lineWidth, rgb, alpha)
        break
      }
      case 'bloom': {
        const radius = particleRingRadius(p, { from: 4, to: 40 })
        push(p.x, p.y, radius, radius * 0.32, 0, SHAPE.bloom, 0, 0, rgb, alpha)
        break
      }
      default:
        push(p.x, p.y, p.size + 1.5, p.size + 1.5, 0, SHAPE.dot, p.size, 0, rgb, alpha)
    }
  }

  function drawInstances(first: number, instances: number, width: number, height: number) {
    if (instances <= 0) return
    gl!.useProgram(program)
    gl!.uniform2f(uResolution, cssWidth, cssHeight)
    gl!.viewport(0, 0, width, height)
    gl!.bindVertexArray(vao)
    pointInstances(first)
    gl!.drawArraysInstanced(gl!.TRIANGLE_STRIP, 0, 4, instances)
    gl!.bindVertexArray(null)
  }

  function runBloom(first: number, instances: number) {
    if (!bloom) return
    const { half, quarterA, quarterB } = bloom
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, half.framebuffer)
    gl!.viewport(0, 0, half.width, half.height)
    gl!.clearColor(0, 0, 0, 0)
    gl!.clear(gl!.COLOR_BUFFER_BIT)
    gl!.blendFunc(gl!.ONE, gl!.ONE)
    drawInstances(first, instances, half.width, half.height)
    gl!.disable(gl!.BLEND)
    fullscreen(bloom, half, quarterA, 0, 0, 1)
    for (let pass = 0; pass < BLOOM_PASSES; pass += 1) {
      fullscreen(bloom, quarterA, quarterB, 1 / quarterA.width, 0, 1)
      fullscreen(bloom, quarterB, quarterA, 0, 1 / quarterA.height, 1)
    }
    gl!.enable(gl!.BLEND)
    gl!.blendFunc(gl!.ONE, gl!.ONE)
    fullscreen(bloom, quarterA, null, 0, 0, BLOOM_GAIN)
  }

  function fullscreen(chain: BloomChain, source: RenderTarget, target: RenderTarget | null, dx: number, dy: number, gain: number) {
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, target ? target.framebuffer : null)
    gl!.viewport(0, 0, target ? target.width : canvas.width, target ? target.height : canvas.height)
    gl!.useProgram(chain.program)
    gl!.activeTexture(gl!.TEXTURE0)
    gl!.bindTexture(gl!.TEXTURE_2D, source.texture)
    gl!.uniform2f(chain.uDir, dx, dy)
    gl!.uniform1f(chain.uGain, gain)
    gl!.bindVertexArray(chain.vao)
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4)
    gl!.bindVertexArray(null)
  }

  return {
    kind: 'webgl',
    capacity: 2400,
    resize(width, height, ratio) {
      cssWidth = Math.max(1, width)
      cssHeight = Math.max(1, height)
      canvas.width = Math.round(cssWidth * ratio)
      canvas.height = Math.round(cssHeight * ratio)
      if (bloom) {
        sizeTarget(gl, bloom.half, canvas.width / 2, canvas.height / 2)
        sizeTarget(gl, bloom.quarterA, canvas.width / 4, canvas.height / 4)
        sizeTarget(gl, bloom.quarterB, canvas.width / 4, canvas.height / 4)
      }
    },
    render(particles) {
      if (lost) return
      count = 0
      for (const p of particles) if (!p.additive && p.delay <= 0) writeParticle(p)
      const normalCount = count
      for (const p of particles) if (p.additive && p.delay <= 0) writeParticle(p)
      const additiveCount = count - normalCount
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      if (count === 0) return
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * FLOATS), gl.DYNAMIC_DRAW)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      drawInstances(0, normalCount, canvas.width, canvas.height)
      if (additiveCount > 0) {
        gl.blendFunc(gl.ONE, gl.ONE)
        drawInstances(normalCount, additiveCount, canvas.width, canvas.height)
        runBloom(normalCount, additiveCount)
      }
      gl.disable(gl.BLEND)
    },
    clear() {
      if (lost) return
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    },
  }
}

function createBloomChain(gl: WebGL2RenderingContext, cornerBuffer: WebGLBuffer): BloomChain | null {
  const program = compileProgram(gl, FULLSCREEN_VERTEX, BLUR_FRAGMENT)
  const vao = gl.createVertexArray()
  const half = createTarget(gl)
  const quarterA = createTarget(gl)
  const quarterB = createTarget(gl)
  if (!program || !vao || !half || !quarterA || !quarterB) return null
  gl.bindVertexArray(vao)
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  gl.useProgram(program)
  gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0)
  return {
    program,
    vao,
    half,
    quarterA,
    quarterB,
    uDir: gl.getUniformLocation(program, 'u_dir'),
    uGain: gl.getUniformLocation(program, 'u_gain'),
  }
}
