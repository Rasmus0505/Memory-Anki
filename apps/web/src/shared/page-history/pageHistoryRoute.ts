// Derived from @/shared/routing/routeManifest — do not hand-maintain route
// tables here; register new routes in the manifest instead.
import { resolveHistoryKey, resolveHistorySection } from '@/shared/routing/routeManifest'
import type { PageHistorySectionKey } from './pageHistoryTypes'

export function resolvePageHistorySection(pathname: string): PageHistorySectionKey {
  return resolveHistorySection(pathname)
}

export function resolvePageHistoryKey(pathname: string) {
  return resolveHistoryKey(pathname)
}
