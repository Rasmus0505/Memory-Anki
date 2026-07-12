import type {
  PresentationPort,
  PresentationSession,
  PresentationViewport,
} from '@/modules/mindmap/application/ports/presentationPort'

interface WebkitFullscreenDocument extends Document {
  webkitExitFullscreen?: () => Promise<void> | void
  webkitFullscreenElement?: Element | null
}

interface WebkitFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void
}

function session(release: () => void): PresentationSession {
  return { release }
}

function fullscreenElement() {
  const webkitDocument = document as WebkitFullscreenDocument
  return document.fullscreenElement ?? webkitDocument.webkitFullscreenElement ?? null
}

function viewportMetrics(): PresentationViewport {
  const viewport = window.visualViewport
  return {
    top: viewport?.offsetTop ?? 0,
    left: viewport?.offsetLeft ?? 0,
    width: Math.max(1, Math.round(viewport?.width ?? window.innerWidth)),
    height: Math.max(1, Math.round(viewport?.height ?? window.innerHeight)),
  }
}

export const browserPresentationPort: PresentationPort = {
  async enterFullscreen(target) {
    if (fullscreenElement()) return true
    const fullscreenTarget = (target ?? document.documentElement) as WebkitFullscreenElement
    const request = fullscreenTarget.requestFullscreen ?? fullscreenTarget.webkitRequestFullscreen
    if (!request) return false
    try {
      await request.call(fullscreenTarget)
      return true
    } catch {
      return false
    }
  },

  async exitFullscreen() {
    if (!fullscreenElement()) return
    const webkitDocument = document as WebkitFullscreenDocument
    const exit = document.exitFullscreen ?? webkitDocument.webkitExitFullscreen
    if (!exit) return
    try {
      await exit.call(document)
    } catch {
      // CSS presentation remains authoritative when the native API rejects.
    }
  },

  isFullscreenActive: () => Boolean(fullscreenElement()),

  lockViewport(onViewportChange) {
    const body = document.body
    const root = document.documentElement
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    const properties = [
      '--memory-anki-mindmap-fullscreen-top',
      '--memory-anki-mindmap-fullscreen-left',
      '--memory-anki-mindmap-fullscreen-width',
      '--memory-anki-mindmap-fullscreen-height',
    ] as const
    const previousProperties = Object.fromEntries(
      properties.map((name) => [name, root.style.getPropertyValue(name)]),
    ) as Record<(typeof properties)[number], string>
    const previousBodyStyle = body.getAttribute('style')
    const previousRootOverflow = root.style.overflow

    const updateViewport = () => {
      const viewport = viewportMetrics()
      root.style.setProperty(properties[0], `${viewport.top}px`)
      root.style.setProperty(properties[1], `${viewport.left}px`)
      root.style.setProperty(properties[2], `${viewport.width}px`)
      root.style.setProperty(properties[3], `${viewport.height}px`)
      onViewportChange(viewport)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') updateViewport()
    }

    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `${-scrollY}px`
    body.style.left = `${-scrollX}px`
    body.style.right = '0'
    body.style.width = '100%'
    root.style.overflow = 'hidden'
    root.classList.add('memory-anki-mindmap-fullscreen-open')
    updateViewport()
    window.visualViewport?.addEventListener('resize', updateViewport)
    window.visualViewport?.addEventListener('scroll', updateViewport)
    window.addEventListener('resize', updateViewport)
    window.addEventListener('orientationchange', updateViewport)
    window.addEventListener('pageshow', updateViewport)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return session(() => {
      window.visualViewport?.removeEventListener('resize', updateViewport)
      window.visualViewport?.removeEventListener('scroll', updateViewport)
      window.removeEventListener('resize', updateViewport)
      window.removeEventListener('orientationchange', updateViewport)
      window.removeEventListener('pageshow', updateViewport)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (previousBodyStyle == null) body.removeAttribute('style')
      else body.setAttribute('style', previousBodyStyle)
      root.style.overflow = previousRootOverflow
      root.classList.remove('memory-anki-mindmap-fullscreen-open')
      for (const name of properties) {
        const previousValue = previousProperties[name]
        if (previousValue) root.style.setProperty(name, previousValue)
        else root.style.removeProperty(name)
      }
      if (!navigator.userAgent.includes('jsdom')) window.scrollTo({ left: scrollX, top: scrollY })
    })
  },

  onFullscreenExit(listener) {
    const handleChange = () => {
      if (!fullscreenElement()) listener()
    }
    document.addEventListener('fullscreenchange', handleChange)
    document.addEventListener('webkitfullscreenchange', handleChange)
    return session(() => {
      document.removeEventListener('fullscreenchange', handleChange)
      document.removeEventListener('webkitfullscreenchange', handleChange)
    })
  },

  onEscape(listener) {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      listener()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return session(() => window.removeEventListener('keydown', handleKeyDown, true))
  },

  scheduleLayout(callback) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(callback))
  },
}
