export interface DesktopTimerBridge {
  isDesktop?: boolean
  setMainWindowFullscreen?: (active: boolean) => void
  onMainWindowFocusChange?: (handler: (active: boolean) => void) => () => void
  onMainWindowFullscreenChange?: (handler: (active: boolean) => void) => () => void
  onDesktopFlushRequest?: (
    handler: (request: { requestId: string; reason?: string; requestedAt?: number }) => Promise<unknown> | unknown,
  ) => () => void
}

declare global {
  interface Window {
    memoryAnkiDesktopTimer?: DesktopTimerBridge
  }
}

export function getDesktopTimerBridge(): DesktopTimerBridge | null {
  if (typeof window === 'undefined') return null
  return window.memoryAnkiDesktopTimer ?? null
}

export function hasDesktopTimerBridge() {
  return getDesktopTimerBridge() != null
}
