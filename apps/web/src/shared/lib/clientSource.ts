export type ClientSource = 'desktop' | 'mobile'

export function detectClientSource(): ClientSource {
  if (typeof navigator === 'undefined') return 'desktop'

  const userAgent = navigator.userAgent || ''
  if (/Android|iPhone|iPod|IEMobile|Mobile/i.test(userAgent)) {
    return 'mobile'
  }

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches
    const narrowViewport = window.matchMedia('(max-width: 767px)').matches
    if (coarsePointer && narrowViewport) {
      return 'mobile'
    }
  }

  return 'desktop'
}
