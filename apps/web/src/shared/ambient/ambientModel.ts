export interface AmbientInput {
  /** Local hour with fraction, 0–24. */
  hour: number
  /** Today's study progress towards the daily goal, 0–1. */
  progress: number
  examDaysLeft: number | null
}

export interface AmbientTone {
  tint: string
  /** Strength of the top "window light", grows with progress. */
  light: number
  /** 0 = none, otherwise seconds per breath of the exam pulse. */
  examPulseSeconds: number
}

interface TintStop {
  hour: number
  h: number
  s: number
  l: number
  a: number
}

// Barely-there washes: dawn warm white, afternoon gold, evening amber, night lamp.
const TINT_STOPS: TintStop[] = [
  { hour: 0, h: 22, s: 70, l: 42, a: 0.07 },
  { hour: 6, h: 44, s: 70, l: 94, a: 0.035 },
  { hour: 10, h: 42, s: 60, l: 90, a: 0.025 },
  { hour: 15, h: 38, s: 90, l: 70, a: 0.05 },
  { hour: 19, h: 26, s: 85, l: 56, a: 0.06 },
  { hour: 24, h: 22, s: 70, l: 42, a: 0.07 },
]

const lerp = (from: number, to: number, t: number) => from + (to - from) * t
const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))

export function resolveTint(hour: number) {
  const h = ((hour % 24) + 24) % 24
  let index = 0
  while (index < TINT_STOPS.length - 2 && TINT_STOPS[index + 1].hour <= h) index += 1
  const from = TINT_STOPS[index]
  const to = TINT_STOPS[index + 1]
  const t = (h - from.hour) / (to.hour - from.hour)
  const round = (value: number, digits = 1) => Number(value.toFixed(digits))
  return `hsl(${round(lerp(from.h, to.h, t))} ${round(lerp(from.s, to.s, t))}% ${round(lerp(from.l, to.l, t))}% / ${round(lerp(from.a, to.a, t), 3)})`
}

export function resolveExamPulse(daysLeft: number | null) {
  if (daysLeft == null || daysLeft < 0 || daysLeft > 14) return 0
  if (daysLeft <= 3) return 3.2
  if (daysLeft <= 7) return 4.4
  return 6
}

export function resolveAmbientTone(input: AmbientInput): AmbientTone {
  return {
    tint: resolveTint(input.hour),
    light: Number((0.035 + clamp01(input.progress) * 0.075).toFixed(3)),
    examPulseSeconds: resolveExamPulse(input.examDaysLeft),
  }
}

export function dailyGoalSeconds(weeklyStudyMinutes: number | null | undefined) {
  const weekly = weeklyStudyMinutes && weeklyStudyMinutes > 0 ? weeklyStudyMinutes : 300
  return (weekly * 60) / 7
}
