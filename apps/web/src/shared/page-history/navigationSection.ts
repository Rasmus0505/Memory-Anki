/**
 * Primary-shell section keys for the top-left back/forward controls.
 * Derived from `@/shared/routing/routeManifest` — the single source of truth
 * shared with `app/shell/navSections.ts` and the router fallback lists.
 */
import {
  NAV_SECTION_ROOTS,
  resolveNavSection,
  type NavSectionKey,
} from '@/shared/routing/routeManifest'

export type NavigationSectionKey = NavSectionKey

/** Pathname only (strip search/hash) for root comparisons. */
export function readNavigationPathname(fullPath: string): string {
  const queryIndex = fullPath.indexOf('?')
  const hashIndex = fullPath.indexOf('#')
  let end = fullPath.length
  if (queryIndex >= 0) end = Math.min(end, queryIndex)
  if (hashIndex >= 0) end = Math.min(end, hashIndex)
  return fullPath.slice(0, end) || '/'
}

/** Home path for a primary nav section (same as sidebar second-click target). */
export function getNavigationSectionRoot(section: NavigationSectionKey): string {
  return NAV_SECTION_ROOTS[section]
}

export function isNavigationSectionRootPath(
  fullPath: string,
  section: NavigationSectionKey,
): boolean {
  return readNavigationPathname(fullPath) === getNavigationSectionRoot(section)
}

/** Resolve which primary nav section owns a pathname, or null if none. */
export function resolveNavigationSection(pathname: string): NavigationSectionKey | null {
  return resolveNavSection(pathname)
}
