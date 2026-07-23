/**
 * Explicit in-section page hierarchy for the five primary nav sections.
 *
 * Left-top 后退/前进 is section-scoped (not global browser history). When the
 * visit stack is thin (refresh / deep link), we still walk these parents so
 * each level has a clear "one step up".
 *
 * Hierarchy sketch:
 *
 *  随心 freestyle
 *    /freestyle
 *      └─ practice routes (/palaces/:id/practice, /segments/:id/practice)
 *
 *  知识 palaces
 *    /palaces                          ← 学科书架（封面）
 *      ├─ /palaces/list[?subjectId]    ← 某一本书内的宫殿列表
 *      │    └─ /palaces/:id            ← 单宫殿查看
 *      └─ /knowledge[?subjectId]       ← 知识树编辑
 *
 *  英语 english
 *    /english
 *      ├─ /english/listening
 *      │    └─ /english/listening/courses/:id  (legacy /english/courses/:id)
 *      ├─ /english/reading
 *      │    └─ /english/reading/materials/:id
 *      ├─ /english/patterns
 *      └─ /english/vocab
 *
 *  创建 knowledge
 *    /palaces/new
 *      ├─ /palaces/:id/edit
 *      │    └─ /palaces/:id/quiz
 *      └─ /batch-generation
 *
 *  洞察 review
 *    /dashboard
 *      └─ /review
 *           ├─ /review/session/:id
 *           └─ /review/completed/:id
 */
import {
  getNavigationSectionRoot,
  readNavigationPathname,
  resolveNavigationSection,
  type NavigationSectionKey,
} from './navigationSection'

const SECTION_LABELS: Record<NavigationSectionKey, string> = {
  freestyle: '随心',
  palaces: '知识',
  english: '英语',
  knowledge: '创建',
  review: '洞察',
}

export function getNavigationSectionLabel(section: NavigationSectionKey): string {
  return SECTION_LABELS[section]
}

function stripTrailingSlash(pathname: string) {
  if (!pathname || pathname === '/') return pathname || '/'
  return pathname.replace(/\/+$/, '') || '/'
}

/** Parse fullPath into pathname + search (hash ignored for hierarchy). */
export function splitNavigationFullPath(fullPath: string): { pathname: string; search: string } {
  const queryIndex = fullPath.indexOf('?')
  const hashIndex = fullPath.indexOf('#')
  let pathEnd = fullPath.length
  if (queryIndex >= 0) pathEnd = Math.min(pathEnd, queryIndex)
  if (hashIndex >= 0) pathEnd = Math.min(pathEnd, hashIndex)
  const pathname = stripTrailingSlash(fullPath.slice(0, pathEnd) || '/')
  let search = ''
  if (queryIndex >= 0) {
    const searchEnd = hashIndex >= 0 && hashIndex > queryIndex ? hashIndex : fullPath.length
    search = fullPath.slice(queryIndex, searchEnd)
  }
  return { pathname, search }
}

function withSearch(pathname: string, search = ''): string {
  return `${pathname}${search}`
}

/**
 * Immediate parent path within the same primary section, or null at the
 * section home (or outside primary nav).
 */
export function resolveSectionHierarchicalParent(fullPath: string): string | null {
  const { pathname, search } = splitNavigationFullPath(fullPath)
  const section = resolveNavigationSection(pathname)
  if (!section) return null

  const root = getNavigationSectionRoot(section)
  if (pathname === root) {
    // Query-only variants of the section home still count as "one level deep"
    // only when they meaningfully change the page (none today on roots).
    return null
  }

  // ── 随心 ──────────────────────────────────────────────
  if (section === 'freestyle') {
    if (pathname === '/freestyle/session') return root
    if (/^\/palaces\/\d+\/practice$/.test(pathname)) return root
    if (/^\/segments\/\d+\/practice$/.test(pathname)) return root
    return root
  }

  // ── 知识（学科书架） ──────────────────────────────────
  if (section === 'palaces') {
    if (pathname === '/palaces/list') return root
    if (/^\/palaces\/\d+$/.test(pathname)) {
      // Prefer returning into the subject book when we know the binding.
      const subjectId = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(
        'subjectId',
      )
      if (subjectId && /^\d+$/.test(subjectId)) {
        return `/palaces/list?subjectId=${subjectId}`
      }
      return '/palaces/list'
    }
    if (pathname === '/knowledge' || pathname.startsWith('/knowledge/')) return root
    return root
  }

  // ── 英语 ──────────────────────────────────────────────
  if (section === 'english') {
    if (/^\/english\/listening\/courses\/\d+$/.test(pathname)) return '/english/listening'
    if (/^\/english\/courses\/\d+$/.test(pathname)) return '/english/listening'
    if (/^\/english\/reading\/materials\/\d+$/.test(pathname)) return '/english/reading'
    if (
      pathname === '/english/listening' ||
      pathname === '/english/reading' ||
      pathname === '/english/patterns' ||
      pathname === '/english/vocab'
    ) {
      return root
    }
    if (pathname === '/english-reading' || pathname.startsWith('/english-reading/')) {
      return '/english/reading'
    }
    return root
  }

  // ── 创建 ──────────────────────────────────────────────
  if (section === 'knowledge') {
    if (/^\/palaces\/\d+\/quiz$/.test(pathname)) {
      const id = pathname.match(/^\/palaces\/(\d+)\/quiz$/)?.[1]
      return id ? `/palaces/${id}/edit` : root
    }
    if (/^\/palaces\/\d+\/edit$/.test(pathname)) return root
    if (pathname === '/batch-generation') return root
    if (pathname === '/palaces/new') return null
    return root
  }

  // ── 洞察 ──────────────────────────────────────────────
  if (section === 'review') {
    if (/^\/review\/session\/\d+$/.test(pathname)) return '/review'
    if (/^\/review\/completed\/\d+$/.test(pathname)) return '/review'
    if (pathname === '/review' || pathname.startsWith('/review/')) return root
    if (pathname === '/' || pathname === '/dashboard') return null
    return root
  }

  return null
}

/**
 * Full ancestor chain from section root to the current path (inclusive).
 * Used to seed section history on deep landings so 后退 can walk levels.
 */
export function getSectionHierarchyChain(fullPath: string): string[] {
  const { pathname, search } = splitNavigationFullPath(fullPath)
  const section = resolveNavigationSection(pathname)
  if (!section) return [withSearch(pathname, search)]

  const seen = new Set<string>()
  const chain: string[] = []
  let cursor = withSearch(pathname, search)

  for (let guard = 0; guard < 10; guard += 1) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    chain.unshift(cursor)
    const parent = resolveSectionHierarchicalParent(cursor)
    if (!parent) break
    cursor = parent
  }

  const root = getNavigationSectionRoot(section)
  if (chain[0] !== root) {
    chain.unshift(root)
  }
  return chain
}

export function isAtSectionHierarchyRoot(fullPath: string): boolean {
  const { pathname } = splitNavigationFullPath(fullPath)
  const section = resolveNavigationSection(pathname)
  if (!section) return true
  return pathname === getNavigationSectionRoot(section)
}

/** Human-readable label for a full path (tooltips / history chrome). */
export function describeNavigationPath(fullPath: string): string {
  const pathname = readNavigationPathname(fullPath)
  if (pathname === '/palaces') return '学科书架'
  if (pathname === '/palaces/list') return '学科宫殿列表'
  if (pathname === '/knowledge' || pathname.startsWith('/knowledge/')) return '知识树编辑'
  if (pathname === '/english') return '英语总览'
  if (pathname === '/english/listening') return '听力库'
  if (/^\/english\/listening\/courses\/\d+$/.test(pathname) || /^\/english\/courses\/\d+$/.test(pathname)) {
    return '听力课程'
  }
  if (pathname === '/english/reading') return '阅读库'
  if (/^\/english\/reading\/materials\/\d+$/.test(pathname)) return '阅读文章'
  if (pathname === '/english/patterns') return '句模'
  if (pathname === '/english/vocab') return '生词本'
  if (pathname === '/freestyle') return '随心首页'
  if (pathname === '/palaces/new') return '创建入口'
  if (/^\/palaces\/\d+\/edit$/.test(pathname)) return '宫殿编辑'
  if (/^\/palaces\/\d+\/quiz$/.test(pathname)) return '宫殿测验'
  if (/^\/palaces\/\d+\/practice$/.test(pathname) || /^\/segments\/\d+\/practice$/.test(pathname)) {
    return '练习'
  }
  if (/^\/palaces\/\d+$/.test(pathname)) return '宫殿详情'
  if (pathname === '/dashboard' || pathname === '/') return '洞察首页'
  if (pathname === '/review') return '复习队列'
  if (/^\/review\/session\/\d+$/.test(pathname)) return '复习会话'
  if (/^\/review\/completed\/\d+$/.test(pathname)) return '复习完成'
  if (pathname === '/batch-generation') return '批量生成'
  return pathname
}

/** Human-readable parent target for tooltips. */
export function describeSectionHierarchyParent(fullPath: string): string | null {
  const parent = resolveSectionHierarchicalParent(fullPath)
  if (!parent) return null
  return describeNavigationPath(parent)
}
