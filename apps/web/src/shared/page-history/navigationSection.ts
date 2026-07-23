/**
 * Primary-shell section keys for the top-left back/forward controls.
 * Must stay aligned with `apps/web/src/app/shell/navSections.ts` matchers.
 */
export type NavigationSectionKey =
  | 'freestyle'
  | 'palaces'
  | 'english'
  | 'knowledge'
  | 'review'

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
