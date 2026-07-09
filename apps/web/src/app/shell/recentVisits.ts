export interface RecentVisit {
  /** Full path including search, such as /palaces/42 */
  path: string
  /** Display label, such as "记忆宫殿 · /palaces/42" */
  label: string
  visitedAt: number
}

const STORAGE_KEY = 'memory-anki-recent-visits'
const MAX_ITEMS = 5

const IGNORED_PATHS = new Set(['/', '/timer-overlay'])

export function readRecentVisits(): RecentVisit[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is RecentVisit =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as RecentVisit).path === 'string' &&
        typeof (item as RecentVisit).label === 'string' &&
        typeof (item as RecentVisit).visitedAt === 'number',
    )
  } catch {
    return []
  }
}

export function recordRecentVisit(path: string, label: string) {
  if (IGNORED_PATHS.has(path)) return
  try {
    const existing = readRecentVisits().filter((item) => item.path !== path)
    const next: RecentVisit[] = [{ path, label, visitedAt: Date.now() }, ...existing].slice(0, MAX_ITEMS)
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // sessionStorage can be unavailable in restricted browsing contexts.
  }
}
