export interface PresentationViewport {
  top: number
  left: number
  width: number
  height: number
}

export interface PresentationSession {
  release(): void
}

export interface PresentationPort {
  enterFullscreen(target: HTMLElement | null): Promise<boolean>
  exitFullscreen(): Promise<void>
  isFullscreenActive(): boolean
  lockViewport(onViewportChange: (viewport: PresentationViewport) => void): PresentationSession
  onFullscreenExit(listener: () => void): PresentationSession
  onEscape(listener: () => void): PresentationSession
  scheduleLayout(callback: () => void): void
}
