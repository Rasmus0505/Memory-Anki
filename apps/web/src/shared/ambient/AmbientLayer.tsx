import { useEffect, useRef, type CSSProperties } from 'react'
import type { AmbientTone } from './ambientModel'
import { createDustMotes } from './dustMotes'
import { prefersReducedMotion } from '@/shared/lib/prefersReducedMotion'

function DustMotesCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || prefersReducedMotion() || typeof document.body.animate !== 'function') return
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
    const controller = createDustMotes(canvas, coarse ? 14 : 26)
    if (!controller) return
    const sync = () => (document.hidden ? controller.stop() : controller.start())
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      controller.destroy()
    }
  }, [])

  return <canvas ref={canvasRef} className="ma-ambient__motes" aria-hidden />
}

/**
 * Paper-room atmosphere: a window light and dust motes behind content, plus a
 * time-of-day tint, paper grain and vignette washed over everything.
 */
export function AmbientLayer({ tone, motes }: { tone: AmbientTone; motes: boolean }) {
  const style = {
    '--ma-ambient-tint': tone.tint,
    '--ma-ambient-light': String(tone.light),
    '--ma-exam-pulse': tone.examPulseSeconds ? `${tone.examPulseSeconds}s` : '0s',
  } as CSSProperties

  return (
    <>
      <div className="ma-ambient ma-ambient--back" style={style} aria-hidden>
        <div className="ma-ambient__window" />
        {motes ? <DustMotesCanvas /> : null}
      </div>
      <div
        className="ma-ambient ma-ambient--front"
        data-exam-pulse={tone.examPulseSeconds ? 'on' : undefined}
        style={style}
        aria-hidden
      >
        <div className="ma-ambient__tint" />
        <div className="ma-ambient__grain" />
        <div className="ma-ambient__vignette" />
      </div>
    </>
  )
}
