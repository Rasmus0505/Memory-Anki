import type { PageHistorySectionKey } from './pageHistoryTypes'

export function resolvePageHistorySection(pathname: string): PageHistorySectionKey {
  if (pathname === '/' || pathname === '/dashboard') return 'dashboard'
  if (pathname === '/freestyle') return 'freestyle'
  if (
    pathname === '/palaces' ||
    pathname.startsWith('/palaces/') ||
    pathname.startsWith('/segments/')
  ) return 'palaces'
  if (
    pathname === '/english' ||
    pathname.startsWith('/english/') ||
    pathname === '/english-reading' ||
    pathname.startsWith('/english-reading/')
  ) {
    return 'english'
  }
  if (pathname === '/knowledge' || pathname.startsWith('/knowledge/')) return 'knowledge'
  if (pathname === '/review' || pathname.startsWith('/review/')) return 'review'
  if (pathname === '/profile' || pathname.startsWith('/profile/')) return 'profile'
  return 'other'
}

export function resolvePageHistoryKey(pathname: string) {
  const exactKeys: Record<string, string> = {
    '/dashboard': 'dashboard',
    '/freestyle': 'freestyle',
    '/palaces': 'palace:shelf',
    '/palaces/list': 'palace:list',
    '/palaces/new': 'palace:new',
    '/english': 'english:workspace',
    '/english-reading': 'english-reading:workspace',
    '/knowledge': 'knowledge:workspace',
    '/review': 'review:overview',
    '/profile': 'profile:overview',
  }
  if (exactKeys[pathname]) return exactKeys[pathname]

  const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^\/palaces\/(\d+)$/, (match) => `palace:view:${match[1]}`],
    [/^\/palaces\/(\d+)\/edit$/, (match) => `palace:edit:${match[1]}`],
    [/^\/palaces\/(\d+)\/quiz$/, (match) => `palace:quiz:${match[1]}`],
    [/^\/palaces\/(\d+)\/practice$/, (match) => `palace:practice:${match[1]}`],
    [/^\/segments\/(\d+)\/practice$/, (match) => `segment:practice:${match[1]}`],
    [/^\/english\/courses\/(\d+)$/, (match) => `english:course:${match[1]}`],
    [/^\/review\/session\/(\d+)$/, (match) => `review:session:${match[1]}`],
    [/^\/profile\/(.+)$/, (match) => `profile:${match[1]}`],
  ]
  for (const [pattern, build] of patterns) {
    const match = pathname.match(pattern)
    if (match) return build(match)
  }
  return `route:${pathname}`
}
