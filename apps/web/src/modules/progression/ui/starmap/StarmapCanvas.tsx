import { useEffect, useRef, useState } from 'react'
import { createGlowLayer, resolveFxGate, type GlowLayer, type GlowPoint } from '@/shared/fx'
import { hitStar, type Sky, type Star } from '../../domain/starmapLayout'

interface Camera {
  x: number
  y: number
  zoom: number
}

const MIN_ZOOM = 0.12
const MAX_ZOOM = 4
const TAP_SLOP_PX = 6
const FLY_MS = 620
const IDLE_FRAME_MS = 1000 / 30

const clampZoom = (zoom: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
const easeOut = (t: number) => 1 - (1 - t) ** 3

function fitCamera(sky: Sky, width: number, height: number): Camera {
  const { minX, minY, maxX, maxY } = sky.bounds
  const zoom = clampZoom(Math.min(width / (maxX - minX), height / (maxY - minY)) * 0.92)
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom }
}

function starColor(star: Star): [number, number, number] {
  return [star.hue, 78, 52 + star.brightness * 30]
}

/** Seeded background dust so the sky is never empty; drawn with slight parallax. */
function dust(count: number) {
  let seed = 11
  const next = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  return Array.from({ length: count }, () => ({ x: next() * 2 - 1, y: next() * 2 - 1, r: 0.4 + next() * 0.9, a: 0.08 + next() * 0.22 }))
}
const DUST = dust(140)

export function StarmapCanvas({
  sky,
  selectedKey,
  focusKey,
  onSelect,
  ariaLabel,
}: {
  sky: Sky
  selectedKey: string | null
  /** Changing this flies the camera to that star (or back to the whole sky when null). */
  focusKey: string | null
  onSelect: (star: Star | null) => void
  ariaLabel: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<HTMLCanvasElement>(null)
  const glowRef = useRef<HTMLCanvasElement>(null)
  const labelsRef = useRef<HTMLCanvasElement>(null)
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 })
  const sizeRef = useRef({ width: 1, height: 1 })
  const flightRef = useRef<{ from: Camera; to: Camera; start: number } | null>(null)
  const dirtyRef = useRef(true)
  const hoverRef = useRef<Star | null>(null)
  const selectedRef = useRef(selectedKey)
  const skyRef = useRef(sky)
  const [hover, setHover] = useState<{ star: Star; x: number; y: number } | null>(null)
  selectedRef.current = selectedKey
  skyRef.current = sky

  const toScreen = (x: number, y: number) => {
    const cam = cameraRef.current
    const { width, height } = sizeRef.current
    return { x: (x - cam.x) * cam.zoom + width / 2, y: (y - cam.y) * cam.zoom + height / 2 }
  }
  const toWorld = (x: number, y: number) => {
    const cam = cameraRef.current
    const { width, height } = sizeRef.current
    return { x: (x - width / 2) / cam.zoom + cam.x, y: (y - height / 2) / cam.zoom + cam.y }
  }

  // Render loop: full rate while the camera moves, ~30fps for twinkle, idle otherwise.
  useEffect(() => {
    const host = hostRef.current
    const glowCanvas = glowRef.current
    if (!host || !glowCanvas) return
    const layer: GlowLayer | null = createGlowLayer(glowCanvas)
    let frame = 0
    let last = 0
    const motion = resolveFxGate('ambient').motion
    const points: GlowPoint[] = []

    const resize = () => {
      const rect = host.getBoundingClientRect()
      const width = Math.max(1, rect.width)
      const height = Math.max(1, rect.height)
      const first = sizeRef.current.width === 1
      sizeRef.current = { width, height }
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      for (const canvas of [linesRef.current, labelsRef.current]) {
        if (!canvas) continue
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
        canvas.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0)
      }
      layer?.resize(width, height)
      if (first) cameraRef.current = fitCamera(skyRef.current, width, height)
      dirtyRef.current = true
    }

    const draw = (now: number) => {
      const current = skyRef.current
      const { width, height } = sizeRef.current
      const cam = cameraRef.current
      const lines = linesRef.current?.getContext('2d')
      const labels = labelsRef.current?.getContext('2d')
      const byKey = new Map(current.stars.map((star) => [star.key, star]))
      if (lines) {
        lines.clearRect(0, 0, width, height)
        for (const mote of DUST) {
          const x = width / 2 + mote.x * width * 0.7 - (cam.x * cam.zoom) * 0.08
          const y = height / 2 + mote.y * height * 0.7 - (cam.y * cam.zoom) * 0.08
          lines.fillStyle = `hsla(36, 60%, 86%, ${mote.a})`
          lines.beginPath()
          lines.arc(((x % width) + width) % width, ((y % height) + height) % height, mote.r, 0, Math.PI * 2)
          lines.fill()
        }
        lines.lineWidth = 1
        for (const link of current.links) {
          const a = byKey.get(link.from)
          const b = byKey.get(link.to)
          if (!a || !b) continue
          const p = toScreen(a.x, a.y)
          const q = toScreen(b.x, b.y)
          lines.strokeStyle = `hsla(${b.hue}, 60%, 74%, ${0.06 + link.strength * 0.2})`
          lines.beginPath()
          lines.moveTo(p.x, p.y)
          lines.lineTo(q.x, q.y)
          lines.stroke()
        }
      }
      points.length = 0
      const t = now / 1000
      const scale = Math.pow(cam.zoom, 0.6)
      for (const star of current.stars) {
        const p = toScreen(star.x, star.y)
        const flicker = star.twinkle && motion ? 0.7 + 0.3 * Math.sin(t * 2.4 + star.id * 1.7) : 1
        const size = Math.max(1.1, star.size * scale * 0.55)
        const alpha = (0.22 + star.brightness * 0.78) * flicker
        points.push({ x: p.x, y: p.y, size, alpha, color: starColor(star) })
        if (star.stars === 3 && star.kind !== 'subject') {
          points.push({ x: p.x, y: p.y, size: size * 2.6, alpha: alpha * 0.18, color: [42, 90, 70] })
        }
      }
      layer?.draw(points)
      if (labels) {
        labels.clearRect(0, 0, width, height)
        labels.textAlign = 'center'
        labels.textBaseline = 'top'
        const selected = selectedRef.current
        for (const star of current.stars) {
          const emphasised = star.key === selected || star.key === hoverRef.current?.key
          const show = star.kind === 'subject' || emphasised || (star.kind === 'chapter' && cam.zoom > 0.85)
          if (!show) continue
          const p = toScreen(star.x, star.y)
          const offset = Math.max(6, star.size * scale * 0.7) + 4
          labels.font = star.kind === 'subject' ? '700 14px Nunito, "Noto Sans SC", sans-serif' : '600 12px Nunito, "Noto Sans SC", sans-serif'
          labels.fillStyle = star.kind === 'subject' ? 'hsla(40, 80%, 88%, 0.92)' : `hsla(38, 60%, 88%, ${emphasised ? 0.95 : 0.62})`
          labels.fillText(star.label.length > 14 ? `${star.label.slice(0, 13)}…` : star.label, p.x, p.y + offset)
          if (star.key === selected) {
            // Four cream ticks, never a ring.
            const r = offset + 2
            labels.strokeStyle = 'hsla(40, 70%, 90%, 0.85)'
            labels.lineWidth = 1.5
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              labels.beginPath()
              labels.moveTo(p.x + dx * r, p.y + dy * r)
              labels.lineTo(p.x + dx * (r + 5), p.y + dy * (r + 5))
              labels.stroke()
            }
          }
        }
      }
    }

    const tick = (now: number) => {
      frame = window.requestAnimationFrame(tick)
      if (document.hidden) return
      const flight = flightRef.current
      if (flight) {
        const k = easeOut(Math.min(1, (now - flight.start) / FLY_MS))
        cameraRef.current = {
          x: flight.from.x + (flight.to.x - flight.from.x) * k,
          y: flight.from.y + (flight.to.y - flight.from.y) * k,
          zoom: flight.from.zoom + (flight.to.zoom - flight.from.zoom) * k,
        }
        if (k >= 1) flightRef.current = null
        dirtyRef.current = true
      }
      const twinkling = motion && skyRef.current.stars.some((star) => star.twinkle)
      if (!dirtyRef.current && !(twinkling && now - last >= IDLE_FRAME_MS)) return
      dirtyRef.current = false
      last = now
      draw(now)
    }

    resize()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
    observer?.observe(host)
    if (typeof window.requestAnimationFrame === 'function') frame = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      layer?.destroy()
    }
  }, [])

  useEffect(() => {
    dirtyRef.current = true
  }, [sky, selectedKey])

  useEffect(() => {
    const { width, height } = sizeRef.current
    const target = focusKey ? sky.stars.find((star) => star.key === focusKey) : null
    const to = target
      ? { x: target.x, y: target.y, zoom: clampZoom(target.kind === 'subject' ? 1 : target.kind === 'chapter' ? 1.6 : 2.4) }
      : fitCamera(sky, width, height)
    flightRef.current = resolveFxGate('ambient').motion
      ? { from: cameraRef.current, to, start: performance.now() }
      : null
    if (!flightRef.current) cameraRef.current = to
    dirtyRef.current = true
  }, [focusKey, sky])

  // Pointer: drag pans, wheel/pinch zooms about the pointer, a still tap selects.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ moved: number; pinch: number | null }>({ moved: 0, pinch: null })

  const localPoint = (event: { clientX: number; clientY: number }) => {
    const rect = hostRef.current?.getBoundingClientRect()
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
  }
  const zoomAbout = (point: { x: number; y: number }, factor: number) => {
    const before = toWorld(point.x, point.y)
    const cam = cameraRef.current
    cam.zoom = clampZoom(cam.zoom * factor)
    const after = toWorld(point.x, point.y)
    cam.x += before.x - after.x
    cam.y += before.y - after.y
    flightRef.current = null
    dirtyRef.current = true
  }

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={ariaLabel}
      tabIndex={0}
      data-testid="growth-starmap"
      className="growth-starmap relative h-full w-full touch-none select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId)
        pointers.current.set(event.pointerId, localPoint(event))
        gesture.current = { moved: 0, pinch: null }
      }}
      onPointerMove={(event) => {
        const point = localPoint(event)
        const previous = pointers.current.get(event.pointerId)
        if (!previous) {
          const world = toWorld(point.x, point.y)
          const star = hitStar(skyRef.current, world.x, world.y, 10 / cameraRef.current.zoom)
          if (star?.key !== hoverRef.current?.key) {
            hoverRef.current = star
            dirtyRef.current = true
            setHover(star ? { star, x: point.x, y: point.y } : null)
          }
          return
        }
        pointers.current.set(event.pointerId, point)
        if (pointers.current.size === 2) {
          const [a, b] = Array.from(pointers.current.values())
          const distance = Math.hypot(a.x - b.x, a.y - b.y)
          if (gesture.current.pinch) zoomAbout({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance / gesture.current.pinch)
          gesture.current.pinch = distance
          gesture.current.moved += TAP_SLOP_PX
          return
        }
        const dx = point.x - previous.x
        const dy = point.y - previous.y
        gesture.current.moved += Math.abs(dx) + Math.abs(dy)
        const cam = cameraRef.current
        cam.x -= dx / cam.zoom
        cam.y -= dy / cam.zoom
        flightRef.current = null
        dirtyRef.current = true
      }}
      onPointerUp={(event) => {
        const point = localPoint(event)
        pointers.current.delete(event.pointerId)
        if (pointers.current.size === 0 && gesture.current.moved < TAP_SLOP_PX) {
          const world = toWorld(point.x, point.y)
          onSelect(hitStar(skyRef.current, world.x, world.y, 16 / cameraRef.current.zoom))
        }
      }}
      onPointerCancel={(event) => pointers.current.delete(event.pointerId)}
      onPointerLeave={() => {
        if (hoverRef.current) {
          hoverRef.current = null
          dirtyRef.current = true
          setHover(null)
        }
      }}
      onWheel={(event) => zoomAbout(localPoint(event), Math.exp(-event.deltaY * 0.0015))}
      onKeyDown={(event) => {
        const step = 60 / cameraRef.current.zoom
        const cam = cameraRef.current
        if (event.key === 'ArrowLeft') cam.x -= step
        else if (event.key === 'ArrowRight') cam.x += step
        else if (event.key === 'ArrowUp') cam.y -= step
        else if (event.key === 'ArrowDown') cam.y += step
        else if (event.key === '+' || event.key === '=') zoomAbout({ x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 }, 1.25)
        else if (event.key === '-') zoomAbout({ x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 }, 0.8)
        else if (event.key === 'Escape') onSelect(null)
        else return
        event.preventDefault()
        dirtyRef.current = true
      }}
    >
      <canvas ref={linesRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
      <canvas ref={glowRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
      <canvas ref={labelsRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
      {hover ? (
        <div
          className="pointer-events-none absolute z-10 max-w-56 -translate-x-1/2 rounded-xl border border-amber-200/20 bg-[hsl(24_30%_10%/0.88)] px-3 py-2 text-xs text-amber-50 shadow-lg backdrop-blur"
          style={{ left: hover.x, top: hover.y + 18 }}
        >
          <div className="truncate font-semibold">{hover.star.label}</div>
          <div className="mt-0.5 text-amber-100/70">
            掌握 {Math.round(hover.star.mastery * 100)}% · {'★'.repeat(hover.star.stars)}
            {hover.star.due > 0 ? ` · ${hover.star.due} 待复习` : ''}
          </div>
        </div>
      ) : null}
    </div>
  )
}
