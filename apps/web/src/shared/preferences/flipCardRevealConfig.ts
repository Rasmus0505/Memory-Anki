export type RevealGranularity = 'single' | 'level'
export type RevealStage = 'two-step' | 'direct'

export interface FlipCardRevealConfig {
  granularity: RevealGranularity
  stage: RevealStage
}

export const DEFAULT_FLIP_CARD_REVEAL_CONFIG: FlipCardRevealConfig = {
  granularity: 'level',
  stage: 'two-step',
}

export function sanitizeFlipCardRevealConfig(value: unknown): FlipCardRevealConfig {
  const raw = value && typeof value === 'object'
    ? value as Partial<Record<keyof FlipCardRevealConfig, unknown>>
    : {}
  return {
    granularity: raw.granularity === 'single' ? 'single' : 'level',
    stage: raw.stage === 'direct' ? 'direct' : 'two-step',
  }
}
