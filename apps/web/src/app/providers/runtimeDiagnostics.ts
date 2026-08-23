interface RuntimeDiagnosticsInput {
  area: string
  error: Error | null
  componentStack?: string
}

function safeRuntimeValue(read: () => string) {
  try {
    return read()
  } catch {
    return 'unavailable'
  }
}

function serviceWorkerSummary() {
  if (typeof navigator === 'undefined') return 'unavailable'
  if (!('serviceWorker' in navigator)) return 'unsupported'
  return navigator.serviceWorker.controller?.scriptURL || 'uncontrolled'
}

function displayModeSummary() {
  if (typeof window === 'undefined') return 'unavailable'
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean }
  if (standaloneNavigator.standalone || window.matchMedia?.('(display-mode: standalone)').matches) {
    return 'standalone'
  }
  return 'browser'
}

export function runtimeReleaseId() {
  return typeof __MEMORY_ANKI_RELEASE_ID__ === 'string'
    ? __MEMORY_ANKI_RELEASE_ID__
    : 'unknown'
}

export function buildRuntimeDiagnostics({ area, error, componentStack }: RuntimeDiagnosticsInput) {
  const lines = [
    `Memory Anki ${area} diagnosis`,
    `release=${runtimeReleaseId()}`,
    `timestamp=${new Date().toISOString()}`,
    `url=${safeRuntimeValue(() => window.location.href)}`,
    `online=${safeRuntimeValue(() => String(navigator.onLine))}`,
    `display_mode=${safeRuntimeValue(displayModeSummary)}`,
    `service_worker=${safeRuntimeValue(serviceWorkerSummary)}`,
    `browser=${safeRuntimeValue(() => navigator.userAgent)}`,
    `error=${error?.name ?? 'Error'}: ${error?.message ?? 'unknown'}`,
  ]
  if (error?.stack) lines.push(`stack=${error.stack}`)
  if (componentStack?.trim()) lines.push(`component_stack=${componentStack.trim()}`)
  return lines.join('\n')
}

function copyWithSelection(text: string) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false
  const host = document.body ?? document.documentElement
  if (!host) return false

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '-9999px'
  textarea.style.opacity = '0'
  host.appendChild(textarea)
  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

export async function copyRuntimeDiagnostics(text: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // iOS home-screen PWAs and older WebViews can reject Clipboard API calls.
    }
  }
  return copyWithSelection(text)
}
