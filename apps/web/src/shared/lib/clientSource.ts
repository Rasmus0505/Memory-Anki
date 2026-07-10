export type ClientSource = 'desktop' | 'pwa'

export function detectClientSource(): ClientSource {
  if (typeof navigator === 'undefined') return 'desktop'

  const userAgent = navigator.userAgent || ''
  if (
    /Electron/i.test(userAgent) ||
    (typeof window !== 'undefined' &&
      window.memoryAnkiDesktopTimer?.isDesktop === true)
  ) {
    return 'desktop'
  }

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const standaloneDisplay = window.matchMedia('(display-mode: standalone)').matches
    const iosStandalone = Boolean(
      (navigator as Navigator & { standalone?: boolean }).standalone,
    )
    if (standaloneDisplay || iosStandalone) {
      return 'pwa'
    }

    const coarsePointer = window.matchMedia('(pointer: coarse)').matches
    const narrowViewport = window.matchMedia('(max-width: 767px)').matches
    if (coarsePointer && narrowViewport) {
      return 'pwa'
    }
  }

  if (/Android|iPhone|iPod|IEMobile|Mobile/i.test(userAgent)) {
    return 'pwa'
  }

  return 'desktop'
}
