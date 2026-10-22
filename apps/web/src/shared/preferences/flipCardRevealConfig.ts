export type RevealGranularity = 'single' | 'level'
export type RevealStage = 'two-step' | 'direct'
export type FlipCardEditScope = 'unit' | 'palace'

export interface FlipCardRevealConfig {
  granularity: RevealGranularity
  stage: RevealStage
  /** Double-click blank canvas edit: current unit spine or the whole palace. */
  editScope?: FlipCardEditScope
  /**
   * Enter flip pans the canvas to the cards that step just revealed. Keyboard-only
   * study needs it on; turning it off keeps the viewport wherever the learner left it.
   */
  enterRevealFollow?: boolean
}

export const DEFAULT_FLIP_CARD_REVEAL_CONFIG: FlipCardRevealConfig = {
  granularity: 'level',
  stage: 'two-step',
  editScope: 'unit',
  enterRevealFollow: true,
}

export function sanitizeFlipCardRevealConfig(value: unknown): FlipCardRevealConfig {
  const raw = value && typeof value === 'object'
    ? value as Partial<Record<keyof FlipCardRevealConfig, unknown>>
    : {}
  return {
    granularity: raw.granularity === 'single' ? 'single' : 'level',
    stage: raw.stage === 'direct' ? 'direct' : 'two-step',
    editScope: raw.editScope === 'palace' ? 'palace' : 'unit',
    enterRevealFollow: raw.enterRevealFollow !== false,
  }
}
