const STORAGE_KEY = 'memory_anki_api_token'
const URL_PARAM = 'api_token'

export function getApiToken(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setApiToken(token: string) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage may be unavailable; local loopback usage does not need a token.
  }
}

/** First visit supports https://<tailscale-host>/?api_token=xxx, then cleans the URL. */
export function initApiTokenFromUrl() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const token = url.searchParams.get(URL_PARAM)
  if (!token) return
  setApiToken(token)
  url.searchParams.delete(URL_PARAM)
  window.history.replaceState(null, '', url.toString())
}
