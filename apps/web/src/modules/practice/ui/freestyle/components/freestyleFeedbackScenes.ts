import { resolveFxGate } from '@/shared/fx'

/** Freestyle DOM feedback that is not a cue (card gestures, banner pop) follows the review motion switch. */
export function freestyleMotionOn() {
  return resolveFxGate('review').motion
}

export const PROGRESS_QUARTERS = [0.25, 0.5, 0.75] as const
const QUARTER_LABEL: Record<(typeof PROGRESS_QUARTERS)[number], string> = {
  0.25: '四分之一',
  0.5: '过半了',
  0.75: '最后四分之一',
}

/** The highest quarter mark passed going from `previous` to `next`, if any. */
export function crossedQuarter(previous: number, next: number) {
  let crossed: (typeof PROGRESS_QUARTERS)[number] | null = null
  for (const mark of PROGRESS_QUARTERS) {
    if (previous < mark && next >= mark) crossed = mark
  }
  return crossed == null ? null : { mark: crossed, label: QUARTER_LABEL[crossed] }
}
