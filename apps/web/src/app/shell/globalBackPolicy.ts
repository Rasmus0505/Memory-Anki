export interface GlobalBackPolicy {
  fallbackTo: string
  label: string
}

const MAIN_ROUTES = new Set([
  '/',
  '/dashboard',
  '/freestyle',
  '/palaces',
  '/palaces/new',
  '/knowledge',
  '/english',
  '/english-reading',
  '/review',
  '/profile',
])

export function resolveGlobalBackPolicy(pathname: string): GlobalBackPolicy | null {
  if (MAIN_ROUTES.has(pathname)) return null
  if (pathname === '/freestyle/session') return { fallbackTo: '/freestyle', label: '返回随心学习' }
  if (pathname === '/palaces/list') return { fallbackTo: '/palaces', label: '返回宫殿书架' }
  if (pathname === '/batch-generation') return { fallbackTo: '/palaces/new', label: '退出批量生成' }
  if (/^\/english\/courses\/\d+$/.test(pathname)) return { fallbackTo: '/english', label: '返回英语听力' }
  if (/^\/review\/(?:session\/\d+|feedback-preview)$/.test(pathname)) {
    return { fallbackTo: '/review', label: '返回复习队列' }
  }
  if (/^\/profile\/(?:timer|feedback|ai|backups)$/.test(pathname)) {
    return { fallbackTo: '/profile', label: '返回设置' }
  }

  const palaceMatch = pathname.match(/^\/palaces\/(\d+)(?:\/(edit|practice|quiz))?$/)
  if (palaceMatch) {
    const [, palaceId, childRoute] = palaceMatch
    return childRoute
      ? { fallbackTo: `/palaces/${palaceId}`, label: '返回宫殿' }
      : { fallbackTo: '/palaces', label: '返回宫殿书架' }
  }

  if (/^\/segments\/\d+\/practice$/.test(pathname)) {
    return { fallbackTo: '/palaces', label: '返回宫殿书架' }
  }

  return null
}
