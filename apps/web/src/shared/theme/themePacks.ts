import { STUDY_PACK } from './packs/study'
import type { ThemeMotion } from './packs/types'

export function themeMotion(): ThemeMotion {
  return STUDY_PACK.motion
}

export function themeColorFor(scheme: 'light' | 'dark') {
  return STUDY_PACK.themeColor[scheme]
}
