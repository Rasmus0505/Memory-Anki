export type RevealGranularity = 'single' | 'level'
export type RevealStage = 'two-step' | 'direct'
export type FlipCardEditScope = 'unit' | 'palace'
/** Flip click camera. Pan keeps the current zoom so glyphs stay on whole pixels. */
export type FlipCameraNudge = 'still' | 'pan'

export interface FlipCardRevealConfig {
  granularity: RevealGranularity
  stage: RevealStage
  /** Double-click blank canvas edit: current unit spine or the whole palace. */
  editScope?: FlipCardEditScope
  /** Default still. Pan only translates the clicked card toward center. */
  cameraNudge?: FlipCameraNudge
}

export const DEFAULT_FLIP_CARD_REVEAL_CONFIG: FlipCardRevealConfig = {
  granularity: 'level',
  stage: 'two-step',
  editScope: 'unit',
  cameraNudge: 'still',
}

export function sanitizeFlipCardRevealConfig(value: unknown): FlipCardRevealConfig {
  const raw = value && typeof value === 'object'
    ? value as Partial<Record<keyof FlipCardRevealConfig, unknown>>
    : {}
  return {
    granularity: raw.granularity === 'single' ? 'single' : 'level',
    stage: raw.stage === 'direct' ? 'direct' : 'two-step',
    editScope: raw.editScope === 'palace' ? 'palace' : 'unit',
    cameraNudge: raw.cameraNudge === 'pan' ? 'pan' : 'still',
  }
}
