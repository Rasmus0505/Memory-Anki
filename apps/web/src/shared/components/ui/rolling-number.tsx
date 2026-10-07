import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '@/shared/lib/prefersReducedMotion'

const NUMBER_RUN = /\d+(?:\.\d+)?/g
const DURATION_MS = 900

export function splitNumericRuns(text: string) {
  const parts: Array<string | { value: number; decimals: number }> = []
  let last = 0
  for (const match of text.matchAll(NUMBER_RUN)) {
    const index = match.index ?? 0
    if (index > last) parts.push(text.slice(last, index))
    const raw = match[0]
    parts.push({ value: Number(raw), decimals: raw.includes('.') ? raw.split('.')[1].length : 0 })
    last = index + raw.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/** Renders `text` with every number rolled from its previous value (or 0) at `progress` 0–1. */
export function interpolateNumericText(text: string, previous: string | null, progress: number) {
  const target = splitNumericRuns(text)
  const from = previous ? splitNumericRuns(previous).filter((part) => typeof part !== 'string') : []
  let numberIndex = 0
  return target
    .map((part) => {
      if (typeof part === 'string') return part
      const start = from[numberIndex] && typeof from[numberIndex] !== 'string' ? (from[numberIndex] as { value: number }).value : 0
      numberIndex += 1
      const value = start + (part.value - start) * progress
      return progress >= 1 ? part.value.toFixed(part.decimals) : value.toFixed(part.decimals)
    })
    .join('')
}

function skipMotion() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return true
  // No Web Animations means no real compositor (jsdom): always show the final value.
  if (typeof document.body?.animate !== 'function') return true
  return prefersReducedMotion()
}

/** Text whose numbers roll up like an odometer whenever the value changes. */
export function RollingNumber({ value, className }: { value: string | number; className?: string }) {
  const text = String(value)
  const [display, setDisplay] = useState(() => (skipMotion() ? text : interpolateNumericText(text, null, 0)))
  const previousRef = useRef<string | null>(null)

  useEffect(() => {
    const from = previousRef.current
    previousRef.current = text
    if (skipMotion() || typeof window.requestAnimationFrame !== 'function' || from === text) {
      setDisplay(text)
      return
    }
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS)
      const eased = 1 - Math.pow(1 - t, 4)
      setDisplay(interpolateNumericText(text, from, eased))
      if (t < 1) frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [text])

  return (
    <span className={className} aria-label={text}>
      <span aria-hidden className="tabular-nums">{display}</span>
    </span>
  )
}
