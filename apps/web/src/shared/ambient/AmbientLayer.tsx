import type { CSSProperties } from 'react'
import type { AmbientTone } from './ambientModel'

/** Exam proximity: the screen edge breathes faster as the exam nears; nothing otherwise. */
export function AmbientLayer({ tone }: { tone: AmbientTone }) {
  if (!tone.examPulseSeconds) return null
  const style = { '--ma-exam-pulse': `${tone.examPulseSeconds}s` } as CSSProperties
  return <div className="ma-ambient" data-exam-pulse="on" style={style} aria-hidden />
}
