import { createMachine } from 'xstate'

export type MindMapPresentationEvent =
  | { type: 'ENTER_NATIVE_REQUESTED' }
  | { type: 'ENTER_VIEWPORT_REQUESTED' }
  | { type: 'NATIVE_PRESENTATION_ENTERED' }
  | { type: 'NATIVE_PRESENTATION_FAILED' }
  | { type: 'EXIT_REQUESTED' }
  | { type: 'PRESENTATION_EXITED' }
  | { type: 'HOST_FULLSCREEN_EXITED' }

export type MindMapPresentationMode = 'embedded' | 'native' | 'viewport'

export const mindMapPresentationMachine = createMachine({
  id: 'mindMapPresentation',
  initial: 'embedded',
  states: {
    embedded: {
      on: {
        ENTER_NATIVE_REQUESTED: 'requestingNativeFullscreen',
        ENTER_VIEWPORT_REQUESTED: 'viewportFullscreen',
      },
    },
    requestingNativeFullscreen: {
      on: {
        NATIVE_PRESENTATION_ENTERED: 'nativeFullscreen',
        NATIVE_PRESENTATION_FAILED: 'viewportFullscreen',
        EXIT_REQUESTED: 'exitingFullscreen',
      },
    },
    nativeFullscreen: {
      on: {
        EXIT_REQUESTED: 'exitingFullscreen',
        HOST_FULLSCREEN_EXITED: 'exitingFullscreen',
      },
    },
    viewportFullscreen: { on: { EXIT_REQUESTED: 'exitingFullscreen' } },
    exitingFullscreen: { on: { PRESENTATION_EXITED: 'embedded' } },
  },
})

export function isMindMapFullscreenState(value: unknown) {
  return value !== 'embedded' && value !== 'exitingFullscreen'
}

export function getMindMapPresentationMode(value: unknown): MindMapPresentationMode {
  if (value === 'nativeFullscreen') return 'native'
  if (value === 'requestingNativeFullscreen' || value === 'viewportFullscreen') return 'viewport'
  return 'embedded'
}
