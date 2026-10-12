import type { CSSProperties } from 'react'
import type { AmbientTone } from './ambientModel'

/**
 * Paper-room atmosphere: a window light behind content, plus a time-of-day tint,
 * paper grain and vignette washed over everything.
 */
export function AmbientLayer({ tone }: { tone: AmbientTone }) {
  const style = {
    '--ma-ambient-tint': tone.tint,
    '--ma-ambient-light': String(tone.light),
    '--ma-exam-pulse': tone.examPulseSeconds ? `${tone.examPulseSeconds}s` : '0s',
  } as CSSProperties

  return (
    <>
      <div className="ma-ambient ma-ambient--back" style={style} aria-hidden>
        <div className="ma-ambient__window" />
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
