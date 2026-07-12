import { createMachine } from 'xstate'

export type MindMapPresentationEvent =
  | { type: 'ENTER_REQUESTED' }
  | { type: 'PRESENTATION_ENTERED' }
  | { type: 'PRESENTATION_FAILED' }
  | { type: 'EXIT_REQUESTED' }
  | { type: 'PRESENTATION_EXITED' }
  | { type: 'HOST_FULLSCREEN_EXITED' }

export const mindMapPresentationMachine = createMachine({
  id: 'mindMapPresentation',
  initial: 'embedded',
  states: {
    embedded: { on: { ENTER_REQUESTED: 'enteringFullscreen' } },
    enteringFullscreen: {
      on: {
        PRESENTATION_ENTERED: 'fullscreen',
        PRESENTATION_FAILED: 'fullscreen',
        EXIT_REQUESTED: 'exitingFullscreen',
      },
    },
    fullscreen: {
      on: {
        EXIT_REQUESTED: 'exitingFullscreen',
        HOST_FULLSCREEN_EXITED: 'exitingFullscreen',
      },
    },
    exitingFullscreen: { on: { PRESENTATION_EXITED: 'embedded' } },
  },
})

export function isMindMapFullscreenState(value: unknown) {
  return value !== 'embedded'
}
