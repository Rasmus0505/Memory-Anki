export const QUIZ_FONT_SCALE_MIN_PERCENT = 70
export const QUIZ_FONT_SCALE_MAX_PERCENT = 180
export const QUIZ_FONT_SCALE_STEP_PERCENT = 10
export const QUIZ_FONT_SCALE_DEFAULT_PERCENT = 100

export interface QuizFontScaleSettings {
  percent: number
}

export const DEFAULT_QUIZ_FONT_SCALE_SETTINGS: QuizFontScaleSettings = {
  percent: QUIZ_FONT_SCALE_DEFAULT_PERCENT,
}

export function snapQuizFontPercent(value: number) {
  if (!Number.isFinite(value)) return QUIZ_FONT_SCALE_DEFAULT_PERCENT
  const clamped = Math.min(
    QUIZ_FONT_SCALE_MAX_PERCENT,
    Math.max(QUIZ_FONT_SCALE_MIN_PERCENT, value),
  )
  const steps = Math.round((clamped - QUIZ_FONT_SCALE_MIN_PERCENT) / QUIZ_FONT_SCALE_STEP_PERCENT)
  return QUIZ_FONT_SCALE_MIN_PERCENT + steps * QUIZ_FONT_SCALE_STEP_PERCENT
}

export function adjustQuizFontPercent(current: number, steps: number) {
  return snapQuizFontPercent(snapQuizFontPercent(current) + steps * QUIZ_FONT_SCALE_STEP_PERCENT)
}

export function formatQuizFontScalePercent(percent: number) {
  return `${snapQuizFontPercent(percent)}%`
}

export function isQuizFontScaleSettings(value: unknown): value is QuizFontScaleSettings {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as QuizFontScaleSettings).percent === 'number' &&
      Number.isFinite((value as QuizFontScaleSettings).percent),
  )
}

export function sanitizeQuizFontScaleSettings(value: unknown): QuizFontScaleSettings {
  if (!isQuizFontScaleSettings(value)) return { ...DEFAULT_QUIZ_FONT_SCALE_SETTINGS }
  return { percent: snapQuizFontPercent(value.percent) }
}

/** One mouse notch is one 10% step. Up (negative deltaY) enlarges the question text. */
export function consumeWheelNotches(
  pending: number,
  event: { deltaY: number; deltaMode?: number },
) {
  const deltaMode = event.deltaMode ?? 0
  const notches =
    deltaMode === 1 ? event.deltaY : deltaMode === 2 ? event.deltaY * 16 : event.deltaY / 100
  let next = pending + notches
  let steps = 0
  // Pixel deltas are fractional, so ten 0.1 notches can land just short of 1.
  const notch = 1 - 1e-9
  while (next <= -notch) {
    next += 1
    steps += 1
  }
  while (next >= notch) {
    next -= 1
    steps -= 1
  }
  return { pending: next, steps }
}
