/**
 * Primary-shell section keys for the top-left back/forward controls.
 * Must stay aligned with `apps/web/src/app/shell/navSections.ts` matchers
 * and each section's `to` root path.
 */
export type NavigationSectionKey =
  | 'freestyle'
  | 'palaces'
  | 'english'
  | 'knowledge'
  | 'review'

/** Section home paths — keep in lockstep with `navSections[].to`. */
const SECTION_ROOTS: Record<NavigationSectionKey, string> = {
  freestyle: '/freestyle',
  palaces: '/palaces',
  english: '/english',
  knowledge: '/palaces/new',
  review: '/dashboard',
}

const isPracticeRoute = (pathname: string) =>
  /^\/palaces\/\d+\/practice$/.test(pathname) ||
  /^\/segments\/\d+\/practice$/.test(pathname)

const isCreationRoute = (pathname: string) =>
  pathname === '/palaces/new' ||
  pathname === '/batch-generation' ||
  /^\/palaces\/\d+\/(edit|quiz)$/.test(pathname)

const isLibraryRoute = (pathname: string) =>
  pathname === '/palaces' ||
  pathname === '/palaces/list' ||
  /^\/palaces\/\d+$/.test(pathname) ||
  pathname === '/knowledge' ||
  pathname.startsWith('/knowledge/')

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
  return SECTION_ROOTS[section]
}

export function isNavigationSectionRootPath(
  fullPath: string,
  section: NavigationSectionKey,
): boolean {
  return readNavigationPathname(fullPath) === getNavigationSectionRoot(section)
}

/** Resolve which primary nav section owns a pathname, or null if none. */
export function resolveNavigationSection(pathname: string): NavigationSectionKey | null {
  if (
    pathname === '/freestyle' ||
    pathname === '/freestyle/session' ||
    isPracticeRoute(pathname)
  ) {
    return 'freestyle'
  }
  if (isLibraryRoute(pathname)) return 'palaces'
  if (
    pathname === '/english' ||
    pathname.startsWith('/english/') ||
    pathname === '/english-reading' ||
    pathname.startsWith('/english-reading/')
  ) {
    return 'english'
  }
  if (isCreationRoute(pathname)) return 'knowledge'
  if (
    pathname === '/' ||
    pathname === '/dashboard' ||
    pathname === '/review' ||
    pathname.startsWith('/review/')
  ) {
    return 'review'
  }
  return null
}
